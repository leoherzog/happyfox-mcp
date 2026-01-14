/**
 * Client Metadata Service
 *
 * Fetches and validates Client ID Metadata Documents (CIMD) for OAuth client identification.
 * Per MCP 2025-11-25 specification, the client_id is a URL pointing to the client's metadata.
 */

import { ClientMetadata, CIMD_FETCH_TIMEOUT_MS } from '../types';

// Simple in-memory cache for CIMD (5 minute TTL)
const cimdCache = new Map<string, { metadata: ClientMetadata; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch and validate client metadata from a client_id URL
 *
 * @param clientId - HTTPS URL pointing to the client's metadata document
 * @param fetchFn - Optional fetch function for testing
 * @returns Client metadata
 * @throws Error if fetch fails or validation fails
 */
export async function fetchClientMetadata(
  clientId: string,
  fetchFn: typeof fetch = fetch
): Promise<ClientMetadata> {
  // Check cache first
  const cached = cimdCache.get(clientId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.metadata;
  }

  // Validate client_id is HTTPS URL
  if (!clientId.startsWith('https://')) {
    throw new ClientMetadataError(
      'Invalid client_id: must be an HTTPS URL',
      'INVALID_CLIENT_ID'
    );
  }

  try {
    new URL(clientId);
  } catch {
    throw new ClientMetadataError(
      'Invalid client_id: not a valid URL',
      'INVALID_CLIENT_ID'
    );
  }

  // Fetch with timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CIMD_FETCH_TIMEOUT_MS);

  try {
    const response = await fetchFn(clientId, {
      headers: {
        'Accept': 'application/json',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new ClientMetadataError(
        `Failed to fetch client metadata: ${response.status} ${response.statusText}`,
        'FETCH_FAILED'
      );
    }

    const metadata = await response.json() as ClientMetadata;

    // Validate required fields
    validateClientMetadata(metadata, clientId);

    // Cache the result
    cimdCache.set(clientId, {
      metadata,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });

    return metadata;
  } catch (error) {
    if (error instanceof ClientMetadataError) {
      throw error;
    }

    if (error instanceof Error && error.name === 'AbortError') {
      throw new ClientMetadataError(
        'Client metadata fetch timed out',
        'TIMEOUT'
      );
    }

    throw new ClientMetadataError(
      `Failed to fetch client metadata: ${error instanceof Error ? error.message : String(error)}`,
      'FETCH_FAILED'
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Validate client metadata structure and consistency
 */
function validateClientMetadata(metadata: ClientMetadata, clientIdUrl: string): void {
  // client_id in document must match the URL
  if (metadata.client_id !== clientIdUrl) {
    throw new ClientMetadataError(
      `Client ID mismatch: document contains "${metadata.client_id}" but was fetched from "${clientIdUrl}"`,
      'CLIENT_ID_MISMATCH'
    );
  }

  // client_name is required
  if (!metadata.client_name || typeof metadata.client_name !== 'string') {
    throw new ClientMetadataError(
      'Missing or invalid client_name in metadata',
      'INVALID_METADATA'
    );
  }

  // redirect_uris must be an array
  if (!Array.isArray(metadata.redirect_uris) || metadata.redirect_uris.length === 0) {
    throw new ClientMetadataError(
      'Missing or empty redirect_uris in metadata',
      'INVALID_METADATA'
    );
  }

  // All redirect_uris must be valid URLs
  for (const uri of metadata.redirect_uris) {
    try {
      new URL(uri);
    } catch {
      throw new ClientMetadataError(
        `Invalid redirect_uri: ${uri}`,
        'INVALID_REDIRECT_URI'
      );
    }
  }

  // logo_uri must be HTTPS if present
  if (metadata.logo_uri) {
    if (!metadata.logo_uri.startsWith('https://')) {
      throw new ClientMetadataError(
        'logo_uri must be an HTTPS URL',
        'INVALID_LOGO_URI'
      );
    }
  }

  // client_uri must be HTTPS if present
  if (metadata.client_uri) {
    if (!metadata.client_uri.startsWith('https://')) {
      throw new ClientMetadataError(
        'client_uri must be an HTTPS URL',
        'INVALID_CLIENT_URI'
      );
    }
  }
}

/**
 * Validate that a redirect_uri is allowed by the client metadata
 *
 * @param metadata - Client metadata
 * @param redirectUri - Redirect URI to validate
 * @returns true if redirect_uri is allowed
 */
export function validateRedirectUri(
  metadata: ClientMetadata,
  redirectUri: string
): boolean {
  return metadata.redirect_uris.includes(redirectUri);
}

/**
 * Clear the CIMD cache (for testing)
 */
export function clearCimdCache(): void {
  cimdCache.clear();
}

/**
 * Custom error class for client metadata operations
 */
export class ClientMetadataError extends Error {
  constructor(
    message: string,
    public code: string
  ) {
    super(message);
    this.name = 'ClientMetadataError';
  }
}
