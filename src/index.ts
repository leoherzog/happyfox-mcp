/**
 * HappyFox MCP Adapter - Cloudflare Worker Entry Point
 * MCP 2026-07-28 Streamable HTTP Transport with OAuth 2.0 Authentication
 */

import { OAuthProvider } from '@cloudflare/workers-oauth-provider';
import {
  Env,
  AuthContext,
  MCPRequest,
  MCPResponse,
  MCP_PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
  SUPPORTED_METHODS,
  METHODS_REQUIRING_MCP_NAME,
  META_PROTOCOL_VERSION,
  META_CLIENT_CAPABILITIES,
  PARSE_ERROR,
  INVALID_REQUEST,
  METHOD_NOT_FOUND,
  INVALID_PARAMS,
  INTERNAL_ERROR,
  HEADER_MISMATCH,
  UNSUPPORTED_PROTOCOL_VERSION,
  UNAUTHORIZED,
  INSUFFICIENT_SCOPE,
  InsufficientScopeError,
  isSupportedMethod,
  type UnsupportedProtocolVersionData,
} from './types';
import { MCPServer } from './mcp/server';
import { CORSMiddleware } from './middleware/cors';
import { decodeMcpHeaderValue, HeaderValueError } from './mcp/headers';
import { renderConsentPage, renderErrorPage } from './oauth/views/consent';
import { renderHomePage } from './views/home';
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
  scopes: string[]; // Include scopes since library only passes props to handler
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
  resource?: string | string[]; // RFC 8707 allows repeating the parameter
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
    scopes: props.scopes || [], // Get scopes from props (library only passes props to handler)
    tokenId: props.tokenId,
  };
}

/**
 * MCP API Handler - Processes authenticated MCP requests
 *
 * MCP 2026-07-28 is stateless. `Mcp-Session-Id` and `Last-Event-ID` are never read,
 * never minted and never echoed - inbound copies are ignored, not rejected. Do not
 * re-introduce them.
 *
 * Note: Uses 'any' for env/ctx types to satisfy OAuthProvider's generic handler type requirements.
 * The OAuth provider adds 'props' and 'scopes' to the ctx object at runtime.
 *
 * Exported so the validation pipeline can be exercised directly in tests (the OAuth
 * provider answers 401 before the handler runs, so integration tests cannot reach it).
 */
export class McpApiHandler {
  async fetch(
    request: Request,
    env: any,
    ctx: any
  ): Promise<Response> {
    const typedEnv = env as Env;
    const typedCtx = ctx as ExecutionContext & { props: OAuthProps; scopes: string[] };

    // 1. Validate CREDENTIAL_ENCRYPTION_KEY (must be valid 32-byte base64 for AES-256-GCM)
    if (!this.isValidEncryptionKey(typedEnv.CREDENTIAL_ENCRYPTION_KEY)) {
      return this.jsonRpcError(INTERNAL_ERROR, 'Internal error: Server misconfigured.', undefined, 500);
    }

    const corsMiddleware = new CORSMiddleware(typedEnv.ALLOWED_ORIGINS);
    const origin = request.headers.get('Origin');

    // 2. Origin validation - an absent Origin is allowed (non-browser clients)
    if (!corsMiddleware.isOriginValid(origin)) {
      return corsMiddleware.handleInvalidOrigin();
    }

    const corsHeaders = corsMiddleware.getCORSHeaders(origin);

    // 3. Handle OPTIONS preflight
    if (request.method === 'OPTIONS') {
      return corsMiddleware.handlePreflight(origin);
    }

    // 4. POST is the only method this transport accepts. No SSE stream (GET), no
    //    session termination (DELETE) - both are gone with the session concept.
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed. This server implements MCP 2026-07-28 (POST only).', {
        status: 405,
        headers: { ...corsHeaders, 'Allow': 'POST, OPTIONS', 'Content-Type': 'text/plain' }
      });
    }

    // 5. Parse request body
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return this.jsonRpcError(PARSE_ERROR, 'Parse error: Invalid JSON', undefined, 400, corsHeaders);
    }

    // 6. Reject batch requests - one JSON-RPC message per POST
    if (Array.isArray(rawBody)) {
      return this.jsonRpcError(INVALID_REQUEST, 'Invalid Request: Batch requests are not supported.', undefined, 400, corsHeaders);
    }

    // 7. The body must be a single JSON-RPC object
    if (!rawBody || typeof rawBody !== 'object') {
      return this.jsonRpcError(INVALID_REQUEST, 'Invalid Request: Body must be a single JSON-RPC request object.', undefined, 400, corsHeaders);
    }

    const body = rawBody as Record<string, unknown>;
    const id = this.readId(body);

    // 8. jsonrpc envelope
    if (body.jsonrpc !== '2.0') {
      return this.jsonRpcError(INVALID_REQUEST, 'Invalid Request: Missing or invalid jsonrpc field', id, 400, corsHeaders);
    }

    // 9. method
    if (typeof body.method !== 'string' || body.method.length === 0) {
      return this.jsonRpcError(INVALID_REQUEST, 'Invalid Request: Missing or invalid method field', id, 400, corsHeaders);
    }
    const method = body.method;

    // 10. No id means a notification. This revision defines no client-to-server
    //     notifications, so accept it, do no work, and run no header validation.
    if (!('id' in body)) {
      return new Response(null, { status: 202, headers: corsHeaders });
    }

    // 11. Requests MUST carry a string or number id - unlike base JSON-RPC, null is invalid
    if (id === undefined) {
      return this.jsonRpcError(INVALID_REQUEST, 'Invalid Request: id must be a string or a number', undefined, 400, corsHeaders);
    }

    // 12. Accept header
    const acceptHeader = request.headers.get('Accept') || '';
    const hasJson = acceptHeader.includes('application/json') || acceptHeader.includes('*/*');
    const hasSSE = acceptHeader.includes('text/event-stream') || acceptHeader.includes('*/*');
    if (!hasJson || !hasSSE) {
      return this.jsonRpcError(INVALID_REQUEST, 'Invalid Request: Accept header must include application/json and text/event-stream.', id, 400, corsHeaders);
    }

    // 13. Content-Type header
    const contentType = request.headers.get('Content-Type');
    if (!contentType || !contentType.includes('application/json')) {
      return this.jsonRpcError(INVALID_REQUEST, 'Invalid Request: Content-Type must be application/json', id, 400, corsHeaders);
    }

    // 14/15. Mcp-Method must be present and match the body method exactly.
    //        Header names are case-insensitive; header values are case-sensitive.
    const mcpMethodHeader = request.headers.get('Mcp-Method');
    if (!mcpMethodHeader) {
      return this.jsonRpcError(HEADER_MISMATCH, `Header mismatch: Mcp-Method header is required. This server implements MCP ${MCP_PROTOCOL_VERSION} only.`, id, 400, corsHeaders);
    }
    if (mcpMethodHeader !== method) {
      return this.jsonRpcError(HEADER_MISMATCH, `Header mismatch: Mcp-Method header value '${mcpMethodHeader}' does not match body value '${method}'`, id, 400, corsHeaders);
    }

    // 16. MCP-Protocol-Version must be present
    const protocolVersionHeader = request.headers.get('MCP-Protocol-Version');
    if (!protocolVersionHeader) {
      return this.jsonRpcError(HEADER_MISMATCH, `Header mismatch: MCP-Protocol-Version header is required. This server implements MCP ${MCP_PROTOCOL_VERSION} only.`, id, 400, corsHeaders);
    }

    // 17. params and params._meta are structurally required on every request
    const params = this.asObject(body.params);
    const meta = params ? this.asObject(params._meta) : undefined;
    const metaProtocolVersion = meta ? meta[META_PROTOCOL_VERSION] : undefined;
    if (!params || !meta || typeof metaProtocolVersion !== 'string') {
      return this.jsonRpcError(INVALID_PARAMS, `Invalid params: params._meta['${META_PROTOCOL_VERSION}'] is required and must be a string`, id, 400, corsHeaders);
    }

    // 18. The header and the body must agree on the protocol version
    if (protocolVersionHeader !== metaProtocolVersion) {
      return this.jsonRpcError(HEADER_MISMATCH, `Header mismatch: MCP-Protocol-Version header value '${protocolVersionHeader}' does not match body value '${metaProtocolVersion}'`, id, 400, corsHeaders);
    }

    // 19. This server implements exactly one revision
    if (metaProtocolVersion !== MCP_PROTOCOL_VERSION) {
      return this.jsonRpcError(
        UNSUPPORTED_PROTOCOL_VERSION,
        `Unsupported protocol version: ${metaProtocolVersion}`,
        id,
        400,
        corsHeaders,
        {
          supported: [...SUPPORTED_PROTOCOL_VERSIONS],
          requested: metaProtocolVersion,
        } satisfies UnsupportedProtocolVersionData
      );
    }

    // 20. clientCapabilities is required; clientInfo is NOT - its absence is legal
    if (!this.asObject(meta[META_CLIENT_CAPABILITIES])) {
      return this.jsonRpcError(INVALID_PARAMS, `Invalid params: params._meta['${META_CLIENT_CAPABILITIES}'] is required and must be an object`, id, 400, corsHeaders);
    }

    // 21-24. Mcp-Name mirrors params.name / params.uri on the methods that carry one
    if (METHODS_REQUIRING_MCP_NAME.includes(method)) {
      const rawMcpName = request.headers.get('Mcp-Name');
      if (!rawMcpName) {
        return this.jsonRpcError(HEADER_MISMATCH, `Header mismatch: Mcp-Name header is required for ${method}`, id, 400, corsHeaders);
      }

      let decodedMcpName: string;
      try {
        decodedMcpName = decodeMcpHeaderValue(rawMcpName);
      } catch (error) {
        if (error instanceof HeaderValueError) {
          return this.jsonRpcError(HEADER_MISMATCH, error.message, id, 400, corsHeaders);
        }
        throw error;
      }

      // An absent or non-string mirrored body field is a malformed request
      // (it fails the CallToolRequest / ReadResourceRequest schema), which the
      // tools page classes as a protocol error: -32602, at HTTP 400 like every
      // other structurally invalid request. -32020 is reserved for a header
      // that disagrees with a body value that is actually there.
      const field = method === 'tools/call' ? 'name' : 'uri';
      const bodyValue = params[field];
      if (typeof bodyValue !== 'string' || bodyValue.length === 0) {
        return this.jsonRpcError(INVALID_PARAMS, `Invalid params: params.${field} is required and must be a non-empty string (Mcp-Name header was '${decodedMcpName}')`, id, 400, corsHeaders);
      }
      if (decodedMcpName !== bodyValue) {
        return this.jsonRpcError(HEADER_MISMATCH, `Header mismatch: Mcp-Name header value '${decodedMcpName}' does not match body value '${bodyValue}'`, id, 400, corsHeaders);
      }
    }

    // 25. Unknown RPC methods are 404 at the transport layer
    if (!isSupportedMethod(method)) {
      return this.jsonRpcError(
        METHOD_NOT_FOUND,
        `Method not found: ${method}. This server implements MCP ${MCP_PROTOCOL_VERSION} and supports: ${SUPPORTED_METHODS.join(', ')}.`,
        id,
        404,
        corsHeaders
      );
    }

    // 26. Build AuthContext from OAuth props. The bearer token itself was valid
    //     (the OAuth provider checked it) but the credentials behind it are gone,
    //     so the token can no longer be used: RFC 6750 `invalid_token`, with the
    //     resource_metadata pointer every 401 must carry so the client can re-authorize.
    let authContext: AuthContext;
    try {
      authContext = await buildAuthContext(typedCtx.props, typedEnv);
    } catch {
      return this.jsonRpcError(
        UNAUTHORIZED,
        'Unauthorized: stored credentials are missing or expired. Please re-authorize.',
        id,
        401,
        corsHeaders,
        undefined,
        { 'WWW-Authenticate': this.bearerChallenge(request, 'invalid_token', 'Stored credentials are missing or expired') }
      );
    }

    // 27. Dispatch. Everything the protocol layer returns - including application-level
    //     -32602 (unknown tool, unknown resource, bad cursor) - is HTTP 200. The one
    //     thing it throws is a scope failure, which is HTTP 403 with an
    //     `insufficient_scope` challenge naming the scopes the operation needs
    //     (authorization spec, "Runtime Insufficient Scope Errors").
    const mcpServer = new MCPServer(authContext);
    let response: MCPResponse;
    try {
      response = await mcpServer.handleRequest(body as unknown as MCPRequest);
    } catch (error) {
      if (error instanceof InsufficientScopeError) {
        return this.jsonRpcError(
          INSUFFICIENT_SCOPE,
          error.message,
          id,
          403,
          corsHeaders,
          { requiredScopes: error.requiredScopes },
          { 'WWW-Authenticate': this.bearerChallenge(request, 'insufficient_scope', error.message, error.requiredScopes) }
        );
      }
      throw error;
    }

    return new Response(JSON.stringify(response), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }

  /**
   * RFC 6750 §3 Bearer challenge. `resource_metadata` (RFC 9728 §5.1) uses the same
   * path-suffixed document the OAuth provider names on its own 401s, so a client
   * that discovered the authorization server from one challenge can reuse it from
   * the other. Quotes and control characters are stripped from free-text parameters.
   */
  private bearerChallenge(request: Request, error: string, description: string, scope?: string[]): string {
    const url = new URL(request.url);
    const resourceMetadata = `${url.origin}/.well-known/oauth-protected-resource${url.pathname}`;
    const quote = (value: string) => `"${value.replace(/["\\\x00-\x1f\x7f]/g, '')}"`;
    const parts = [
      'realm="OAuth"',
      `resource_metadata=${quote(resourceMetadata)}`,
      `error="${error}"`,
      `error_description=${quote(description)}`,
    ];
    if (scope && scope.length > 0) {
      parts.push(`scope=${quote(scope.join(' '))}`);
    }
    return `Bearer ${parts.join(', ')}`;
  }

  /**
   * Read a JSON-RPC id that is safe to echo. Returns undefined when the id is absent
   * or is not a string/number - the `id` member is then omitted from the error response
   * entirely (never sent as null).
   */
  private readId(body: Record<string, unknown>): string | number | undefined {
    const raw = body.id;
    return typeof raw === 'string' || typeof raw === 'number' ? raw : undefined;
  }

  /** Narrow a value to a plain (non-null, non-array) JSON object. */
  private asObject(value: unknown): Record<string, unknown> | undefined {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  }

  private jsonRpcError(
    code: number,
    message: string,
    id: string | number | undefined,
    status: number,
    corsHeaders: Record<string, string> = {},
    data?: unknown,
    extraHeaders: Record<string, string> = {}
  ): Response {
    const body: MCPResponse = {
      jsonrpc: '2.0',
      error: { code, message, ...(data !== undefined && { data }) },
      ...(id !== undefined && { id }),
    };
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', ...corsHeaders, ...extraHeaders }
    });
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
 * Default Handler - Handles non-API requests (home page, consent flow)
 * Note: Uses 'any' for env type to satisfy OAuthProvider's generic handler type requirements
 */
const defaultHandler = {
  async fetch(request: Request, env: any, ctx: ExecutionContext): Promise<Response> {
    const typedEnv = env as EnvWithOAuth;
    const url = new URL(request.url);

    // Handle the home page (read-only, safe to cache at the edge)
    if (url.pathname === '/') {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('Method Not Allowed', {
          status: 405,
          headers: { 'Allow': 'GET, HEAD', 'Cache-Control': 'no-store' }
        });
      }
      return new Response(renderHomePage(`${url.protocol}//${url.host}`), {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
        }
      });
    }

    // Note: /.well-known/oauth-authorization-server and /.well-known/oauth-protected-resource
    // (including the RFC 9728 path-suffixed variants) are answered by OAuthProvider before it
    // delegates here, so there is nothing to route for them.

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
 * Constant-time string comparison using SHA-256 hashing + timingSafeEqual.
 * Hashing both values to a fixed size prevents leaking length information.
 */
async function timingSafeCompare(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [hashA, hashB] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(a)),
    crypto.subtle.digest('SHA-256', encoder.encode(b)),
  ]);
  return crypto.subtle.timingSafeEqual(hashA, hashB);
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

      if (!formCsrfToken || !cookieCsrfToken || !(await timingSafeCompare(formCsrfToken, cookieCsrfToken))) {
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
        scopes: requestedScopes, // Include scopes in props since library only passes props to handler
      };

      // The resource parameter is passed through untouched: as of library v0.4.0,
      // audience checks parse the URI and treat a bare "/" path as covering the origin,
      // so the RFC 8707 binding survives the trailing slash that MCP clients send.
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

// Create the OAuth provider
const oauthProvider = new OAuthProvider({
  apiRoute: '/mcp',
  apiHandler: new McpApiHandler(),
  defaultHandler,
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/oauth/token',
  scopesSupported: AVAILABLE_SCOPES,
  refreshTokenTTL: 90 * 24 * 60 * 60, // 90 days (library default is 30)

  // Clients identify themselves with a Client ID Metadata Document URL. Opt-in since
  // v0.3.0; requires the 'global_fetch_strictly_public' compatibility flag.
  clientIdMetadataDocumentEnabled: true,

  // handleAuthorize already rejects anything but S256; this makes the library agree.
  allowPlainPKCE: false,

  // Compare RFC 8707 resource indicators by origin instead of exact string. This server
  // exposes a single resource on a single origin, so origin matching is equivalent in
  // strength, and it keeps a client that sends `https://host/` in one request and
  // `https://host/mcp` in the next from failing token exchange.
  resourceMatchOriginOnly: true,
});

/**
 * Public discovery documents: identical for every caller, so they are safe to serve from
 * the edge cache. The OAuth library answers these itself (including the RFC 9728 §3.1
 * path-suffixed variants) and sets no Cache-Control of its own.
 */
function edgeCacheControlFor(pathname: string): string | null {
  if (pathname === '/.well-known/oauth-authorization-server') {
    return 'public, max-age=3600';
  }
  if (
    pathname === '/.well-known/oauth-protected-resource' ||
    pathname.startsWith('/.well-known/oauth-protected-resource/')
  ) {
    return 'public, max-age=3600';
  }
  return null;
}

/**
 * Workers Cache sits in front of this Worker (see `cache` in wrangler.jsonc), so caching
 * is opt-in. A response is cached only if it sets its own Cache-Control (the home page
 * does) or is a successful read of a public discovery document. Everything else -
 * consent, OAuth, MCP - is marked no-store so it can never be served to another user
 * from the edge.
 */
function withCacheDefaults(request: Request, response: Response): Response {
  if (response.headers.has('Cache-Control')) {
    return response;
  }

  const isRead = request.method === 'GET' || request.method === 'HEAD';
  const cacheControl =
    (isRead && response.ok ? edgeCacheControlFor(new URL(request.url).pathname) : null) ?? 'no-store';

  const headers = new Headers(response.headers);
  headers.set('Cache-Control', cacheControl);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return withCacheDefaults(request, await oauthProvider.fetch(request, env, ctx));
  },
};
