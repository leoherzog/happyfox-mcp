/**
 * MCP 2026-07-28 standard request header helpers.
 *
 * Header NAMES are case-insensitive (Headers.get already handles this).
 * Header VALUES are case-sensitive and MUST be compared with ===.
 */

const SENTINEL_PREFIX = '=?base64?';
const SENTINEL_SUFFIX = '?=';
const SENTINEL_MIN_LENGTH = SENTINEL_PREFIX.length + SENTINEL_SUFFIX.length; // 11

/** Thrown when a sentinel-encoded header value cannot be decoded. Maps to -32020. */
export class HeaderValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HeaderValueError';
  }
}

/**
 * Decode the `=?base64?...?=` sentinel used by Mcp-Name (and Mcp-Param-*).
 *
 * The markers are lowercase and case-sensitive. The payload is STANDARD base64
 * (alphabet includes `+` and `/`, padded) over UTF-8 bytes, so the TextDecoder
 * step is mandatory - `atob` alone returns a binary string and will mis-compare
 * any non-ASCII value.
 *
 * Values that do not carry the sentinel are returned unchanged.
 */
export function decodeMcpHeaderValue(raw: string): string {
  if (
    raw.length >= SENTINEL_MIN_LENGTH &&
    raw.startsWith(SENTINEL_PREFIX) &&
    raw.endsWith(SENTINEL_SUFFIX)
  ) {
    const encoded = raw.slice(SENTINEL_PREFIX.length, raw.length - SENTINEL_SUFFIX.length);
    let binary: string;
    try {
      binary = atob(encoded);
    } catch {
      throw new HeaderValueError('Header value contains invalid characters: malformed base64 sentinel');
    }
    return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
  }
  return raw;
}
