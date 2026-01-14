/**
 * CORS Middleware for MCP 2025-11-25 Streamable HTTP
 * Handles origin validation and CORS headers
 */

export class CORSMiddleware {
  private allowedOrigins: string[];

  constructor(allowedOriginsString?: string) {
    if (allowedOriginsString) {
      this.allowedOrigins = allowedOriginsString.split(',').map(origin => origin.trim());
    } else {
      // Default allowed origins
      this.allowedOrigins = ['http://localhost:*', 'https://localhost:*'];
    }
  }

  /**
   * Check if an origin is valid (for MCP 2025-11-25 403 enforcement)
   * Returns true if origin is allowed or not present (same-origin/non-browser)
   */
  isOriginValid(origin: string | null): boolean {
    if (!origin) {
      // No origin header = same-origin request or non-browser client
      return true;
    }
    return this.isOriginAllowed(origin);
  }

  /**
   * Return 403 Forbidden response for invalid origins
   * Per MCP 2025-11-25 spec: MUST return 403 for invalid Origin
   */
  handleInvalidOrigin(): Response {
    return new Response('Forbidden: Invalid Origin', {
      status: 403,
      headers: { 'Content-Type': 'text/plain' }
    });
  }

  getCORSHeaders(origin?: string | null): Record<string, string> {
    const headers: Record<string, string> = {
      // MCP 2025-11-25: Support GET, POST, DELETE, OPTIONS
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      // MCP 2025-11-25 headers + OAuth Authorization header
      'Access-Control-Allow-Headers': [
        'Content-Type',
        'Accept',
        'Authorization',
        'MCP-Session-Id',
        'MCP-Protocol-Version',
        'Last-Event-ID'
      ].join(', '),
      // Expose MCP headers to browser
      'Access-Control-Expose-Headers': 'MCP-Session-Id, MCP-Protocol-Version',
      'Access-Control-Max-Age': '86400',
    };

    if (origin && this.isOriginAllowed(origin)) {
      headers['Access-Control-Allow-Origin'] = origin;
      headers['Access-Control-Allow-Credentials'] = 'true';
    } else if (this.allowedOrigins.includes('*')) {
      headers['Access-Control-Allow-Origin'] = '*';
    }

    return headers;
  }

  handlePreflight(origin?: string | null): Response {
    // Check if origin is valid first (per MCP 2025-11-25 spec)
    if (origin && !this.isOriginAllowed(origin) && !this.allowedOrigins.includes('*')) {
      return this.handleInvalidOrigin();
    }

    return new Response(null, {
      status: 204,
      headers: this.getCORSHeaders(origin)
    });
  }

  private isOriginAllowed(origin: string): boolean {
    return this.allowedOrigins.some(allowed => {
      if (allowed === '*') return true;
      if (allowed === origin) return true;

      // Handle wildcard port matching (e.g., http://localhost:*)
      if (allowed.includes(':*')) {
        const baseAllowed = allowed.replace(':*', '');
        const baseOrigin = origin.replace(/:\d+$/, '');
        return baseAllowed === baseOrigin;
      }

      return false;
    });
  }
}
