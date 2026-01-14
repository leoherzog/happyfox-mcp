import { describe, it, expect } from 'vitest';
import {
  handleAuthServerMetadata,
  handleProtectedResourceMetadata,
  handleWellKnown,
} from '../../../../src/oauth/handlers/metadata';
import { AVAILABLE_SCOPES } from '../../../../src/oauth/types';
import { Env } from '../../../../src/types';

// Helper to create mock request
function createRequest(url: string, method: string = 'GET'): Request {
  return new Request(url, { method });
}

// Helper to create mock env
function createEnv(overrides: Partial<Env> = {}): Env {
  return {
    MCP_SESSION_SECRET: 'test-secret-that-is-long-enough-32chars',
    ALLOWED_ORIGINS: 'http://localhost:*',
    OAUTH_KV: {} as KVNamespace,
    CREDENTIAL_ENCRYPTION_KEY: 'dGVzdC1lbmNyeXB0aW9uLWtleS0zMi1ieXRlcw==',
    ...overrides,
  } as Env;
}

describe('handleAuthServerMetadata', () => {
  describe('response format', () => {
    it('returns 200 status', () => {
      const request = createRequest('https://example.com/.well-known/oauth-authorization-server');
      const env = createEnv();
      const response = handleAuthServerMetadata(request, env);
      expect(response.status).toBe(200);
    });

    it('sets Content-Type to application/json', () => {
      const request = createRequest('https://example.com/.well-known/oauth-authorization-server');
      const env = createEnv();
      const response = handleAuthServerMetadata(request, env);
      expect(response.headers.get('Content-Type')).toBe('application/json');
    });

    it('sets Cache-Control header for 1 hour', () => {
      const request = createRequest('https://example.com/.well-known/oauth-authorization-server');
      const env = createEnv();
      const response = handleAuthServerMetadata(request, env);
      expect(response.headers.get('Cache-Control')).toBe('public, max-age=3600');
    });

    it('returns valid JSON', async () => {
      const request = createRequest('https://example.com/.well-known/oauth-authorization-server');
      const env = createEnv();
      const response = handleAuthServerMetadata(request, env);
      const body = await response.json();
      expect(body).toBeDefined();
      expect(typeof body).toBe('object');
    });
  });

  describe('issuer derivation', () => {
    it('uses RESOURCE_IDENTIFIER when set', async () => {
      const request = createRequest('https://example.com/.well-known/oauth-authorization-server');
      const env = createEnv({ RESOURCE_IDENTIFIER: 'https://custom-issuer.com' });
      const response = handleAuthServerMetadata(request, env);
      const body = await response.json() as any;
      expect(body.issuer).toBe('https://custom-issuer.com');
    });

    it('derives issuer from request URL when RESOURCE_IDENTIFIER not set', async () => {
      const request = createRequest('https://example.com/.well-known/oauth-authorization-server');
      const env = createEnv();
      const response = handleAuthServerMetadata(request, env);
      const body = await response.json() as any;
      expect(body.issuer).toBe('https://example.com');
    });

    it('handles different hosts', async () => {
      const request = createRequest('https://api.happyfox.com/.well-known/oauth-authorization-server');
      const env = createEnv();
      const response = handleAuthServerMetadata(request, env);
      const body = await response.json() as any;
      expect(body.issuer).toBe('https://api.happyfox.com');
    });

    it('handles http protocol', async () => {
      const request = createRequest('http://localhost:8787/.well-known/oauth-authorization-server');
      const env = createEnv();
      const response = handleAuthServerMetadata(request, env);
      const body = await response.json() as any;
      expect(body.issuer).toBe('http://localhost:8787');
    });
  });

  describe('metadata fields', () => {
    it('includes authorization_endpoint', async () => {
      const request = createRequest('https://example.com/.well-known/oauth-authorization-server');
      const env = createEnv();
      const response = handleAuthServerMetadata(request, env);
      const body = await response.json() as any;
      expect(body.authorization_endpoint).toBe('https://example.com/authorize');
    });

    it('includes token_endpoint', async () => {
      const request = createRequest('https://example.com/.well-known/oauth-authorization-server');
      const env = createEnv();
      const response = handleAuthServerMetadata(request, env);
      const body = await response.json() as any;
      expect(body.token_endpoint).toBe('https://example.com/oauth/token');
    });

    it('includes response_types_supported with code', async () => {
      const request = createRequest('https://example.com/.well-known/oauth-authorization-server');
      const env = createEnv();
      const response = handleAuthServerMetadata(request, env);
      const body = await response.json() as any;
      expect(body.response_types_supported).toEqual(['code']);
    });

    it('includes grant_types_supported', async () => {
      const request = createRequest('https://example.com/.well-known/oauth-authorization-server');
      const env = createEnv();
      const response = handleAuthServerMetadata(request, env);
      const body = await response.json() as any;
      expect(body.grant_types_supported).toContain('authorization_code');
      expect(body.grant_types_supported).toContain('refresh_token');
    });

    it('includes code_challenge_methods_supported with S256', async () => {
      const request = createRequest('https://example.com/.well-known/oauth-authorization-server');
      const env = createEnv();
      const response = handleAuthServerMetadata(request, env);
      const body = await response.json() as any;
      expect(body.code_challenge_methods_supported).toEqual(['S256']);
    });

    it('includes all AVAILABLE_SCOPES', async () => {
      const request = createRequest('https://example.com/.well-known/oauth-authorization-server');
      const env = createEnv();
      const response = handleAuthServerMetadata(request, env);
      const body = await response.json() as any;
      expect(body.scopes_supported).toEqual(AVAILABLE_SCOPES);
    });

    it('includes token_endpoint_auth_methods_supported', async () => {
      const request = createRequest('https://example.com/.well-known/oauth-authorization-server');
      const env = createEnv();
      const response = handleAuthServerMetadata(request, env);
      const body = await response.json() as any;
      expect(body.token_endpoint_auth_methods_supported).toContain('none');
    });

    it('includes ui_locales_supported', async () => {
      const request = createRequest('https://example.com/.well-known/oauth-authorization-server');
      const env = createEnv();
      const response = handleAuthServerMetadata(request, env);
      const body = await response.json() as any;
      expect(body.ui_locales_supported).toContain('en');
    });
  });
});

describe('handleProtectedResourceMetadata', () => {
  describe('response format', () => {
    it('returns 200 status', () => {
      const request = createRequest('https://example.com/.well-known/oauth-protected-resource');
      const env = createEnv();
      const response = handleProtectedResourceMetadata(request, env);
      expect(response.status).toBe(200);
    });

    it('sets Content-Type to application/json', () => {
      const request = createRequest('https://example.com/.well-known/oauth-protected-resource');
      const env = createEnv();
      const response = handleProtectedResourceMetadata(request, env);
      expect(response.headers.get('Content-Type')).toBe('application/json');
    });

    it('sets Cache-Control header for 1 hour', () => {
      const request = createRequest('https://example.com/.well-known/oauth-protected-resource');
      const env = createEnv();
      const response = handleProtectedResourceMetadata(request, env);
      expect(response.headers.get('Cache-Control')).toBe('public, max-age=3600');
    });
  });

  describe('metadata fields', () => {
    it('includes resource matching issuer', async () => {
      const request = createRequest('https://example.com/.well-known/oauth-protected-resource');
      const env = createEnv();
      const response = handleProtectedResourceMetadata(request, env);
      const body = await response.json() as any;
      expect(body.resource).toBe('https://example.com');
    });

    it('uses RESOURCE_IDENTIFIER for resource when set', async () => {
      const request = createRequest('https://example.com/.well-known/oauth-protected-resource');
      const env = createEnv({ RESOURCE_IDENTIFIER: 'https://custom-resource.com' });
      const response = handleProtectedResourceMetadata(request, env);
      const body = await response.json() as any;
      expect(body.resource).toBe('https://custom-resource.com');
    });

    it('includes authorization_servers array', async () => {
      const request = createRequest('https://example.com/.well-known/oauth-protected-resource');
      const env = createEnv();
      const response = handleProtectedResourceMetadata(request, env);
      const body = await response.json() as any;
      expect(Array.isArray(body.authorization_servers)).toBe(true);
      expect(body.authorization_servers).toContain('https://example.com');
    });

    it('includes scopes_supported', async () => {
      const request = createRequest('https://example.com/.well-known/oauth-protected-resource');
      const env = createEnv();
      const response = handleProtectedResourceMetadata(request, env);
      const body = await response.json() as any;
      expect(body.scopes_supported).toEqual(AVAILABLE_SCOPES);
    });

    it('includes bearer_methods_supported', async () => {
      const request = createRequest('https://example.com/.well-known/oauth-protected-resource');
      const env = createEnv();
      const response = handleProtectedResourceMetadata(request, env);
      const body = await response.json() as any;
      expect(body.bearer_methods_supported).toContain('header');
    });
  });
});

describe('handleWellKnown', () => {
  describe('routing', () => {
    it('routes to auth server metadata for correct path', () => {
      const request = createRequest('https://example.com/.well-known/oauth-authorization-server');
      const env = createEnv();
      const response = handleWellKnown(request, env);
      expect(response).not.toBeNull();
      expect(response!.status).toBe(200);
    });

    it('routes to protected resource metadata for correct path', () => {
      const request = createRequest('https://example.com/.well-known/oauth-protected-resource');
      const env = createEnv();
      const response = handleWellKnown(request, env);
      expect(response).not.toBeNull();
      expect(response!.status).toBe(200);
    });

    it('returns null for unknown paths', () => {
      const request = createRequest('https://example.com/.well-known/unknown-endpoint');
      const env = createEnv();
      const response = handleWellKnown(request, env);
      expect(response).toBeNull();
    });

    it('returns null for non-well-known paths', () => {
      const request = createRequest('https://example.com/some-other-path');
      const env = createEnv();
      const response = handleWellKnown(request, env);
      expect(response).toBeNull();
    });
  });

  describe('method validation', () => {
    it('returns 405 for POST requests', () => {
      const request = createRequest('https://example.com/.well-known/oauth-authorization-server', 'POST');
      const env = createEnv();
      const response = handleWellKnown(request, env);
      expect(response).not.toBeNull();
      expect(response!.status).toBe(405);
    });

    it('returns 405 for PUT requests', () => {
      const request = createRequest('https://example.com/.well-known/oauth-authorization-server', 'PUT');
      const env = createEnv();
      const response = handleWellKnown(request, env);
      expect(response).not.toBeNull();
      expect(response!.status).toBe(405);
    });

    it('returns 405 for DELETE requests', () => {
      const request = createRequest('https://example.com/.well-known/oauth-protected-resource', 'DELETE');
      const env = createEnv();
      const response = handleWellKnown(request, env);
      expect(response).not.toBeNull();
      expect(response!.status).toBe(405);
    });

    it('allows GET requests', () => {
      const request = createRequest('https://example.com/.well-known/oauth-authorization-server', 'GET');
      const env = createEnv();
      const response = handleWellKnown(request, env);
      expect(response).not.toBeNull();
      expect(response!.status).toBe(200);
    });
  });

  describe('response content verification', () => {
    it('auth server metadata contains correct data', async () => {
      const request = createRequest('https://example.com/.well-known/oauth-authorization-server');
      const env = createEnv();
      const response = handleWellKnown(request, env);
      expect(response).not.toBeNull();
      const body = await response!.json() as any;
      expect(body.issuer).toBeDefined();
      expect(body.authorization_endpoint).toBeDefined();
      expect(body.token_endpoint).toBeDefined();
    });

    it('protected resource metadata contains correct data', async () => {
      const request = createRequest('https://example.com/.well-known/oauth-protected-resource');
      const env = createEnv();
      const response = handleWellKnown(request, env);
      expect(response).not.toBeNull();
      const body = await response!.json() as any;
      expect(body.resource).toBeDefined();
      expect(body.authorization_servers).toBeDefined();
      expect(body.scopes_supported).toBeDefined();
    });
  });
});
