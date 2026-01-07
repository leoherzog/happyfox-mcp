/**
 * Stateless session token management for MCP 2025-11-25
 * Uses HMAC-SHA256 signed tokens with no server-side storage
 */

import { MCPSessionPayload, SessionValidationResult, MCP_PROTOCOL_VERSION } from '../types';

const SESSION_TTL_SECONDS = 3600; // 1 hour
const ALGORITHM = { name: 'HMAC', hash: 'SHA-256' };

export class SessionTokenManager {
  private secretKey: CryptoKey | null = null;
  private secret: string;

  constructor(secret: string) {
    this.secret = secret;
  }

  /**
   * Import the secret as a CryptoKey for HMAC operations
   */
  private async getKey(): Promise<CryptoKey> {
    if (!this.secretKey) {
      const encoder = new TextEncoder();
      this.secretKey = await crypto.subtle.importKey(
        'raw',
        encoder.encode(this.secret),
        ALGORITHM,
        false,
        ['sign', 'verify']
      );
    }
    return this.secretKey;
  }

  /**
   * Create a signed session token
   * Token format: base64url(payload).base64url(signature)
   */
  async createToken(protocolVersion: string, capabilities: string[]): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const payload: MCPSessionPayload = {
      v: protocolVersion,
      iat: now,
      exp: now + SESSION_TTL_SECONDS,
      caps: capabilities.sort().join(','),
    };

    const payloadB64 = this.base64UrlEncode(JSON.stringify(payload));
    const signature = await this.sign(payloadB64);

    return `${payloadB64}.${signature}`;
  }

  /**
   * Validate a session token
   * Returns validation result with payload or error
   */
  async validateToken(token: string): Promise<SessionValidationResult> {
    if (!token) {
      return { valid: false, error: 'missing' };
    }

    const parts = token.split('.');
    if (parts.length !== 2) {
      return { valid: false, error: 'malformed' };
    }

    const [payloadB64, providedSignature] = parts;

    // Verify signature using constant-time comparison via crypto.subtle.verify
    const isValidSignature = await this.verifySignature(payloadB64, providedSignature);
    if (!isValidSignature) {
      return { valid: false, error: 'invalid' };
    }

    // Decode and validate payload
    try {
      const payloadJson = this.base64UrlDecode(payloadB64);
      const payload = JSON.parse(payloadJson) as MCPSessionPayload;
      const now = Math.floor(Date.now() / 1000);

      // Check expiration
      if (payload.exp < now) {
        return { valid: false, error: 'expired' };
      }

      // Validate required fields
      if (!payload.v || !payload.iat || !payload.exp) {
        return { valid: false, error: 'malformed' };
      }

      // Validate protocol version matches current supported version
      if (payload.v !== MCP_PROTOCOL_VERSION) {
        return { valid: false, error: 'invalid' };
      }

      return { valid: true, payload };
    } catch {
      return { valid: false, error: 'malformed' };
    }
  }

  /**
   * Sign data using HMAC-SHA256
   */
  private async sign(data: string): Promise<string> {
    const key = await this.getKey();
    const encoder = new TextEncoder();
    const signature = await crypto.subtle.sign(
      'HMAC',
      key,
      encoder.encode(data)
    );
    return this.base64UrlEncode(new Uint8Array(signature));
  }

  /**
   * Verify signature using crypto.subtle.verify for constant-time comparison
   */
  private async verifySignature(data: string, providedSignatureB64: string): Promise<boolean> {
    try {
      const key = await this.getKey();
      const encoder = new TextEncoder();
      const providedSignature = this.base64UrlDecodeToBytes(providedSignatureB64);

      return await crypto.subtle.verify(
        'HMAC',
        key,
        providedSignature,
        encoder.encode(data)
      );
    } catch {
      return false;
    }
  }

  /**
   * Base64URL decode to Uint8Array (for signature verification)
   */
  private base64UrlDecodeToBytes(input: string): Uint8Array {
    // Restore standard base64 characters
    let base64 = input.replace(/-/g, '+').replace(/_/g, '/');

    // Add padding if needed
    const paddingNeeded = (4 - (base64.length % 4)) % 4;
    base64 += '='.repeat(paddingNeeded);

    // Decode to bytes
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  /**
   * Base64URL encode (URL-safe, no padding)
   */
  private base64UrlEncode(input: string | Uint8Array): string {
    let bytes: Uint8Array;
    if (typeof input === 'string') {
      bytes = new TextEncoder().encode(input);
    } else {
      bytes = input;
    }

    // Convert to base64
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);

    // Make URL-safe and remove padding
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  /**
   * Base64URL decode
   */
  private base64UrlDecode(input: string): string {
    // Restore standard base64 characters
    let base64 = input.replace(/-/g, '+').replace(/_/g, '/');

    // Add padding if needed
    const paddingNeeded = (4 - (base64.length % 4)) % 4;
    base64 += '='.repeat(paddingNeeded);

    // Decode
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
  }
}
