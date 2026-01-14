/**
 * HappyFox MCP Adapter - Cloudflare Worker Entry Point
 * MCP 2025-11-25 Streamable HTTP Transport with OAuth 2.0 Authentication
 */

import { OAuthProvider } from '@cloudflare/workers-oauth-provider';
import { Env, MCPMessage, MCP_PROTOCOL_VERSION, AuthContext } from './types';
import { MCPServer } from './mcp/server';
import { CORSMiddleware } from './middleware/cors';
import { SessionTokenManager } from './session/token';
import { handleWellKnown } from './oauth/handlers/metadata';
import { renderConsentPage, renderErrorPage } from './oauth/views/consent';
import { validateAndResolveStaff } from './oauth/services/happyfox-validator';
import { createCredentialStore } from './oauth/services/credential-store';
import { AVAILABLE_SCOPES, DEFAULT_SCOPES, StoredCredentials, CREDENTIAL_TTL_SECONDS, HappyFoxScope } from './oauth/types';

// Account name validation pattern (prevents SSRF)
const ACCOUNT_NAME_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i;

/**
 * Props stored in OAuth grant and passed to API handler
 */
interface OAuthProps {
  tokenId: string;
  staffId: number;
  staffEmail: string;
  accountName: string;
  region: 'us' | 'eu';
}

/**
 * Extended environment with OAuth provider helpers
 */
interface EnvWithOAuth extends Env {
  OAUTH_PROVIDER: OAuthHelpers;
}

/**
 * OAuth helpers provided by the library
 */
interface OAuthHelpers {
  parseAuthRequest(request: Request): Promise<OAuthRequestInfo>;
  lookupClient(clientId: string): Promise<ClientInfo | null>;
  completeAuthorization(options: CompleteAuthOptions): Promise<{ redirectTo: string }>;
}

interface OAuthRequestInfo {
  responseType: string;
  clientId: string;
  redirectUri: string;
  scope: string[];
  state?: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
}

interface ClientInfo {
  clientId: string;
  clientName?: string;
  clientUri?: string;
  logoUri?: string;
  redirectUris?: string[];
}

interface CompleteAuthOptions {
  request: OAuthRequestInfo;
  userId: string;
  metadata?: Record<string, any>;
  scope: string[];
  props: OAuthProps;
}

/**
 * Build AuthContext from OAuth props by retrieving stored credentials
 */
async function buildAuthContext(
  props: OAuthProps,
  scopes: string[],
  env: Env
): Promise<AuthContext> {
  const credentialStore = createCredentialStore(env.OAUTH_KV, env.CREDENTIAL_ENCRYPTION_KEY);
  const storedCreds = await credentialStore.retrieve(props.tokenId);

  if (!storedCreds) {
    throw new Error('Credentials not found or expired');
  }

  return {
    credentials: {
      apiKey: storedCreds.apiKey,
      authCode: storedCreds.authCode,
      accountName: storedCreds.accountName,
      region: storedCreds.region,
    },
    staffId: storedCreds.staffId,
    staffEmail: storedCreds.staffEmail,
    scopes,
    tokenId: props.tokenId,
  };
}

/**
 * MCP API Handler - Processes authenticated MCP requests
 * Note: Uses 'any' for env/ctx types to satisfy OAuthProvider's generic handler type requirements.
 * The OAuth provider adds 'props' and 'scopes' to the ctx object at runtime.
 */
class McpApiHandler {
  async fetch(
    request: Request,
    env: any,
    ctx: any
  ): Promise<Response> {
    const typedEnv = env as Env;
    const typedCtx = ctx as ExecutionContext & { props: OAuthProps; scopes: string[] };
    // Validate configuration
    if (!typedEnv.MCP_SESSION_SECRET || typedEnv.MCP_SESSION_SECRET.length < 32) {
      return this.jsonRpcError(-32603, 'Internal error: Server misconfigured.', null, 500);
    }

    // Validate CREDENTIAL_ENCRYPTION_KEY (must be valid 32-byte base64 for AES-256-GCM)
    if (!this.isValidEncryptionKey(typedEnv.CREDENTIAL_ENCRYPTION_KEY)) {
      return this.jsonRpcError(-32603, 'Internal error: Server misconfigured.', null, 500);
    }

    const corsMiddleware = new CORSMiddleware(typedEnv.ALLOWED_ORIGINS);
    const origin = request.headers.get('Origin');

    // CORS validation
    if (!corsMiddleware.isOriginValid(origin)) {
      return corsMiddleware.handleInvalidOrigin();
    }

    const corsHeaders = corsMiddleware.getCORSHeaders(origin);

    // Handle OPTIONS preflight
    if (request.method === 'OPTIONS') {
      return corsMiddleware.handlePreflight(origin);
    }

    // Handle GET (SSE streaming - not implemented)
    if (request.method === 'GET') {
      return new Response('SSE streaming not supported', {
        status: 405,
        headers: { ...corsHeaders, 'Allow': 'POST, OPTIONS, DELETE' }
      });
    }

    // Handle DELETE (session termination)
    if (request.method === 'DELETE') {
      return new Response(null, { status: 202, headers: corsHeaders });
    }

    // Only POST from here
    if (request.method !== 'POST') {
      return new Response('Method not allowed', {
        status: 405,
        headers: { ...corsHeaders, 'Allow': 'POST, OPTIONS, DELETE' }
      });
    }

    // Check if MCP headers are present BEFORE parsing JSON
    // This ensures header errors take precedence over parse errors for non-initialize requests
    const hasMcpHeaders = this.hasMcpHeaders(request);

    // Parse request body
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      // If MCP headers are missing and JSON is invalid, return header error
      // (we can't determine if it's initialize, so assume it's not)
      if (!hasMcpHeaders) {
        return this.jsonRpcError(-32600, 'Invalid Request: MCP-Protocol-Version header required.', null, 400, corsHeaders);
      }
      return this.jsonRpcError(-32700, 'Parse error: Invalid JSON', null, 400, corsHeaders);
    }

    // Reject batch requests
    if (Array.isArray(rawBody)) {
      return this.jsonRpcError(-32600, 'Invalid Request: Batch requests not supported.', null, 400, corsHeaders);
    }

    // Validate JSON-RPC 2.0 structure
    if (!rawBody || typeof rawBody !== 'object' || (rawBody as Record<string, unknown>).jsonrpc !== '2.0') {
      const rawId = (rawBody && typeof rawBody === 'object' && 'id' in rawBody)
        ? (rawBody as Record<string, unknown>).id
        : null;
      const id = (typeof rawId === 'string' || typeof rawId === 'number' || rawId === null) ? rawId : null;
      return this.jsonRpcError(-32600, 'Invalid Request: Missing or invalid jsonrpc field', id, 400, corsHeaders);
    }

    const body = rawBody as Record<string, unknown>;
    if (typeof body.method !== 'string' || body.method.length === 0) {
      const rawId = body.id;
      const id = (typeof rawId === 'string' || typeof rawId === 'number' || rawId === null) ? rawId : null;
      return this.jsonRpcError(-32600, 'Invalid Request: Missing or invalid method field', id, 400, corsHeaders);
    }

    const message = rawBody as MCPMessage;
    const isInitialize = message.method === 'initialize';

    // Validate MCP headers for non-initialize requests
    if (!isInitialize) {
      const headerError = this.validateMcpHeaders(request, message, corsHeaders);
      if (headerError) return headerError;

      // Session validation
      const sessionError = await this.validateSession(request, typedEnv, message, corsHeaders);
      if (sessionError) return sessionError;
    }

    // Build AuthContext from OAuth props
    let authContext: AuthContext;
    try {
      authContext = await buildAuthContext(typedCtx.props, typedCtx.scopes, typedEnv);
    } catch (error) {
      return this.jsonRpcError(
        -32002,
        'Authentication error: Unable to retrieve credentials. Please re-authorize.',
        'id' in message ? message.id : null,
        401,
        corsHeaders
      );
    }

    // Process the message
    const mcpServer = new MCPServer(authContext);
    const response = await mcpServer.handleMessage(message);

    // Handle notifications (no response body)
    if (response === null) {
      return new Response(null, { status: 202, headers: corsHeaders });
    }

    // Build response headers
    const responseHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...corsHeaders
    };

    // Add session ID to initialize response
    if (isInitialize && response.result) {
      const tokenManager = new SessionTokenManager(typedEnv.MCP_SESSION_SECRET);
      const capabilities = Object.keys(response.result.capabilities || {});
      const sessionToken = await tokenManager.createToken(MCP_PROTOCOL_VERSION, capabilities);
      responseHeaders['MCP-Session-Id'] = sessionToken;
    }

    return new Response(JSON.stringify(response), { headers: responseHeaders });
  }

  private validateMcpHeaders(
    request: Request,
    message: MCPMessage,
    corsHeaders: Record<string, string>
  ): Response | null {
    const id = 'id' in message ? message.id : null;

    // Validate MCP-Protocol-Version header
    const protocolVersionHeader = request.headers.get('MCP-Protocol-Version');
    if (!protocolVersionHeader) {
      return this.jsonRpcError(-32600, 'Invalid Request: MCP-Protocol-Version header required.', id, 400, corsHeaders);
    }
    if (protocolVersionHeader !== MCP_PROTOCOL_VERSION) {
      return this.jsonRpcError(-32602, `Unsupported protocol version: ${protocolVersionHeader}`, id, 400, corsHeaders);
    }

    // Validate Accept header
    const acceptHeader = request.headers.get('Accept') || '';
    const hasJson = acceptHeader.includes('application/json') || acceptHeader.includes('*/*');
    const hasSSE = acceptHeader.includes('text/event-stream') || acceptHeader.includes('*/*');
    if (!hasJson || !hasSSE) {
      return this.jsonRpcError(-32600, 'Invalid Request: Accept header must include application/json and text/event-stream.', id, 400, corsHeaders);
    }

    // Validate Content-Type header
    const contentType = request.headers.get('Content-Type');
    if (!contentType || !contentType.includes('application/json')) {
      return this.jsonRpcError(-32600, 'Invalid Request: Content-Type must be application/json', id, 400, corsHeaders);
    }

    return null;
  }

  private async validateSession(
    request: Request,
    env: Env,
    message: MCPMessage,
    corsHeaders: Record<string, string>
  ): Promise<Response | null> {
    const id = 'id' in message ? message.id : null;
    const sessionId = request.headers.get('MCP-Session-Id');

    if (!sessionId) {
      return this.jsonRpcError(-32000, 'Bad Request: MCP-Session-Id header required.', id, 400, corsHeaders);
    }

    const tokenManager = new SessionTokenManager(env.MCP_SESSION_SECRET);
    const validation = await tokenManager.validateToken(sessionId);

    if (!validation.valid) {
      const statusCode = validation.error === 'expired' || validation.error === 'invalid' ? 404 : 400;
      const errorMessage = validation.error === 'expired'
        ? 'Session expired. Please re-initialize.'
        : validation.error === 'invalid'
        ? 'Invalid session. Please re-initialize.'
        : 'Malformed session token.';
      return this.jsonRpcError(-32001, errorMessage, id, statusCode, corsHeaders);
    }

    return null;
  }

  private jsonRpcError(
    code: number,
    message: string,
    id: string | number | null,
    status: number,
    corsHeaders: Record<string, string> = {}
  ): Response {
    return new Response(JSON.stringify({
      jsonrpc: '2.0',
      error: { code, message },
      id
    }), {
      status,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }

  /**
   * Quick check if MCP headers are present (used before JSON parsing)
   */
  private hasMcpHeaders(request: Request): boolean {
    return request.headers.has('MCP-Protocol-Version');
  }

  /**
   * Validate CREDENTIAL_ENCRYPTION_KEY is a valid 32-byte base64 string
   */
  private isValidEncryptionKey(key: string | undefined): boolean {
    if (!key) return false;
    try {
      const decoded = atob(key);
      return decoded.length === 32;
    } catch {
      return false;
    }
  }
}

/**
 * Default Handler - Handles non-API requests (consent flow, well-known endpoints)
 * Note: Uses 'any' for env type to satisfy OAuthProvider's generic handler type requirements
 */
const defaultHandler = {
  async fetch(request: Request, env: any, ctx: ExecutionContext): Promise<Response> {
    const typedEnv = env as EnvWithOAuth;
    const url = new URL(request.url);

    // Handle well-known endpoints
    const wellKnownResponse = handleWellKnown(request, typedEnv);
    if (wellKnownResponse) {
      return wellKnownResponse;
    }

    // Handle authorization endpoint
    if (url.pathname === '/authorize') {
      return handleAuthorize(request, typedEnv);
    }

    // Handle staff validation endpoint (for consent form)
    if (url.pathname === '/api/validate-staff' && request.method === 'POST') {
      return handleValidateStaff(request);
    }

    // 404 for other paths
    return new Response('Not Found', { status: 404 });
  }
};

/**
 * Generate a CSRF token
 */
function generateCsrfToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes));
}

/**
 * Handle /authorize endpoint
 */
async function handleAuthorize(request: Request, env: EnvWithOAuth): Promise<Response> {
  try {
    const oauthReq = await env.OAUTH_PROVIDER.parseAuthRequest(request);

    // Validate response_type
    if (oauthReq.responseType !== 'code') {
      return new Response(
        renderErrorPage('Invalid Request', 'Unsupported response_type. Only "code" is supported.'),
        { status: 400, headers: { 'Content-Type': 'text/html' } }
      );
    }

    // PKCE required
    if (!oauthReq.codeChallenge || oauthReq.codeChallengeMethod !== 'S256') {
      return new Response(
        renderErrorPage('Invalid Request', 'PKCE with S256 is required.'),
        { status: 400, headers: { 'Content-Type': 'text/html' } }
      );
    }

    // Look up client metadata
    const clientInfo = await env.OAUTH_PROVIDER.lookupClient(oauthReq.clientId);
    if (!clientInfo) {
      return new Response(
        renderErrorPage('Invalid Client', 'Unknown client_id.'),
        { status: 400, headers: { 'Content-Type': 'text/html' } }
      );
    }

    // Parse scopes - return error if client explicitly requested only invalid scopes
    let requestedScopes = oauthReq.scope.filter(s => AVAILABLE_SCOPES.includes(s as HappyFoxScope));
    if (requestedScopes.length === 0 && oauthReq.scope.length > 0) {
      return new Response(
        renderErrorPage('Invalid Scopes', 'None of the requested scopes are valid.'),
        { status: 400, headers: { 'Content-Type': 'text/html' } }
      );
    }
    if (requestedScopes.length === 0) {
      requestedScopes = [...DEFAULT_SCOPES];
    }

    // Handle GET - show consent form with CSRF token
    if (request.method === 'GET') {
      const csrfToken = generateCsrfToken();
      const html = renderConsentPage({
        clientName: clientInfo.clientName || clientInfo.clientId,
        clientUri: clientInfo.clientUri,
        logoUri: clientInfo.logoUri,
        requestedScopes,
        csrfToken,
      });
      return new Response(html, {
        status: 200,
        headers: {
          'Content-Type': 'text/html',
          'Set-Cookie': `csrf_token=${csrfToken}; HttpOnly; Secure; SameSite=Strict; Path=/authorize; Max-Age=600`,
        }
      });
    }

    // Handle POST - process consent form
    if (request.method === 'POST') {
      const formData = await request.formData();

      // CSRF validation
      const formCsrfToken = formData.get('csrf_token') as string || '';
      const cookieHeader = request.headers.get('Cookie') || '';
      const csrfCookieMatch = cookieHeader.match(/csrf_token=([^;]+)/);
      const cookieCsrfToken = csrfCookieMatch ? csrfCookieMatch[1] : '';

      if (!formCsrfToken || !cookieCsrfToken || formCsrfToken !== cookieCsrfToken) {
        return new Response(
          renderErrorPage('Invalid Request', 'CSRF token validation failed. Please try again.'),
          { status: 400, headers: { 'Content-Type': 'text/html' } }
        );
      }

      const accountName = (formData.get('account_name') as string || '').trim();
      const apiKey = formData.get('api_key') as string || '';
      const authCode = formData.get('auth_code') as string || '';
      const email = (formData.get('email') as string || '').trim();
      const region = (formData.get('region') as 'us' | 'eu') || 'us';

      // Validation
      if (!ACCOUNT_NAME_PATTERN.test(accountName)) {
        return consentErrorResponse(clientInfo, requestedScopes, 'Invalid account subdomain format.', { accountName, email, region });
      }
      if (!apiKey || !authCode || !email) {
        return consentErrorResponse(clientInfo, requestedScopes, 'All fields are required.', { accountName, email, region });
      }

      // Validate credentials and resolve staff ID
      const validationResult = await validateAndResolveStaff(
        { apiKey, authCode, accountName, region },
        email
      );

      if (!validationResult.valid || !validationResult.staffId || !validationResult.staffName) {
        return consentErrorResponse(clientInfo, requestedScopes, validationResult.error || 'Validation failed.', { accountName, email, region });
      }

      // Generate token ID and store credentials
      const tokenId = crypto.randomUUID();
      const now = Math.floor(Date.now() / 1000);
      const storedCredentials: StoredCredentials = {
        apiKey, authCode, accountName, region,
        staffId: validationResult.staffId,
        staffName: validationResult.staffName,
        staffEmail: email,
        createdAt: now,
        expiresAt: now + CREDENTIAL_TTL_SECONDS,
      };

      const credentialStore = createCredentialStore(env.OAUTH_KV, env.CREDENTIAL_ENCRYPTION_KEY);
      await credentialStore.store(tokenId, storedCredentials);

      // Complete OAuth authorization
      const props: OAuthProps = {
        tokenId,
        staffId: validationResult.staffId,
        staffEmail: email,
        accountName,
        region,
      };

      const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
        request: oauthReq,
        userId: tokenId,
        metadata: { staffName: validationResult.staffName, accountName },
        scope: requestedScopes,
        props,
      });

      return Response.redirect(redirectTo, 302);
    }

    return new Response('Method Not Allowed', { status: 405 });
  } catch (error) {
    console.error('Authorization error:', error);
    return new Response(
      renderErrorPage('Error', 'An unexpected error occurred.'),
      { status: 500, headers: { 'Content-Type': 'text/html' } }
    );
  }
}

function consentErrorResponse(
  clientInfo: ClientInfo,
  requestedScopes: string[],
  error: string,
  formData: { accountName: string; email: string; region: string }
): Response {
  return new Response(renderConsentPage({
    clientName: clientInfo.clientName || clientInfo.clientId,
    clientUri: clientInfo.clientUri,
    logoUri: clientInfo.logoUri,
    requestedScopes,
    error,
    formData,
  }), { status: 400, headers: { 'Content-Type': 'text/html' } });
}

/**
 * Handle /api/validate-staff endpoint for real-time email validation
 */
async function handleValidateStaff(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      accountName?: string;
      apiKey?: string;
      authCode?: string;
      region?: string;
      email?: string;
    };

    const { accountName, apiKey, authCode, region, email } = body;

    // Validate required fields
    if (!accountName || !apiKey || !authCode || !email) {
      return Response.json({ valid: false, error: 'Missing required fields' }, { status: 400 });
    }

    // Validate account name format (SSRF prevention)
    if (!ACCOUNT_NAME_PATTERN.test(accountName)) {
      return Response.json({ valid: false, error: 'Invalid account format' }, { status: 400 });
    }

    const validRegion = region === 'eu' ? 'eu' : 'us';
    const result = await validateAndResolveStaff(
      { apiKey, authCode, accountName, region: validRegion },
      email
    );

    return Response.json({
      valid: result.valid,
      staffName: result.staffName,
      error: result.error,
    });
  } catch {
    return Response.json({ valid: false, error: 'Invalid request' }, { status: 400 });
  }
}

// Export the OAuth provider as the default handler
export default new OAuthProvider({
  apiRoute: '/mcp',
  apiHandler: new McpApiHandler(),
  defaultHandler,
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/oauth/token',
  scopesSupported: AVAILABLE_SCOPES,
  refreshTokenTTL: 90 * 24 * 60 * 60, // 90 days
});
