/**
 * OAuth Metadata Handlers
 *
 * Implements well-known endpoints for OAuth server discovery:
 * - /.well-known/oauth-authorization-server (RFC 8414)
 * - /.well-known/oauth-protected-resource (RFC 9728)
 */

import { Env } from '../../types';
import { AVAILABLE_SCOPES } from '../types';

/**
 * Get the issuer URL from the request
 */
function getIssuer(request: Request, env: Env): string {
  // Use RESOURCE_IDENTIFIER if configured, otherwise derive from request
  if (env.RESOURCE_IDENTIFIER) {
    return env.RESOURCE_IDENTIFIER;
  }

  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

/**
 * Handle GET /.well-known/oauth-authorization-server
 *
 * Returns OAuth Authorization Server Metadata per RFC 8414
 */
export function handleAuthServerMetadata(request: Request, env: Env): Response {
  const issuer = getIssuer(request, env);

  const metadata = {
    // Required fields
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/oauth/token`,

    // Recommended fields
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: AVAILABLE_SCOPES,

    // Token endpoint authentication methods
    token_endpoint_auth_methods_supported: ['none'],

    // Additional metadata
    ui_locales_supported: ['en'],
  };

  return new Response(JSON.stringify(metadata, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
    },
  });
}

/**
 * Handle GET /.well-known/oauth-protected-resource
 *
 * Returns Protected Resource Metadata per RFC 9728
 */
export function handleProtectedResourceMetadata(request: Request, env: Env): Response {
  const issuer = getIssuer(request, env);

  const metadata = {
    // Resource identifier
    resource: issuer,

    // Authorization servers that can issue tokens for this resource
    authorization_servers: [issuer],

    // Scopes required/supported by this resource
    scopes_supported: AVAILABLE_SCOPES,

    // Bearer token methods supported
    bearer_methods_supported: ['header'],
  };

  return new Response(JSON.stringify(metadata, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
    },
  });
}

/**
 * Route well-known requests to appropriate handler
 */
export function handleWellKnown(request: Request, env: Env): Response | null {
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  switch (path) {
    case '/.well-known/oauth-authorization-server':
      return handleAuthServerMetadata(request, env);

    case '/.well-known/oauth-protected-resource':
      return handleProtectedResourceMetadata(request, env);

    default:
      return null; // Not a well-known endpoint we handle
  }
}
