/**
 * OAuth 2.0 type definitions for HappyFox MCP Server
 */

/**
 * Props stored in the OAuth grant and passed to the API handler. Everything else about the
 * grant lives in the encrypted KV credential record keyed by tokenId; scopes are here
 * because the library passes only props to the API handler.
 */
export interface OAuthProps {
  tokenId: string;
  scopes: string[];
}

// Stored credentials in KV (encrypted with AES-256-GCM)
export interface StoredCredentials {
  apiKey: string;
  authCode: string;
  accountName: string;
  region: 'us' | 'eu';
  /** Custom domain entered at consent; absent means the account subdomain host. */
  apiHost?: string;
  staffId: number;
  staffName: string;
  staffEmail: string;
  expiresAt: number;  // Unix timestamp (seconds)
}

// Consent page template data
export interface ConsentPageData {
  clientName: string;
  clientUri?: string;
  logoUri?: string;
  requestedScopes: string[];
  error?: string;
  csrfToken?: string;  // CSRF protection token
  formData?: {
    accountName?: string;
    email?: string;
    region?: string;
    apiHost?: string;
  };
}

// Staff validation result from HappyFox API
export interface StaffValidationResult {
  valid: boolean;
  staffId?: number;
  staffName?: string;
  error?: string;
}

// OAuth scope type
export type HappyFoxScope = 'happyfox:read' | 'happyfox:write' | 'happyfox:admin';

// Scope descriptions for consent page
export const SCOPE_DESCRIPTIONS: Record<HappyFoxScope, string> = {
  'happyfox:read': 'Read tickets, contacts, and assets',
  'happyfox:write': 'Create and update tickets, add replies',
  'happyfox:admin': 'Delete tickets, manage categories',
};

// All available scopes
export const AVAILABLE_SCOPES: HappyFoxScope[] = [
  'happyfox:read',
  'happyfox:write',
  'happyfox:admin',
];

// Default scope when none specified
export const DEFAULT_SCOPES: HappyFoxScope[] = ['happyfox:read'];

// Credential TTL in seconds (90 days)
export const CREDENTIAL_TTL_SECONDS = 90 * 24 * 60 * 60;
