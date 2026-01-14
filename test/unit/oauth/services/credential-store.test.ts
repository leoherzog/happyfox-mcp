import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CredentialStore, createCredentialStore } from '../../../../src/oauth/services/credential-store';
import { StoredCredentials, CREDENTIAL_TTL_SECONDS } from '../../../../src/oauth/types';
import { env } from 'cloudflare:test';

// Valid 32-byte base64 key (32 bytes = "12345678901234567890123456789012")
const TEST_ENCRYPTION_KEY = 'MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI=';

// Helper to create test credentials
function createTestCredentials(overrides: Partial<StoredCredentials> = {}): StoredCredentials {
  const now = Math.floor(Date.now() / 1000);
  return {
    apiKey: 'test-api-key',
    authCode: 'test-auth-code',
    accountName: 'testaccount',
    region: 'us',
    staffId: 1,
    staffName: 'Test User',
    staffEmail: 'test@example.com',
    createdAt: now,
    expiresAt: now + CREDENTIAL_TTL_SECONDS,
    ...overrides,
  };
}

describe('CredentialStore', () => {
  let store: CredentialStore;
  let kv: KVNamespace;

  beforeEach(() => {
    kv = env.OAUTH_KV;
    store = new CredentialStore(kv, TEST_ENCRYPTION_KEY);
  });

  describe('constructor', () => {
    it('creates a new instance', () => {
      const instance = new CredentialStore(kv, TEST_ENCRYPTION_KEY);
      expect(instance).toBeInstanceOf(CredentialStore);
    });
  });

  describe('store and retrieve', () => {
    it('stores and retrieves credentials correctly', async () => {
      const credentials = createTestCredentials();
      const tokenId = 'test-token-1';

      await store.store(tokenId, credentials);
      const retrieved = await store.retrieve(tokenId);

      expect(retrieved).toEqual(credentials);
    });

    it('preserves all credential fields', async () => {
      const credentials = createTestCredentials({
        apiKey: 'my-api-key',
        authCode: 'my-auth-code',
        accountName: 'myaccount',
        region: 'eu',
        staffId: 42,
        staffName: 'John Doe',
        staffEmail: 'john@example.com',
      });
      const tokenId = 'test-token-2';

      await store.store(tokenId, credentials);
      const retrieved = await store.retrieve(tokenId);

      expect(retrieved?.apiKey).toBe('my-api-key');
      expect(retrieved?.authCode).toBe('my-auth-code');
      expect(retrieved?.accountName).toBe('myaccount');
      expect(retrieved?.region).toBe('eu');
      expect(retrieved?.staffId).toBe(42);
      expect(retrieved?.staffName).toBe('John Doe');
      expect(retrieved?.staffEmail).toBe('john@example.com');
    });

    it('returns null for non-existent token', async () => {
      const retrieved = await store.retrieve('non-existent-token');
      expect(retrieved).toBeNull();
    });

    it('encrypts data before storing', async () => {
      const credentials = createTestCredentials();
      const tokenId = 'test-token-encrypt';

      await store.store(tokenId, credentials);

      // Read raw value from KV
      const rawValue = await kv.get(`cred:${tokenId}`);
      expect(rawValue).not.toBeNull();
      // Should not contain plaintext
      expect(rawValue).not.toContain('test-api-key');
      // Should be in format base64:base64
      expect(rawValue).toContain(':');
    });

    it('generates different encrypted values for same data', async () => {
      const credentials = createTestCredentials();

      // Store same credentials twice with different IDs
      await store.store('token-a', credentials);
      await store.store('token-b', credentials);

      const rawA = await kv.get('cred:token-a');
      const rawB = await kv.get('cred:token-b');

      // Due to random IV, encrypted values should differ
      expect(rawA).not.toBe(rawB);
    });
  });

  describe('expiration handling', () => {
    it('returns null for expired credentials and deletes them', async () => {
      const now = Math.floor(Date.now() / 1000);
      const credentials = createTestCredentials({
        expiresAt: now - 100, // Already expired
      });
      const tokenId = 'expired-token';

      // Store with custom TTL by manipulating store directly
      const encrypted = await (store as any).encrypt(JSON.stringify(credentials));
      await kv.put(`cred:${tokenId}`, encrypted, { expirationTtl: 3600 });

      const retrieved = await store.retrieve(tokenId);
      expect(retrieved).toBeNull();

      // Verify it was deleted
      const rawValue = await kv.get(`cred:${tokenId}`);
      expect(rawValue).toBeNull();
    });

    it('enforces minimum TTL of 60 seconds', async () => {
      const now = Math.floor(Date.now() / 1000);
      const credentials = createTestCredentials({
        expiresAt: now + 10, // Only 10 seconds from now
      });
      const tokenId = 'short-ttl-token';

      // This should still store with at least 60 second TTL
      await store.store(tokenId, credentials);

      // Should still be retrievable
      const retrieved = await store.retrieve(tokenId);
      expect(retrieved).not.toBeNull();
    });
  });

  describe('delete', () => {
    it('removes credentials from KV', async () => {
      const credentials = createTestCredentials();
      const tokenId = 'delete-token';

      await store.store(tokenId, credentials);
      expect(await store.retrieve(tokenId)).not.toBeNull();

      await store.delete(tokenId);
      expect(await store.retrieve(tokenId)).toBeNull();
    });

    it('handles deleting non-existent key gracefully', async () => {
      // Should not throw
      await expect(store.delete('non-existent')).resolves.toBeUndefined();
    });
  });

  describe('renewTTL', () => {
    it('extends TTL for existing credentials', async () => {
      const now = Math.floor(Date.now() / 1000);
      const credentials = createTestCredentials({
        expiresAt: now + 1000, // 1000 seconds remaining
      });
      const tokenId = 'renew-token';

      await store.store(tokenId, credentials);

      const result = await store.renewTTL(tokenId);
      expect(result).toBe(true);

      const retrieved = await store.retrieve(tokenId);
      expect(retrieved?.expiresAt).toBeGreaterThan(now + 1000);
      expect(retrieved?.expiresAt).toBe(now + CREDENTIAL_TTL_SECONDS);
    });

    it('returns false for non-existent credentials', async () => {
      const result = await store.renewTTL('non-existent-token');
      expect(result).toBe(false);
    });

    it('returns false for expired credentials', async () => {
      const now = Math.floor(Date.now() / 1000);
      const credentials = createTestCredentials({
        expiresAt: now - 100, // Already expired
      });
      const tokenId = 'expired-renew-token';

      // Store directly bypassing expiration check
      const encrypted = await (store as any).encrypt(JSON.stringify(credentials));
      await kv.put(`cred:${tokenId}`, encrypted, { expirationTtl: 3600 });

      const result = await store.renewTTL(tokenId);
      expect(result).toBe(false);
    });
  });

  describe('key import', () => {
    it('caches key after first import', async () => {
      const credentials = createTestCredentials();

      // First operation imports the key
      await store.store('token-1', credentials);
      // Second operation should use cached key
      await store.retrieve('token-1');

      // Accessing private property to verify caching
      expect((store as any).cryptoKey).not.toBeNull();
    });
  });

  describe('error handling', () => {
    it('throws for invalid base64 encryption key', async () => {
      const invalidStore = new CredentialStore(kv, 'not-valid-base64!!!');
      const credentials = createTestCredentials();

      await expect(invalidStore.store('test', credentials)).rejects.toThrow(
        'CREDENTIAL_ENCRYPTION_KEY must be valid base64'
      );
    });

    it('throws for wrong key length', async () => {
      // Valid base64 but only 16 bytes
      const shortKey = btoa('short-16-byte-key');
      const shortKeyStore = new CredentialStore(kv, shortKey);
      const credentials = createTestCredentials();

      await expect(shortKeyStore.store('test', credentials)).rejects.toThrow(
        'Encryption key must be exactly 32 bytes'
      );
    });

    it('returns null for corrupted encrypted data', async () => {
      const tokenId = 'corrupted-token';

      // Store corrupted data directly
      await kv.put(`cred:${tokenId}`, 'invalid:corrupted:data');

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const retrieved = await store.retrieve(tokenId);

      expect(retrieved).toBeNull();
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('returns null for invalid IV length', async () => {
      const tokenId = 'invalid-iv-token';

      // Store data with wrong IV length (not 12 bytes)
      const shortIv = btoa('short'); // 5 bytes
      const fakeCiphertext = btoa('fake-ciphertext');
      await kv.put(`cred:${tokenId}`, `${shortIv}:${fakeCiphertext}`);

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const retrieved = await store.retrieve(tokenId);

      expect(retrieved).toBeNull();
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('returns null for data without colon separator', async () => {
      const tokenId = 'no-colon-token';
      await kv.put(`cred:${tokenId}`, 'nodatacolonseparator');

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const retrieved = await store.retrieve(tokenId);

      expect(retrieved).toBeNull();
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });
});

describe('createCredentialStore', () => {
  it('creates a CredentialStore instance', () => {
    const kv = env.OAUTH_KV;
    const store = createCredentialStore(kv, TEST_ENCRYPTION_KEY);
    expect(store).toBeInstanceOf(CredentialStore);
  });
});
