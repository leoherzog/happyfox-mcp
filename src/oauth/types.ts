/**
 * OAuth 2.0 type definitions for HappyFox MCP Server
 */

// Stored credentials in KV (encrypted with AES-256-GCM)
export interface StoredCredentials {
  apiKey: string;
  authCode: string;
  accountName: string;
  region: 'us' | 'eu';
  staffId: number;
  staffName: string;
  staffEmail: string;
  createdAt: number;  // Unix timestamp (seconds)
  expiresAt: number;  // Unix timestamp (seconds)
}

// OAuth Client Metadata (CIMD - Client ID Metadata Document)
export interface ClientMetadata {
  client_id: string;  // Must match the URL used to fetch this document
  client_name: string;  // Display name (e.g., "Claude.ai")
  client_uri?: string;  // Client homepage URL
  logo_uri?: string;  // Client logo URL for consent page
  redirect_uris: string[];  // Allowed callback URLs
  scope?: string;  // Default scopes (space-separated)
  grant_types?: string[];  // Supported grant types
  response_types?: string[];  // Supported response types
  token_endpoint_auth_method?: string;  // Auth method (e.g., "none" for public clients)
  contacts?: string[];  // Security contact emails
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

// CIMD fetch timeout in milliseconds
export const CIMD_FETCH_TIMEOUT_MS = 5000;
