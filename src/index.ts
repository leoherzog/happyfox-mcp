/**
 * HappyFox MCP Adapter - Cloudflare Worker Entry Point
 * MCP 2025-11-25 Streamable HTTP Transport
 */

import { Env, HappyFoxAuth, MCPMessage, MCPResponse, MCP_PROTOCOL_VERSION } from './types';
import { MCPServer } from './mcp/server';
import { CORSMiddleware } from './middleware/cors';
import { SessionTokenManager } from './session/token';

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    // 0. Validate MCP_SESSION_SECRET is configured (fail fast)
    if (!env.MCP_SESSION_SECRET || env.MCP_SESSION_SECRET.length < 32) {
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal error: Server misconfigured. MCP_SESSION_SECRET must be set (minimum 32 characters).'
        },
        id: null
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const corsMiddleware = new CORSMiddleware(env.ALLOWED_ORIGINS);
    const origin = request.headers.get('Origin');

    // 1. Origin validation (MCP 2025-11-25: MUST return 403 for invalid)
    if (!corsMiddleware.isOriginValid(origin)) {
      return corsMiddleware.handleInvalidOrigin();
    }

    const corsHeaders = corsMiddleware.getCORSHeaders(origin);

    // 2. Handle OPTIONS preflight
    if (request.method === 'OPTIONS') {
      return corsMiddleware.handlePreflight(origin);
    }

    // 3. Handle GET (SSE streaming - not implemented)
    if (request.method === 'GET') {
      return new Response('SSE streaming not supported', {
        status: 405,
        headers: {
          ...corsHeaders,
          'Allow': 'POST, OPTIONS, DELETE'
        }
      });
    }

    // 4. Handle DELETE (session termination - acknowledge with 202)
    if (request.method === 'DELETE') {
      return new Response(null, {
        status: 202,
        headers: corsHeaders
      });
    }

    // 5. Only POST allowed from here
    if (request.method !== 'POST') {
      return new Response('Method not allowed', {
        status: 405,
        headers: {
          ...corsHeaders,
          'Allow': 'POST, OPTIONS, DELETE'
        }
      });
    }

    // 6. Parse request body
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        error: {
          code: -32700,
          message: 'Parse error: Invalid JSON'
        },
        id: null
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // 7. MCP 2025-11-25: Reject batch requests (single message per POST)
    if (Array.isArray(rawBody)) {
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        error: {
          code: -32600,
          message: 'Invalid Request: Batch requests not supported in Streamable HTTP transport. Send single messages per request.'
        },
        id: null
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // 8. Validate JSON-RPC 2.0 structure
    if (!rawBody || typeof rawBody !== 'object' || (rawBody as Record<string, unknown>).jsonrpc !== '2.0') {
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        error: {
          code: -32600,
          message: 'Invalid Request: Missing or invalid jsonrpc field'
        },
        id: (rawBody && typeof rawBody === 'object' && 'id' in rawBody) ? (rawBody as Record<string, unknown>).id : null
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // 8a. Validate method field exists and is a string (JSON-RPC 2.0 requirement)
    const body = rawBody as Record<string, unknown>;
    if (typeof body.method !== 'string' || body.method.length === 0) {
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        error: {
          code: -32600,
          message: 'Invalid Request: Missing or invalid method field'
        },
        id: 'id' in body ? body.id : null
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    const message = rawBody as MCPMessage;
    const isInitialize = message.method === 'initialize';

    // 9. Validate MCP headers for non-initialize requests (MCP 2025-11-25 Streamable HTTP)
    if (!isInitialize) {
      // Validate MCP-Protocol-Version header
      const protocolVersionHeader = request.headers.get('MCP-Protocol-Version');
      if (!protocolVersionHeader) {
        return new Response(JSON.stringify({
          jsonrpc: '2.0',
          error: {
            code: -32600,
            message: 'Invalid Request: MCP-Protocol-Version header required for Streamable HTTP transport.'
          },
          id: 'id' in message ? message.id : null
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      if (protocolVersionHeader !== MCP_PROTOCOL_VERSION) {
        return new Response(JSON.stringify({
          jsonrpc: '2.0',
          error: {
            code: -32602,
            message: `Unsupported protocol version: ${protocolVersionHeader}. This server only supports ${MCP_PROTOCOL_VERSION}.`
          },
          id: 'id' in message ? message.id : null
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      // Validate Accept header includes required content types
      // MCP 2025-11-25: Client MUST include Accept header with both application/json and text/event-stream
      const acceptHeader = request.headers.get('Accept') || '';
      const hasJson = acceptHeader.includes('application/json') || acceptHeader.includes('*/*');
      const hasSSE = acceptHeader.includes('text/event-stream') || acceptHeader.includes('*/*');
      if (!hasJson || !hasSSE) {
        return new Response(JSON.stringify({
          jsonrpc: '2.0',
          error: {
            code: -32600,
            message: 'Invalid Request: Accept header must include both application/json and text/event-stream for Streamable HTTP transport.'
          },
          id: 'id' in message ? message.id : null
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      // Validate Content-Type header
      const contentType = request.headers.get('Content-Type');
      if (!contentType || !contentType.includes('application/json')) {
        return new Response(JSON.stringify({
          jsonrpc: '2.0',
          error: {
            code: -32600,
            message: 'Invalid Request: Content-Type header must be application/json'
          },
          id: 'id' in message ? message.id : null
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // 10. Session validation (skip for initialize)
    if (!isInitialize) {
      const sessionId = request.headers.get('MCP-Session-Id');

      if (!sessionId) {
        return new Response(JSON.stringify({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Bad Request: MCP-Session-Id header required. Call initialize first to obtain a session.'
          },
          id: 'id' in message ? message.id : null
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      // Validate session token
      const tokenManager = new SessionTokenManager(env.MCP_SESSION_SECRET);
      const validation = await tokenManager.validateToken(sessionId);

      if (!validation.valid) {
        const statusCode = validation.error === 'expired' || validation.error === 'invalid' ? 404 : 400;
        const errorMessage = validation.error === 'expired'
          ? 'Session expired. Please re-initialize.'
          : validation.error === 'invalid'
          ? 'Invalid session. Please re-initialize.'
          : 'Malformed session token.';

        return new Response(JSON.stringify({
          jsonrpc: '2.0',
          error: {
            code: -32001,
            message: errorMessage
          },
          id: 'id' in message ? message.id : null
        }), {
          status: statusCode,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // 11. Extract and validate authentication from HTTP headers
    const regionHeader = request.headers.get('X-HappyFox-Region');
    if (regionHeader && regionHeader !== 'us' && regionHeader !== 'eu') {
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        error: {
          code: -32602,
          message: "Invalid params: X-HappyFox-Region must be 'us' or 'eu'"
        },
        id: 'id' in message ? message.id : null
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // SECURITY: Validate account name to prevent SSRF attacks
    // Account names must be valid subdomains: alphanumeric with hyphens, no consecutive hyphens
    const accountName = request.headers.get('X-HappyFox-Account') || '';
    const ACCOUNT_NAME_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i;
    if (accountName && (!ACCOUNT_NAME_PATTERN.test(accountName) || accountName.includes('--'))) {
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        error: {
          code: -32602,
          message: 'Invalid params: X-HappyFox-Account must be a valid subdomain (alphanumeric and hyphens only, no consecutive hyphens)'
        },
        id: 'id' in message ? message.id : null
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    const auth: HappyFoxAuth = {
      apiKey: request.headers.get('X-HappyFox-ApiKey') || '',
      authCode: request.headers.get('X-HappyFox-AuthCode') || '',
      accountName: accountName,
      region: (regionHeader as 'us' | 'eu') || 'us'
    };

    // 12. Process the message
    const mcpServer = new MCPServer(auth);
    const response = await mcpServer.handleMessage(message);

    // 13. Handle notifications (no response body)
    // MCP 2025-11-25: MUST return 202 Accepted for notifications
    if (response === null) {
      return new Response(null, {
        status: 202,
        headers: corsHeaders
      });
    }

    // 14. Build response headers
    const responseHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...corsHeaders
    };

    // 15. Add session ID to initialize response
    if (isInitialize && response.result) {
      const tokenManager = new SessionTokenManager(env.MCP_SESSION_SECRET);
      const capabilities = Object.keys(response.result.capabilities || {});
      const sessionToken = await tokenManager.createToken(MCP_PROTOCOL_VERSION, capabilities);
      responseHeaders['MCP-Session-Id'] = sessionToken;
    }

    return new Response(JSON.stringify(response), {
      headers: responseHeaders
    });
  }
};
