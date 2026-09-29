/**
 * The page and size arguments of HappyFox's paginated lists, checked before anything is sent.
 * Shared by the ticket, contact, asset and report endpoints.
 */

import { HappyFoxAPIError } from '../errors';

/**
 * A positive integer argument, as a number or a digit string.
 * @returns the number, or undefined when the argument is undefined or null
 * @throws HappyFoxAPIError (400, INVALID_ARGUMENT) for anything else
 */
export function positiveInteger(value: unknown, param: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  const number = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof number !== 'number' || !Number.isSafeInteger(number) || number < 1) {
    const shown = typeof value === 'number' ? String(value) : JSON.stringify(value);
    throw new HappyFoxAPIError(`Invalid ${param} ${shown}: expected a positive integer.`, 400, 'INVALID_ARGUMENT');
  }
  return number;
}

/**
 * page and size for one page of a list. size defaults to the maximum, not HappyFox's 10.
 * @param maxSize - the endpoint's documented page size limit
 * @throws HappyFoxAPIError (400, INVALID_ARGUMENT) for a page or size that is not a positive integer
 */
export function pageQuery(page: unknown, size: unknown, maxSize: number): { page: number; size: number } {
  return {
    page: positiveInteger(page, 'page') ?? 1,
    size: Math.min(positiveInteger(size, 'size') ?? maxSize, maxSize)
  };
}
