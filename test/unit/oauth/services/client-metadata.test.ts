import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  fetchClientMetadata,
  validateRedirectUri,
  clearCimdCache,
  ClientMetadataError,
} from '../../../../src/oauth/services/client-metadata';
import { ClientMetadata } from '../../../../src/oauth/types';

// Helper to create valid metadata
function createValidMetadata(clientId: string, overrides: Partial<ClientMetadata> = {}): ClientMetadata {
  return {
    client_id: clientId,
    client_name: 'Test Client',
    redirect_uris: ['https://example.com/callback'],
    ...overrides,
  };
}

// Helper to create mock fetch
function createMockFetch(response: any, status = 200): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(response),
  });
}

describe('fetchClientMetadata', () => {
  beforeEach(() => {
    clearCimdCache();
  });

  describe('client_id validation', () => {
    it('rejects non-HTTPS URL', async () => {
      const mockFetch = createMockFetch({});

      await expect(fetchClientMetadata('http://example.com/.well-known/oauth-client-metadata', mockFetch))
        .rejects.toThrow(ClientMetadataError);

      await expect(fetchClientMetadata('http://example.com/.well-known/oauth-client-metadata', mockFetch))
        .rejects.toMatchObject({
          code: 'INVALID_CLIENT_ID',
          message: 'Invalid client_id: must be an HTTPS URL',
        });
    });

    it('rejects invalid URL format', async () => {
      const mockFetch = createMockFetch({});

      await expect(fetchClientMetadata('not-a-valid-url', mockFetch))
        .rejects.toThrow(ClientMetadataError);

      await expect(fetchClientMetadata('not-a-valid-url', mockFetch))
        .rejects.toMatchObject({
          code: 'INVALID_CLIENT_ID',
        });
    });

    it('accepts valid HTTPS URL', async () => {
      const clientId = 'https://example.com/.well-known/oauth-client-metadata';
      const metadata = createValidMetadata(clientId);
      const mockFetch = createMockFetch(metadata);

      const result = await fetchClientMetadata(clientId, mockFetch);

      expect(result).toEqual(metadata);
      expect(mockFetch).toHaveBeenCalledWith(clientId, expect.objectContaining({
        headers: { Accept: 'application/json' },
      }));
    });
  });

  describe('fetch operation', () => {
    it('fetches and parses JSON response', async () => {
      const clientId = 'https://example.com/.well-known/oauth-client-metadata';
      const metadata = createValidMetadata(clientId);
      const mockFetch = createMockFetch(metadata);

      const result = await fetchClientMetadata(clientId, mockFetch);

      expect(result).toEqual(metadata);
    });

    it('throws for non-200 status', async () => {
      const clientId = 'https://example.com/.well-known/oauth-client-metadata';
      const mockFetch = createMockFetch({ error: 'Not Found' }, 404);

      await expect(fetchClientMetadata(clientId, mockFetch))
        .rejects.toMatchObject({
          code: 'FETCH_FAILED',
          message: expect.stringContaining('404'),
        });
    });

    it('throws TIMEOUT on AbortError', async () => {
      const clientId = 'https://example.com/.well-known/oauth-client-metadata';
      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';
      const mockFetch = vi.fn().mockRejectedValue(abortError);

      await expect(fetchClientMetadata(clientId, mockFetch))
        .rejects.toMatchObject({
          code: 'TIMEOUT',
          message: 'Client metadata fetch timed out',
        });
    });

    it('throws FETCH_FAILED on network error', async () => {
      const clientId = 'https://example.com/.well-known/oauth-client-metadata';
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network failure'));

      await expect(fetchClientMetadata(clientId, mockFetch))
        .rejects.toMatchObject({
          code: 'FETCH_FAILED',
          message: expect.stringContaining('Network failure'),
        });
    });

    it('includes Accept header in request', async () => {
      const clientId = 'https://example.com/.well-known/oauth-client-metadata';
      const metadata = createValidMetadata(clientId);
      const mockFetch = createMockFetch(metadata);

      await fetchClientMetadata(clientId, mockFetch);

      expect(mockFetch).toHaveBeenCalledWith(
        clientId,
        expect.objectContaining({
          headers: { Accept: 'application/json' },
        })
      );
    });
  });

  describe('caching', () => {
    it('returns cached result within TTL', async () => {
      const clientId = 'https://example.com/.well-known/oauth-client-metadata';
      const metadata = createValidMetadata(clientId);
      const mockFetch = createMockFetch(metadata);

      // First call - fetches from network
      await fetchClientMetadata(clientId, mockFetch);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Second call - should use cache
      await fetchClientMetadata(clientId, mockFetch);
      expect(mockFetch).toHaveBeenCalledTimes(1); // Still 1
    });

    it('clearCimdCache clears all entries', async () => {
      const clientId = 'https://example.com/.well-known/oauth-client-metadata';
      const metadata = createValidMetadata(clientId);
      const mockFetch = createMockFetch(metadata);

      // First call - populates cache
      await fetchClientMetadata(clientId, mockFetch);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Clear cache
      clearCimdCache();

      // Should fetch again
      await fetchClientMetadata(clientId, mockFetch);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('caches different client IDs separately', async () => {
      const clientId1 = 'https://example.com/client1';
      const clientId2 = 'https://example.com/client2';
      const metadata1 = createValidMetadata(clientId1, { client_name: 'Client 1' });
      const metadata2 = createValidMetadata(clientId2, { client_name: 'Client 2' });

      const mockFetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(metadata1),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(metadata2),
        });

      const result1 = await fetchClientMetadata(clientId1, mockFetch);
      const result2 = await fetchClientMetadata(clientId2, mockFetch);

      expect(result1.client_name).toBe('Client 1');
      expect(result2.client_name).toBe('Client 2');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('metadata validation', () => {
    it('throws on client_id mismatch', async () => {
      const clientId = 'https://example.com/.well-known/oauth-client-metadata';
      const metadata = createValidMetadata('https://different.com/metadata');
      const mockFetch = createMockFetch(metadata);

      await expect(fetchClientMetadata(clientId, mockFetch))
        .rejects.toMatchObject({
          code: 'CLIENT_ID_MISMATCH',
          message: expect.stringContaining('mismatch'),
        });
    });

    it('throws on missing client_name', async () => {
      const clientId = 'https://example.com/.well-known/oauth-client-metadata';
      const metadata = { client_id: clientId, redirect_uris: ['https://example.com/callback'] };
      const mockFetch = createMockFetch(metadata);

      await expect(fetchClientMetadata(clientId, mockFetch))
        .rejects.toMatchObject({
          code: 'INVALID_METADATA',
          message: expect.stringContaining('client_name'),
        });
    });

    it('throws on invalid client_name (non-string)', async () => {
      const clientId = 'https://example.com/.well-known/oauth-client-metadata';
      const metadata = { client_id: clientId, client_name: 123, redirect_uris: ['https://example.com/callback'] };
      const mockFetch = createMockFetch(metadata);

      await expect(fetchClientMetadata(clientId, mockFetch))
        .rejects.toMatchObject({
          code: 'INVALID_METADATA',
        });
    });

    it('throws on missing redirect_uris', async () => {
      const clientId = 'https://example.com/.well-known/oauth-client-metadata';
      const metadata = { client_id: clientId, client_name: 'Test' };
      const mockFetch = createMockFetch(metadata);

      await expect(fetchClientMetadata(clientId, mockFetch))
        .rejects.toMatchObject({
          code: 'INVALID_METADATA',
          message: expect.stringContaining('redirect_uris'),
        });
    });

    it('throws on empty redirect_uris', async () => {
      const clientId = 'https://example.com/.well-known/oauth-client-metadata';
      const metadata = { client_id: clientId, client_name: 'Test', redirect_uris: [] };
      const mockFetch = createMockFetch(metadata);

      await expect(fetchClientMetadata(clientId, mockFetch))
        .rejects.toMatchObject({
          code: 'INVALID_METADATA',
          message: expect.stringContaining('empty redirect_uris'),
        });
    });

    it('throws on invalid redirect_uri URL', async () => {
      const clientId = 'https://example.com/.well-known/oauth-client-metadata';
      const metadata = createValidMetadata(clientId, { redirect_uris: ['not-a-url'] });
      const mockFetch = createMockFetch(metadata);

      await expect(fetchClientMetadata(clientId, mockFetch))
        .rejects.toMatchObject({
          code: 'INVALID_REDIRECT_URI',
          message: expect.stringContaining('not-a-url'),
        });
    });

    it('throws on non-HTTPS logo_uri', async () => {
      const clientId = 'https://example.com/.well-known/oauth-client-metadata';
      const metadata = createValidMetadata(clientId, { logo_uri: 'http://example.com/logo.png' });
      const mockFetch = createMockFetch(metadata);

      await expect(fetchClientMetadata(clientId, mockFetch))
        .rejects.toMatchObject({
          code: 'INVALID_LOGO_URI',
        });
    });

    it('throws on non-HTTPS client_uri', async () => {
      const clientId = 'https://example.com/.well-known/oauth-client-metadata';
      const metadata = createValidMetadata(clientId, { client_uri: 'http://example.com' });
      const mockFetch = createMockFetch(metadata);

      await expect(fetchClientMetadata(clientId, mockFetch))
        .rejects.toMatchObject({
          code: 'INVALID_CLIENT_URI',
        });
    });

    it('allows HTTPS logo_uri', async () => {
      const clientId = 'https://example.com/.well-known/oauth-client-metadata';
      const metadata = createValidMetadata(clientId, { logo_uri: 'https://example.com/logo.png' });
      const mockFetch = createMockFetch(metadata);

      const result = await fetchClientMetadata(clientId, mockFetch);

      expect(result.logo_uri).toBe('https://example.com/logo.png');
    });

    it('allows HTTPS client_uri', async () => {
      const clientId = 'https://example.com/.well-known/oauth-client-metadata';
      const metadata = createValidMetadata(clientId, { client_uri: 'https://example.com' });
      const mockFetch = createMockFetch(metadata);

      const result = await fetchClientMetadata(clientId, mockFetch);

      expect(result.client_uri).toBe('https://example.com');
    });

    it('allows optional fields to be omitted', async () => {
      const clientId = 'https://example.com/.well-known/oauth-client-metadata';
      const metadata = createValidMetadata(clientId); // No optional fields
      const mockFetch = createMockFetch(metadata);

      const result = await fetchClientMetadata(clientId, mockFetch);

      expect(result.logo_uri).toBeUndefined();
      expect(result.client_uri).toBeUndefined();
      expect(result.scope).toBeUndefined();
    });

    it('preserves extra fields', async () => {
      const clientId = 'https://example.com/.well-known/oauth-client-metadata';
      const metadata = createValidMetadata(clientId, {
        scope: 'openid profile',
        grant_types: ['authorization_code'],
        contacts: ['admin@example.com'],
      });
      const mockFetch = createMockFetch(metadata);

      const result = await fetchClientMetadata(clientId, mockFetch);

      expect(result.scope).toBe('openid profile');
      expect(result.grant_types).toEqual(['authorization_code']);
      expect(result.contacts).toEqual(['admin@example.com']);
    });
  });
});

describe('validateRedirectUri', () => {
  const metadata: ClientMetadata = {
    client_id: 'https://example.com/client',
    client_name: 'Test Client',
    redirect_uris: [
      'https://example.com/callback',
      'https://example.com/auth/callback',
    ],
  };

  it('returns true for exact match', () => {
    expect(validateRedirectUri(metadata, 'https://example.com/callback')).toBe(true);
  });

  it('returns true for second URI in list', () => {
    expect(validateRedirectUri(metadata, 'https://example.com/auth/callback')).toBe(true);
  });

  it('returns false for non-matching URI', () => {
    expect(validateRedirectUri(metadata, 'https://other.com/callback')).toBe(false);
  });

  it('is case-sensitive', () => {
    expect(validateRedirectUri(metadata, 'https://example.com/Callback')).toBe(false);
  });

  it('requires exact match including query params', () => {
    expect(validateRedirectUri(metadata, 'https://example.com/callback?extra=param')).toBe(false);
  });

  it('requires exact match including trailing slash', () => {
    expect(validateRedirectUri(metadata, 'https://example.com/callback/')).toBe(false);
  });
});

describe('ClientMetadataError', () => {
  it('has correct error name', () => {
    const error = new ClientMetadataError('Test message', 'TEST_CODE');
    expect(error.name).toBe('ClientMetadataError');
  });

  it('preserves message', () => {
    const error = new ClientMetadataError('Test message', 'TEST_CODE');
    expect(error.message).toBe('Test message');
  });

  it('has correct error code', () => {
    const error = new ClientMetadataError('Test message', 'TEST_CODE');
    expect(error.code).toBe('TEST_CODE');
  });

  it('inherits from Error', () => {
    const error = new ClientMetadataError('Test message', 'TEST_CODE');
    expect(error).toBeInstanceOf(Error);
  });
});
