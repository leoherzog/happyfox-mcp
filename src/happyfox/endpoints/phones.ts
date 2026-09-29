/**
 * The `phones` list of a contact payload (Docs/1092 §4), shared by the contact and asset endpoints.
 * Tools name phone types with words; the API takes short codes.
 */

import { HappyFoxAPIError } from '../errors';
import { idSegment } from '../paths';

export interface PhoneInput {
  number: string;
  /** A word from PHONE_TYPES, or its API code. Omitted, HappyFox uses other; required with `id`. */
  type?: string;
  /** Sent only when given. */
  is_primary?: boolean;
  /** An existing phone's id; accepted only when formatPhones is called with includeId. */
  id?: number | string;
}

/** Each phone type word the tools accept and its API code (Docs/1092 §4). */
export const PHONE_TYPE_CODES: Readonly<Record<string, string>> = {
  mobile: 'mo',
  work: 'w',
  main: 'm',
  home: 'h',
  other: 'o'
};

export const PHONE_TYPES = Object.keys(PHONE_TYPE_CODES);

// Codes are accepted too, so a type read back from a contact can be sent again unchanged.
const CODES_BY_NAME: Readonly<Record<string, string>> = Object.fromEntries([
  ...Object.entries(PHONE_TYPE_CODES),
  ...Object.values(PHONE_TYPE_CODES).map(code => [code, code])
]);

function invalid(message: string): HappyFoxAPIError {
  return new HappyFoxAPIError(message, 400, 'INVALID_ARGUMENT');
}

function phoneType(value: unknown, param: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  const code = typeof value === 'string' ? CODES_BY_NAME[value.trim().toLowerCase()] : undefined;
  if (!code) {
    throw invalid(`Invalid ${param} ${JSON.stringify(value)}: expected one of ${PHONE_TYPES.join(', ')}.`);
  }
  return code;
}

/**
 * Validate a phone list and return it in the API's form.
 * @param phones - a list of PhoneInput
 * @param includeId - true sends each phone's `id` (updateContact). False, for the paths that add
 *   phones, refuses an `id` rather than dropping it and turning an edit into an added phone
 * @param param - the argument name reported in errors, e.g. "contacts[1].phones"
 * @throws HappyFoxAPIError (400, INVALID_ARGUMENT) naming the first phone field that does not fit,
 *   including a missing type on a phone edited by id
 */
export function formatPhones(phones: unknown, includeId = false, param = 'phones'): Array<Record<string, unknown>> {
  if (!Array.isArray(phones)) throw invalid(`Invalid ${param}: expected a list of phones.`);

  const formatted = phones.map((phone: Partial<Record<keyof PhoneInput, unknown>>, index) => {
    const label = `${param}[${index}]`;
    if (typeof phone !== 'object' || phone === null || Array.isArray(phone)) {
      throw invalid(`Invalid ${label}: expected a phone object.`);
    }
    if (typeof phone.number !== 'string' || phone.number.trim() === '') {
      throw invalid(`${label}.number is required, as a string.`);
    }

    const entry: Record<string, unknown> = {};
    const type = phoneType(phone.type, `${label}.type`);
    if (type) entry.type = type;
    entry.number = phone.number;

    if (phone.is_primary !== undefined && phone.is_primary !== null) {
      if (typeof phone.is_primary !== 'boolean') {
        throw invalid(`Invalid ${label}.is_primary ${JSON.stringify(phone.is_primary)}: expected true or false.`);
      }
      entry.is_primary = phone.is_primary;
    }

    if (!includeId && phone.id !== undefined && phone.id !== null) {
      throw invalid(
        `${label}.id is not accepted here, where every phone is added. To change an existing phone, use ` +
          'happyfox_update_contact.'
      );
    }
    if (includeId && phone.id !== undefined && phone.id !== null) {
      entry.id = Number(idSegment(phone.id, `${label}.id`));
      // HappyFox defaults a missing type to other, so an edit without one could re-type the phone.
      if (!type) {
        throw invalid(`${label}.type is required when ${label}.id edits an existing phone; give its current type to keep it.`);
      }
    }
    return entry;
  });

  if (formatted.filter(entry => entry.is_primary === true).length > 1) {
    throw invalid(`Invalid ${param}: at most one phone can have is_primary true.`);
  }
  return formatted;
}
