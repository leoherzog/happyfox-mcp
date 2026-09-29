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
  /** The agent's role permissions from GET /staff/; absent when HappyFox sent none. */
  permissions?: string[];
  error?: string;
}

// OAuth scope type
export type HappyFoxScope = 'happyfox:read' | 'happyfox:write' | 'happyfox:admin';

/** Shown on the consent and home pages; must match the tools TOOL_SCOPE_MAP puts under each scope. */
export const SCOPE_DESCRIPTIONS: Record<HappyFoxScope, string> = {
  'happyfox:read': 'Read tickets, contacts, contact groups, assets, reports and the knowledge base, plus reference data such as categories, statuses and staff',
  'happyfox:write': 'Create and update tickets, contacts, contact groups and assets; reply to, forward and add private notes to tickets',
  'happyfox:admin': 'Delete tickets and assets, move tickets to another category, and replace the choices of ticket custom fields account-wide',
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
