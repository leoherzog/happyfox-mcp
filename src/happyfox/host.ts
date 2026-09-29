/**
 * Which host serves an account's API, and validation for every value that selects it.
 * Docs/360 and Docs/1039: `<account>.happyfox.com`, or `.happyfox.net` for EU-hosted accounts,
 * and an account on a custom domain must use that domain only. The reference cache keys
 * by the same host, so cached data can never land in a slot for a different origin.
 */

import { HappyFoxAuth } from '../types';
import { HappyFoxAPIError } from './errors';

export type HappyFoxRegion = HappyFoxAuth['region'];

export const REGIONS: readonly HappyFoxRegion[] = ['us', 'eu'];

/** One DNS label: an account subdomain, never a host or a path. */
export const ACCOUNT_NAME_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i;

const HOST_LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
// A letter first rules out IPv4 literals, whose last label is numeric.
const TOP_LEVEL_LABEL = /^[a-z][a-z0-9-]{0,61}[a-z0-9]$/;
const MAX_HOST_LENGTH = 253;

// Special-use names (RFC 6761, RFC 6762, ICANN's .internal) that never name a public HappyFox host.
const RESERVED_TOP_LEVEL = new Set(['localhost', 'local', 'localdomain', 'internal', 'invalid', 'test', 'example', 'arpa']);

export function isRegion(value: unknown): value is HappyFoxRegion {
  return typeof value === 'string' && (REGIONS as readonly string[]).includes(value);
}

/**
 * A custom-domain API host, as entered at consent.
 * @param value - a bare host name such as "support.example.com"
 * @returns the host in lowercase, or null when it has a scheme, port, path, userinfo or trailing dot,
 *   is an IP literal, has fewer than two labels, or ends in a special-use name such as `localhost`
 */
export function parseApiHost(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const host = value.trim().toLowerCase();
  if (host.length === 0 || host.length > MAX_HOST_LENGTH) return null;

  const labels = host.split('.');
  if (labels.length < 2 || !labels.every(label => HOST_LABEL.test(label))) return null;

  const topLevel = labels[labels.length - 1];
  if (!TOP_LEVEL_LABEL.test(topLevel) || RESERVED_TOP_LEVEL.has(topLevel)) return null;
  return host;
}

/** True when region, account name and optional custom host would all pass consent. */
export function isValidAccount(auth: HappyFoxAuth): boolean {
  return (
    isRegion(auth.region) &&
    typeof auth.accountName === 'string' &&
    ACCOUNT_NAME_PATTERN.test(auth.accountName) &&
    (auth.apiHost === undefined ||
      (typeof auth.apiHost === 'string' && parseApiHost(auth.apiHost) === auth.apiHost))
  );
}

/**
 * The host every request for this account goes to.
 * @returns `apiHost` when set, else `<account>.happyfox.com`, or `.happyfox.net` for region `eu`
 * @throws HappyFoxAPIError (400, INVALID_ACCOUNT) when the account fails {@link isValidAccount}
 */
export function apiHostFor(auth: HappyFoxAuth): string {
  if (!isValidAccount(auth)) {
    throw new HappyFoxAPIError(
      'Invalid HappyFox account: expected an account subdomain, region "us" or "eu", and an optional custom domain host name.',
      400,
      'INVALID_ACCOUNT'
    );
  }
  if (auth.apiHost !== undefined) return auth.apiHost;
  const domain = auth.region === 'eu' ? 'happyfox.net' : 'happyfox.com';
  return `${auth.accountName.toLowerCase()}.${domain}`;
}
