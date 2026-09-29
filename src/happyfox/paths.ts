/**
 * Validation for every caller-supplied value that becomes part of a HappyFox URL path.
 * Endpoint modules build paths only through these helpers, so no tool argument can
 * redirect a request to another endpoint (e.g. `ticket_id: "123/delete/#"`).
 */

import { HappyFoxAPIError } from './errors';

// No path separators, escapes, whitespace or control characters. The local part may hold
// `?`, `#` and `%` (RFC 5322 atext): contactSegment percent-encodes them, so they stay in the segment.
const LOCAL_PART = '[^\\s\\x00-\\x1f\\x7f@/\\\\]+';
const DOMAIN_PART = '[^\\s\\x00-\\x1f\\x7f@/?#\\\\%]+';
const EMAIL = new RegExp(`^${LOCAL_PART}@${DOMAIN_PART}$`);
const MAX_EMAIL_LENGTH = 254;

/** A value as the model sent it: JSON for strings, lists and objects, so `["12"]` never reads as 12. */
function shown(value: unknown): string {
  let text: string;
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean' || value === undefined) {
    text = String(value);
  } else {
    try {
      text = JSON.stringify(value) ?? typeof value;
    } catch {
      text = typeof value;
    }
  }
  return text.length > 64 ? `${text.slice(0, 61)}...` : text;
}

function invalidId(param: string, value: unknown, expected: string): HappyFoxAPIError {
  return new HappyFoxAPIError(`Invalid ${param} ${shown(value)}: ${expected}.`, 400, 'INVALID_ID');
}

/**
 * A positive integer id as a path segment.
 * @param value - a number or a string of digits, e.g. `42` or `"42"`
 * @param param - the tool parameter name reported in the error
 * @returns the id in canonical decimal form
 * @throws HappyFoxAPIError (400, INVALID_ID) for anything else, including display ids like "#HFS00000001"
 */
export function idSegment(value: unknown, param: string): string {
  let id = Number.NaN;
  if (typeof value === 'number') id = value;
  else if (typeof value === 'string' && /^\d+$/.test(value)) id = Number(value);

  if (!Number.isSafeInteger(id) || id < 1) {
    throw invalidId(param, value, 'expected a positive integer id, not a display id');
  }
  return String(id);
}

/**
 * A contact path segment: a positive integer id or an email address (Docs/1092 §3).
 * @param value - a contact id, or an email such as "james@example.com"
 * @param param - the tool parameter name reported in the error
 * @returns the id, or the percent-encoded email with `@` left literal as the docs show it
 * @throws HappyFoxAPIError (400, INVALID_ID) for anything else
 */
export function contactSegment(value: unknown, param: string): string {
  if (typeof value === 'string' && value.includes('@')) {
    if (value.length > MAX_EMAIL_LENGTH || !EMAIL.test(value) || value.includes('..')) {
      throw invalidId(param, value, 'expected a positive integer contact id or an email address');
    }
    try {
      return encodeURIComponent(value).replace(/%40/g, '@');
    } catch {
      // encodeURIComponent throws URIError on a lone UTF-16 surrogate, which EMAIL lets through.
      throw invalidId(param, value, 'expected a positive integer contact id or an email address');
    }
  }
  try {
    return idSegment(value, param);
  } catch {
    throw invalidId(param, value, 'expected a positive integer contact id or an email address');
  }
}

/**
 * Reject a path that could resolve outside the endpoint it names. A backstop behind
 * idSegment/contactSegment: callers never pass query strings or fragments in the path.
 * A percent-encoded `?` or `#` inside a segment is data, so only a decoded separator or dot segment is refused.
 * @throws HappyFoxAPIError (400, INVALID_PATH)
 */
export function assertSafePath(path: string): void {
  const unsafe = () => new HappyFoxAPIError(`Refusing to request unsafe HappyFox path ${shown(path)}.`, 400, 'INVALID_PATH');

  if (!path.startsWith('/') || /[?#\\\s\x00-\x1f\x7f]/.test(path)) throw unsafe();

  for (const segment of path.split('/')) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      throw unsafe();
    }
    if (decoded === '.' || decoded === '..' || /[/\\]/.test(decoded)) throw unsafe();
  }
}
