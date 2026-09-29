/**
 * Validation and schema for the `custom_fields` tool argument. HappyFox takes each custom-field
 * value as a top-level payload key (`t-cf-<id>`, `c-cf-<id>`) beside the core fields, so any other
 * key would go out as an undocumented field or overwrite a core one such as `email`.
 */

import { HappyFoxAPIError } from '../errors';

/** One family of custom fields: its payload key prefix and the resource that lists its ids. */
export interface CustomFieldKind {
  prefix: string;
  source: string;
}

/** Ticket custom fields (Docs/1039 §4, §11). */
export const TICKET_CUSTOM_FIELDS: CustomFieldKind = {
  prefix: 't-cf-',
  source: 'happyfox://ticket-custom-fields'
};

/** Contact custom fields (Docs/1039 §4, Docs/1092 §4). */
export const CONTACT_CUSTOM_FIELDS: CustomFieldKind = {
  prefix: 'c-cf-',
  source: 'happyfox://contact-custom-fields'
};

/** The documented value format per field type, for tool descriptions (Docs/1039 §4, Docs/1092 §4). */
export const CUSTOM_FIELD_VALUE_FORMATS =
  'Values by field type: text, a string; number, an integer or a float with at most 2 decimal places; ' +
  'dropdown, one choice id (`choices[].id`, not the label); multiple choice, a list of choice ids; ' +
  'date, a yyyy-mm-dd string.';

export type CustomFieldValue = string | number | number[];

const CHOICE_ID = /^[1-9][0-9]*$/;

// Prefixes hold only letters and hyphens, so they need no escaping.
function keyPattern(kinds: readonly CustomFieldKind[]): string {
  return `^(${kinds.map(kind => kind.prefix).join('|')})[1-9][0-9]*$`;
}

function invalid(message: string): HappyFoxAPIError {
  return new HappyFoxAPIError(message, 400, 'INVALID_ARGUMENT');
}

/**
 * JSON Schema for a `custom_fields` argument whose keys take the given prefixes.
 * @param kinds - the custom-field families the endpoint documents
 * @param description - the property description the model sees
 */
export function customFieldsSchema(kinds: readonly CustomFieldKind[], description: string): Record<string, unknown> {
  return {
    type: 'object',
    description,
    propertyNames: { pattern: keyPattern(kinds) },
    additionalProperties: {
      anyOf: [
        { type: 'string' },
        { type: 'number' },
        { type: 'array', items: { type: 'integer', minimum: 1 } }
      ]
    }
  };
}

function choiceIds(value: unknown[], param: string, key: string): number[] {
  return value.map(item => {
    if (typeof item === 'number' && Number.isSafeInteger(item) && item > 0) return item;
    if (typeof item === 'string' && CHOICE_ID.test(item)) return Number(item);
    throw invalid(
      `Invalid ${param} value for "${key}": a multiple-choice value is a list of choice ids ` +
        '(`choices[].id`), not labels.'
    );
  });
}

/**
 * Validate a `custom_fields` argument and return the payload entries it stands for.
 * @param fields - an object keyed `<prefix><id>`; undefined or null yields no entries
 * @param kinds - the custom-field families the endpoint documents
 * @param param - the argument name reported in errors, e.g. "tickets[2].custom_fields"
 * @returns the entries, with multiple-choice ids as numbers
 * @throws HappyFoxAPIError (400, INVALID_ARGUMENT) naming the first key or value that does not fit
 */
export function customFieldEntries(
  fields: unknown,
  kinds: readonly CustomFieldKind[],
  param = 'custom_fields'
): Record<string, CustomFieldValue> {
  if (fields === undefined || fields === null) return {};
  if (typeof fields !== 'object' || Array.isArray(fields)) {
    throw invalid(`Invalid ${param}: expected an object keyed ${kinds.map(k => `${k.prefix}<id>`).join(' or ')}.`);
  }

  const pattern = new RegExp(keyPattern(kinds));
  const entries: Record<string, CustomFieldValue> = {};

  for (const [key, value] of Object.entries(fields)) {
    if (!pattern.test(key)) {
      const expected = kinds.map(kind => `${kind.prefix}<id> with an id from ${kind.source}`).join(', or ');
      throw invalid(`Invalid ${param} key ${JSON.stringify(key)}: expected ${expected}.`);
    }

    if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) {
      entries[key] = value;
    } else if (Array.isArray(value)) {
      entries[key] = choiceIds(value, param, key);
    } else {
      throw invalid(
        `Invalid ${param} value for "${key}": expected a string, a number or a list of choice ids.`
      );
    }
  }

  return entries;
}
