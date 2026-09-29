/**
 * The error type every HappyFox call throws, and the formatter that turns HappyFox's
 * documented error bodies into one readable line naming each failing field.
 */

export class HappyFoxAPIError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public code: string
  ) {
    super(message);
    this.name = 'HappyFoxAPIError';
  }
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function childField(parent: string | undefined, key: string): string {
  return parent ? `${parent}.${key}` : key;
}

/** Flatten an error value into `field: message` lines; nested object keys join with dots. */
function errorLines(value: unknown, field?: string): string[] {
  if (value === null || value === undefined) return [];

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const text = String(value).trim();
    if (!text) return [];
    return [field ? `${field}: ${text}` : text];
  }

  if (Array.isArray(value)) {
    // ["msg", ...] belongs to one field; [{field, errors}, ...] names its own fields.
    if (value.every(item => typeof item === 'string')) {
      const text = value.map(item => item.trim()).filter(Boolean).join(' ');
      if (!text) return [];
      return [field ? `${field}: ${text}` : text];
    }
    return value.flatMap(item => {
      if (isObject(item) && typeof item.field === 'string') {
        return errorLines(item.errors ?? item.error ?? item.message, childField(field, item.field));
      }
      return errorLines(item, field);
    });
  }

  if (isObject(value)) {
    return Object.entries(value).flatMap(([key, child]) => errorLines(child, childField(field, key)));
  }

  return [];
}

/** One failed entry of a per-item bulk result, e.g. `{success: false, error: [...]}`. */
function bulkItemLines(item: JsonObject): string[] {
  const reported = item.error ?? item.errors;
  if (reported !== undefined) return errorLines(reported);

  if (isObject(item.data)) {
    const { message, ...rest } = item.data;
    const subject = Object.entries(rest)
      .filter(([, v]) => typeof v === 'string' || typeof v === 'number')
      .map(([k, v]) => `${k} ${v}`)
      .join(', ');
    const text = typeof message === 'string' ? message : '';
    if (text || subject) return [subject ? `${subject}: ${text || 'failed'}` : text];
  }
  return ['failed'];
}

/**
 * True when a body's `error` value reports a failure: `true`, text, or a non-empty list or object.
 * Numbers, `false`, blank text, `[]` and `{}` report none.
 */
export function reportsError(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  return isObject(value) && Object.keys(value).length > 0;
}

/**
 * Render a parsed HappyFox error body as one line naming each failing field.
 * Covers `error` as a string, a `[{field, errors}]` list or a field-keyed object; `errors`; `message`;
 * and bulk results whose `success: false` items carry `error`, `errors` or `data.message`.
 * @param body - the JSON-parsed response body
 * @param itemLabel - names a bulk item by its index; callers that validated the list pass the
 *   argument's own name, e.g. `tickets[0]`, so both kinds of error number items alike
 * @returns the message, or undefined when the body holds nothing recognisable
 */
export function formatErrorBody(
  body: unknown,
  itemLabel: (index: number) => string = index => `item ${index + 1}`
): string | undefined {
  let lines: string[] = [];

  if (typeof body === 'string') {
    lines = errorLines(body);
  } else if (Array.isArray(body)) {
    lines = body.flatMap((item, index) =>
      isObject(item) && item.success === false
        ? bulkItemLines(item).map(line => `${itemLabel(index)}: ${line}`)
        : []
    );
  } else if (isObject(body)) {
    // `error: true` flags a failure without describing it, so the text comes from errors or message.
    if (reportsError(body.error) && body.error !== true) {
      lines = errorLines(body.error);
    } else if (body.errors !== undefined) {
      lines = errorLines(body.errors);
    } else if (typeof body.message === 'string') {
      lines = errorLines(body.message);
    }
  }

  return lines.length > 0 ? lines.join('; ') : undefined;
}
