/**
 * Credential Store Service
 *
 * Handles encrypted storage and retrieval of HappyFox credentials in Cloudflare KV.
 * Uses AES-256-GCM encryption with random IV for each credential.
 */

import { StoredCredentials, CREDENTIAL_TTL_SECONDS } from '../types';

// KV key prefix for credentials
const CREDENTIAL_KEY_PREFIX = 'cred:';

/**
 * CredentialStore manages encrypted credential storage in Cloudflare KV
 */
export class CredentialStore {
  private kv: KVNamespace;
  private encryptionKeyBase64: string;
  private cryptoKey: CryptoKey | null = null;

  constructor(kv: KVNamespace, encryptionKeyBase64: string) {
    this.kv = kv;
    this.encryptionKeyBase64 = encryptionKeyBase64;
  }

  /**
   * Store credentials encrypted in KV
   */
  async store(tokenId: string, credentials: StoredCredentials): Promise<void> {
    const key = this.getKvKey(tokenId);
    const plaintext = JSON.stringify(credentials);
    const encrypted = await this.encrypt(plaintext);

    // Calculate TTL based on credential expiration
    const ttlSeconds = credentials.expiresAt - Math.floor(Date.now() / 1000);
    const effectiveTtl = Math.max(ttlSeconds, 60); // Minimum 60 seconds

    await this.kv.put(key, encrypted, { expirationTtl: effectiveTtl });
  }

  /**
   * Retrieve and decrypt credentials from KV
   */
  async retrieve(tokenId: string): Promise<StoredCredentials | null> {
    const key = this.getKvKey(tokenId);
    const encrypted = await this.kv.get(key);

    if (!encrypted) {
      return null;
    }

    try {
      const plaintext = await this.decrypt(encrypted);
      const credentials = JSON.parse(plaintext) as StoredCredentials;

      // Check if credentials have expired
      if (credentials.expiresAt < Math.floor(Date.now() / 1000)) {
        await this.delete(tokenId);
        return null;
      }

      return credentials;
    } catch (error) {
      // Decryption failed - credential may be corrupted or key changed
      console.error('Failed to decrypt credentials:', error);
      return null;
    }
  }

  /**
   * Delete credentials from KV
   */
  async delete(tokenId: string): Promise<void> {
    const key = this.getKvKey(tokenId);
    await this.kv.delete(key);
  }

  /**
   * Renew TTL on existing credentials (called on token refresh)
   */
  async renewTTL(tokenId: string): Promise<boolean> {
    const credentials = await this.retrieve(tokenId);
    if (!credentials) {
      return false;
    }

    // Update expiration time
    const now = Math.floor(Date.now() / 1000);
    credentials.expiresAt = now + CREDENTIAL_TTL_SECONDS;

    await this.store(tokenId, credentials);
    return true;
  }

  /**
   * Get KV key for a token ID
   */
  private getKvKey(tokenId: string): string {
    return `${CREDENTIAL_KEY_PREFIX}${tokenId}`;
  }

  /**
   * Import the encryption key for use with Web Crypto API
   */
  private async importKey(): Promise<CryptoKey> {
    if (this.cryptoKey) {
      return this.cryptoKey;
    }

    // Decode base64 key
    let keyBytes: Uint8Array;
    try {
      keyBytes = Uint8Array.from(atob(this.encryptionKeyBase64), c => c.charCodeAt(0));
    } catch {
      throw new Error('CREDENTIAL_ENCRYPTION_KEY must be valid base64');
    }

    if (keyBytes.length !== 32) {
      throw new Error('Encryption key must be exactly 32 bytes (256 bits)');
    }

    this.cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyBytes,
      { name: 'AES-GCM' },
      false, // not extractable
      ['encrypt', 'decrypt']
    );

    return this.cryptoKey;
  }

  /**
   * Encrypt plaintext using AES-256-GCM
   * Returns: base64(iv) + ':' + base64(ciphertext)
   */
  private async encrypt(plaintext: string): Promise<string> {
    const key = await this.importKey();

    // Generate random 12-byte IV (recommended for GCM)
    const iv = crypto.getRandomValues(new Uint8Array(12));

    // Encode plaintext to bytes
    const encoder = new TextEncoder();
    const plaintextBytes = encoder.encode(plaintext);

    // Encrypt
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      plaintextBytes
    );

    // Encode to base64 and combine
    const ivBase64 = btoa(String.fromCharCode(...iv));
    const ciphertextBase64 = btoa(String.fromCharCode(...new Uint8Array(ciphertext)));

    return `${ivBase64}:${ciphertextBase64}`;
  }

  /**
   * Decrypt ciphertext using AES-256-GCM
   * Input: base64(iv) + ':' + base64(ciphertext)
   */
  private async decrypt(encrypted: string): Promise<string> {
    const key = await this.importKey();

    // Split IV and ciphertext
    const colonIndex = encrypted.indexOf(':');
    if (colonIndex === -1) {
      throw new Error('Invalid encrypted data format');
    }

    const ivBase64 = encrypted.substring(0, colonIndex);
    const ciphertextBase64 = encrypted.substring(colonIndex + 1);

    // Decode from base64
    const iv = Uint8Array.from(atob(ivBase64), c => c.charCodeAt(0));
    const ciphertext = Uint8Array.from(atob(ciphertextBase64), c => c.charCodeAt(0));

    if (iv.length !== 12) {
      throw new Error('Invalid IV length');
    }

    // Decrypt
    const plaintextBytes = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );

    // Decode to string
    const decoder = new TextDecoder();
    return decoder.decode(plaintextBytes);
  }
}

/**
 * Create a new credential store instance
 */
export function createCredentialStore(kv: KVNamespace, encryptionKey: string): CredentialStore {
  return new CredentialStore(kv, encryptionKey);
}
