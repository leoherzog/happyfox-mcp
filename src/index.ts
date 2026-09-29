/**
 * HappyFox MCP Adapter - Cloudflare Worker Entry Point
 * MCP 2026-07-28 Streamable HTTP Transport with OAuth 2.0 Authentication
 */

import { env as workerEnv } from 'cloudflare:workers';
import { OAuthProvider } from '@cloudflare/workers-oauth-provider';
import type {
  OAuthHelpers,
  AuthRequest,
  ClientInfo,
  CompleteAuthorizationOptions,
} from '@cloudflare/workers-oauth-provider';
import {
  Env,
  AuthContext,
  HappyFoxAuth,
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
  CredentialsRejectedError,
  isSupportedMethod,
  type UnsupportedProtocolVersionData,
} from './types';
import { MCPServer } from './mcp/server';
import { CORSMiddleware } from './middleware/cors';
import { decodeMcpHeaderValue, HeaderValueError } from './mcp/headers';
import { renderConsentPage, renderErrorPage } from './oauth/views/consent';
import { renderHomePage } from './views/home';
import { validateAndResolveStaff, permissionWarnings } from './oauth/services/happyfox-validator';
import { CredentialStore, decodeEncryptionKey, storedAuth } from './oauth/services/credential-store';
import { revalidateOnRefresh } from './oauth/services/grant-revalidation';
import { ACCOUNT_NAME_PATTERN, isRegion, parseApiHost } from './happyfox/host';
import {
  AVAILABLE_SCOPES,
  DEFAULT_SCOPES,
  StoredCredentials,
  CREDENTIAL_TTL_SECONDS,
  HappyFoxScope,
  OAuthProps,
} from './oauth/types';

const INVALID_API_HOST_MESSAGE =
  'Enter the custom domain as a host name only, such as support.example.com, without https://, a port or a path.';

/**
 * Extended environment with OAuth provider helpers
 */
interface EnvWithOAuth extends Env {
  OAUTH_PROVIDER: OAuthHelpers;
}

/**
 * Build AuthContext from OAuth props by retrieving stored credentials
 */
async function buildAuthContext(
  props: OAuthProps,
  env: Env
): Promise<AuthContext> {
  const credentialStore = new CredentialStore(env.OAUTH_KV, env.CREDENTIAL_ENCRYPTION_KEY);
  const storedCreds = await credentialStore.retrieve(props.tokenId);

  if (!storedCreds) {
    throw new Error('Credentials not found or expired');
  }

  return {
    // Throws for a region, account or host that consent would reject, so a crafted record
    // can never reach a request URL or a reference-cache key.
    credentials: storedAuth(storedCreds),
    staffId: storedCreds.staffId,
    scopes: props.scopes || [],
  };
}

/**
 * MCP API Handler - processes authenticated MCP requests.
 *
 * MCP 2026-07-28 is stateless: `Mcp-Session-Id` and `Last-Event-ID` are never read, minted or
 * echoed - inbound copies are ignored, not rejected. Do not re-introduce them.
 * env/ctx are 'any' to satisfy OAuthProvider's handler type; it adds `props` at runtime.
 * Exported so tests can drive the pipeline directly (the provider answers 401 first).
 */
export class McpApiHandler {
  async fetch(
    request: Request,
    env: any,
    ctx: any
  ): Promise<Response> {
    const typedEnv = env as Env;
    const typedCtx = ctx as ExecutionContext & { props: OAuthProps; scopes: string[] };

    // 1. Checked before anything else so a misconfigured server answers 500, not 401.
    if (!decodeEncryptionKey(typedEnv.CREDENTIAL_ENCRYPTION_KEY)) {
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

    // 4. POST only: no SSE stream (GET) and no session termination (DELETE).
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

    // 10. No id means a notification: this revision defines none, so do no work and 202.
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

    // 14/15. Mcp-Method must be present and match the body method exactly (values are case-sensitive).
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

      // A missing/non-string mirrored body field is a schema failure: -32602.
      // -32020 is reserved for a header that disagrees with a body value that is there.
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

    // 26. Build AuthContext. The bearer token was valid but its credentials are gone,
    //     so the token is unusable: RFC 6750 `invalid_token` plus the resource_metadata
    //     pointer the client needs to re-authorize.
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

    // 27. Dispatch. Everything the protocol layer returns is HTTP 200, including
    //     application-level -32602. Only two failures throw: a scope failure is HTTP 403
    //     with an `insufficient_scope` challenge naming the scopes required, and a HappyFox
    //     401 ends the grant and is HTTP 401 with an `invalid_token` challenge.
    const mcpServer = new MCPServer(authContext);
    let response: MCPResponse;
    try {
      response = await mcpServer.handleRequest(body as unknown as MCPRequest);
    } catch (error) {
      if (error instanceof CredentialsRejectedError) {
        await this.endGrant(env, typedCtx.props.tokenId);
        return this.jsonRpcError(
          UNAUTHORIZED,
          'Unauthorized: HappyFox rejected the stored API key and auth code. Please re-authorize with a working key.',
          id,
          401,
          corsHeaders,
          undefined,
          { 'WWW-Authenticate': this.bearerChallenge(request, 'invalid_token', 'HappyFox rejected the stored API key and auth code') }
        );
      }
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
   * End a grant whose HappyFox credentials were rejected: delete the stored credentials, so its
   * access tokens fail step 26 and its refresh fails revalidation, then revoke the OAuth grant.
   * Consent makes the tokenId the grant's userId, and a tokenId is minted per consent, so this
   * revokes only the grant that made the request. Failures are logged, never thrown.
   */
  private async endGrant(env: Partial<EnvWithOAuth>, tokenId: string): Promise<void> {
    try {
      await new CredentialStore(env.OAUTH_KV!, env.CREDENTIAL_ENCRYPTION_KEY!).delete(tokenId);
    } catch (error) {
      console.error('Failed to delete rejected credentials:', error);
    }

    const provider = env.OAUTH_PROVIDER;
    if (!provider) return;
    try {
      const { items } = await provider.listUserGrants(tokenId);
      await Promise.all(items.map(grant => provider.revokeGrant(grant.id, tokenId)));
    } catch (error) {
      console.error('Failed to revoke grant with rejected credentials:', error);
    }
  }

  /**
   * RFC 6750 §3 Bearer challenge. `resource_metadata` (RFC 9728 §5.1) names the same
   * path-suffixed document the OAuth provider uses on its own 401s, so a client can
   * reuse what it discovered. Quotes and control chars are stripped from free text.
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
   * Read a JSON-RPC id that is safe to echo. Undefined when absent or not a
   * string/number; the `id` member is then omitted entirely (never sent as null).
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
}

/**
 * Default Handler - non-API requests (home page, consent flow).
 * env is 'any' to satisfy OAuthProvider's generic handler type.
 */
const defaultHandler = {
  async fetch(request: Request, env: any): Promise<Response> {
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

    // OAuthProvider answers the /.well-known/* discovery documents (including the RFC 9728
    // path-suffixed variants) before delegating here, so there is nothing to route for them.

    if (url.pathname === '/authorize') {
      return handleAuthorize(request, typedEnv);
    }

    if (url.pathname === '/api/validate-staff' && request.method === 'POST') {
      return handleValidateStaff(request);
    }

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

/** True when `token` is non-empty and equals the request's `csrf_token` cookie. */
async function csrfTokenMatches(request: Request, token: string): Promise<boolean> {
  const cookie = /(?:^|;\s*)csrf_token=([^;]+)/.exec(request.headers.get('Cookie') ?? '')?.[1] ?? '';
  return token !== '' && cookie !== '' && await timingSafeCompare(token, cookie);
}

/**
 * Handle /authorize endpoint
 */
async function handleAuthorize(request: Request, env: EnvWithOAuth): Promise<Response> {
  try {
    const oauthReq: AuthRequest = await env.OAUTH_PROVIDER.parseAuthRequest(request);

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
          // Path=/ so /api/validate-staff receives it too.
          'Set-Cookie': `csrf_token=${csrfToken}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=600`,
        }
      });
    }

    if (request.method === 'POST') {
      const formData = await request.formData();

      const csrfToken = formField(formData, 'csrf_token');
      if (!(await csrfTokenMatches(request, csrfToken))) {
        return new Response(
          renderErrorPage('Invalid Request', 'CSRF token validation failed. Please try again.'),
          { status: 400, headers: { 'Content-Type': 'text/html' } }
        );
      }

      const accountName = formField(formData, 'account_name').trim();
      const apiKey = formField(formData, 'api_key');
      const authCode = formField(formData, 'auth_code');
      const email = formField(formData, 'email').trim();
      const rawRegion = formField(formData, 'region') || 'us';
      const rawApiHost = formField(formData, 'api_host').trim();
      const echo = { accountName, email, region: isRegion(rawRegion) ? rawRegion : 'us', apiHost: rawApiHost };
      // The re-rendered form keeps the token, so the next submit and the live email check still pass.
      const fail = (message: string) => consentErrorResponse(clientInfo, requestedScopes, message, echo, csrfToken);

      // Docs/360 names exactly two hosted regions; anything else is refused, never defaulted.
      if (!isRegion(rawRegion)) {
        return fail('Choose the US or EU region.');
      }
      if (!ACCOUNT_NAME_PATTERN.test(accountName)) {
        return fail('Invalid account subdomain format.');
      }
      const apiHost = rawApiHost ? parseApiHost(rawApiHost) : undefined;
      if (apiHost === null) {
        return fail(INVALID_API_HOST_MESSAGE);
      }
      if (!apiKey || !authCode || !email) {
        return fail('Account subdomain, API key, auth code and staff email are required.');
      }

      const credentials: HappyFoxAuth = {
        apiKey, authCode, accountName, region: rawRegion,
        ...(apiHost !== undefined && { apiHost }),
      };
      const validationResult = await validateAndResolveStaff(credentials, email);

      if (!validationResult.valid || !validationResult.staffId || !validationResult.staffName) {
        return fail(validationResult.error || 'Validation failed.');
      }

      const tokenId = crypto.randomUUID();
      const now = Math.floor(Date.now() / 1000);
      const storedCredentials: StoredCredentials = {
        ...credentials,
        staffId: validationResult.staffId,
        staffName: validationResult.staffName,
        staffEmail: email,
        expiresAt: now + CREDENTIAL_TTL_SECONDS,
      };

      const credentialStore = new CredentialStore(env.OAUTH_KV, env.CREDENTIAL_ENCRYPTION_KEY);
      await credentialStore.store(tokenId, storedCredentials);

      const props: OAuthProps = { tokenId, scopes: requestedScopes };

      // The resource parameter is passed through untouched: as of library v0.4.0,
      // audience checks parse the URI and treat a bare "/" path as covering the origin,
      // so the RFC 8707 binding survives the trailing slash that MCP clients send.
      const authorization: CompleteAuthorizationOptions = {
        request: oauthReq,
        userId: tokenId,
        metadata: {}, // required by the library; nothing here reads it back
        scope: requestedScopes,
        props,
      };

      const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization(authorization);

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

/** A text field of a submitted form; '' when it is absent or a file. */
function formField(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

function consentErrorResponse(
  clientInfo: ClientInfo,
  requestedScopes: string[],
  error: string,
  formData: { accountName: string; email: string; region: string; apiHost: string },
  csrfToken: string
): Response {
  return new Response(renderConsentPage({
    clientName: clientInfo.clientName || clientInfo.clientId,
    clientUri: clientInfo.clientUri,
    logoUri: clientInfo.logoUri,
    requestedScopes,
    error,
    formData,
    csrfToken,
  }), { status: 400, headers: { 'Content-Type': 'text/html' } });
}

/**
 * Handle /api/validate-staff: real-time email validation for the consent form.
 * Takes the form's fields plus the requested `scopes`, and answers `warnings` for tools
 * those scopes expose that the agent's HappyFox role cannot use.
 * Requires the consent page's CSRF token in `X-CSRF-Token`; a cross-origin page can neither read
 * the token nor send the header, which needs a preflight this route never grants.
 */
async function handleValidateStaff(request: Request): Promise<Response> {
  if (!(await csrfTokenMatches(request, request.headers.get('X-CSRF-Token') ?? ''))) {
    return Response.json({ valid: false, error: 'Reload the consent page and try again.' }, { status: 403 });
  }

  try {
    const body = await request.json() as Record<string, unknown>;
    const { accountName, apiKey, authCode, email } = body;

    if (
      typeof accountName !== 'string' || typeof apiKey !== 'string' ||
      typeof authCode !== 'string' || typeof email !== 'string' ||
      !accountName || !apiKey || !authCode || !email
    ) {
      return Response.json({ valid: false, error: 'Missing required fields' }, { status: 400 });
    }

    // Validate account name format (SSRF prevention)
    if (!ACCOUNT_NAME_PATTERN.test(accountName)) {
      return Response.json({ valid: false, error: 'Invalid account format' }, { status: 400 });
    }

    const region = body.region === undefined || body.region === '' ? 'us' : body.region;
    if (!isRegion(region)) {
      return Response.json({ valid: false, error: 'Invalid region' }, { status: 400 });
    }

    const rawApiHost = body.apiHost === undefined || body.apiHost === '' ? undefined : body.apiHost;
    const apiHost = rawApiHost === undefined ? undefined : parseApiHost(rawApiHost);
    if (apiHost === null) {
      return Response.json({ valid: false, error: INVALID_API_HOST_MESSAGE }, { status: 400 });
    }

    const result = await validateAndResolveStaff(
      { apiKey, authCode, accountName, region, ...(apiHost !== undefined && { apiHost }) },
      email
    );
    const scopes = Array.isArray(body.scopes) ? body.scopes.filter((s): s is string => typeof s === 'string') : [];

    return Response.json({
      valid: result.valid,
      staffName: result.staffName,
      error: result.error,
      warnings: result.valid ? permissionWarnings(scopes, result.permissions) : [],
    });
  } catch {
    return Response.json({ valid: false, error: 'Invalid request' }, { status: 400 });
  }
}

const oauthProvider = new OAuthProvider({
  apiRoute: '/mcp',
  apiHandler: new McpApiHandler(),
  defaultHandler,
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/oauth/token',
  scopesSupported: AVAILABLE_SCOPES,
  refreshTokenTTL: 90 * 24 * 60 * 60, // 90 days (library default is 30)

  // Every refresh re-reads the consenting agent, so this bounds how long a deactivated agent or
  // a disabled API key keeps working. The callback gets no env, hence the module-level import.
  accessTokenTTL: 60 * 60,
  tokenExchangeCallback: (options) => revalidateOnRefresh(options, workerEnv as Env),

  // Clients identify themselves with a Client ID Metadata Document URL. Opt-in since
  // v0.3.0; requires the 'global_fetch_strictly_public' compatibility flag.
  clientIdMetadataDocumentEnabled: true,

  // handleAuthorize already rejects anything but S256; this makes the library agree.
  allowPlainPKCE: false,

  // One resource on one origin, so origin matching is as strong as exact-string matching
  // and tolerates a client that sends `https://host/` then `https://host/mcp`.
  resourceMatchOriginOnly: true,
});

/**
 * Public discovery documents are identical for every caller and the library sets no
 * Cache-Control of its own, so they are safe to cache at the edge.
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
 * Workers Cache sits in front of this Worker (see `cache` in wrangler.jsonc), so caching is
 * opt-in: a response is cached only when it sets its own Cache-Control or is a successful
 * read of a public discovery document. Everything else is no-store, so a user-specific
 * response can never be served to someone else from the edge.
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
