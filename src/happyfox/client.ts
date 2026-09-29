import { HappyFoxAuth } from '../types';
import { HappyFoxAPIError, formatErrorBody, reportsError } from './errors';
import { apiHostFor } from './host';
import { assertSafePath } from './paths';

export { HappyFoxAPIError, formatErrorBody } from './errors';

/** An array value is sent as one `key=value` pair per element, in order. */
export type QueryValue = string | number | boolean | ReadonlyArray<string | number>;
export type QueryParams = Record<string, QueryValue | undefined | null>;

export interface RequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  body?: any;
  queryParams?: QueryParams;
}

// Docs/1148: past 500 GET or 300 POST requests a minute, HappyFox answers 429 for the
// next 10 minutes, so retrying without a short Retry-After only delays the failure.
const RATE_LIMIT_RETRIES = 1;
const MAX_RETRY_AFTER_MS = 10_000;
const RATE_LIMIT_FALLBACK_DELAY_MS = 1000;

// Longest error text copied from a non-JSON error body.
const MAX_TEXT_ERROR_LENGTH = 500;

/**
 * Parse a Retry-After header (delta-seconds or HTTP-date).
 * @returns the wait in milliseconds, or undefined when absent or unparseable
 */
function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const value = header.trim();
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

/** True for a transport failure raised before any connection, so nothing reached HappyFox. */
function neverConnected(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 'ENOTFOUND' || code === 'ECONNREFUSED';
}

/** Release an unread body so the connection is not held open. */
async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Nothing to release.
  }
}

function rateLimitError(retryAfterMs: number | undefined): HappyFoxAPIError {
  const hint = retryAfterMs !== undefined
    ? ` HappyFox asked for a retry after ${Math.ceil(retryAfterMs / 1000)} s.`
    : '';
  return new HappyFoxAPIError(
    'HappyFox rate limit exceeded (HTTP 429). Once an account exceeds 500 GET or 300 POST ' +
      `requests per minute, HappyFox rejects API calls for up to 10 minutes.${hint} Wait before retrying.`,
    429,
    'RATE_LIMIT_EXCEEDED'
  );
}

export interface ClientOptions {
  /** Retries after a transport failure; defaults to 5. */
  maxRetries?: number;
}

export class HappyFoxClient {
  private baseUrl: string;
  private auth: HappyFoxAuth;
  private maxRetries: number;
  private baseDelay = 1000; // Start with 1 second
  private maxDelay = 60000; // Cap at 60 seconds

  /** @throws HappyFoxAPIError (400, INVALID_ACCOUNT) when the region, account name or custom host is invalid */
  constructor(auth: HappyFoxAuth, options: ClientOptions = {}) {
    this.auth = auth;
    this.baseUrl = `https://${apiHostFor(auth)}/api/1.1/json`;
    this.maxRetries = options.maxRetries ?? 5;
  }

  /**
   * Send one request and return its parsed JSON body.
   * Redirects are never followed: a POST that became a GET would report a write that never happened.
   * @throws HappyFoxAPIError for invalid paths, redirects, non-2xx statuses, empty or non-JSON bodies and transport failures
   */
  async makeRequest<T = any>(options: RequestOptions): Promise<T> {
    const { method, path, body, queryParams } = options;
    const url = this.buildUrl(path, queryParams);

    const init: RequestInit = {
      method,
      headers: {
        'Authorization': `Basic ${btoa(`${this.auth.apiKey}:${this.auth.authCode}`)}`,
        'Content-Type': 'application/json'
      },
      body: body !== undefined && body !== null ? JSON.stringify(body) : undefined,
      redirect: 'manual'
    };

    let networkRetries = 0;
    let rateLimitRetries = 0;

    for (;;) {
      let response: Response;
      try {
        response = await fetch(url, init);
      } catch (error) {
        if (networkRetries < this.maxRetries && this.isRetryableError(error, method)) {
          const delay = Math.min(this.baseDelay * Math.pow(2, networkRetries), this.maxDelay);
          networkRetries++;
          console.warn(`Network error. Retrying in ${Math.round(delay)}ms (attempt ${networkRetries}/${this.maxRetries})`);
          await this.sleep(delay);
          continue;
        }
        throw this.networkError(error, method);
      }

      if (response.status === 429) {
        await discardBody(response);
        const retryAfter = parseRetryAfter(response.headers.get('Retry-After'));
        const delay = retryAfter ?? RATE_LIMIT_FALLBACK_DELAY_MS + Math.random() * 1000;
        if (rateLimitRetries >= RATE_LIMIT_RETRIES || delay > MAX_RETRY_AFTER_MS) {
          throw rateLimitError(retryAfter);
        }
        rateLimitRetries++;
        console.warn(`Rate limited. Retrying in ${Math.round(delay)}ms`);
        await this.sleep(delay);
        continue;
      }

      return await this.readResponse<T>(response, method, url);
    }
  }

  private buildUrl(path: string, queryParams?: QueryParams): string {
    assertSafePath(path);

    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(queryParams ?? {})) {
      if (value === undefined || value === null) continue;
      const values = Array.isArray(value) ? value : [value];
      for (const item of values) params.append(key, String(item));
    }

    const query = params.toString();
    return `${this.baseUrl}${path}${query ? `?${query}` : ''}`;
  }

  private async readResponse<T>(response: Response, method: RequestOptions['method'], url: string): Promise<T> {
    const status = response.status;

    if (status >= 300 && status < 400) {
      await discardBody(response);
      throw new HappyFoxAPIError(
        `HappyFox redirected the request (HTTP ${status}) to ${this.redirectTarget(response, url)}. ` +
          'Redirects are not followed; check the account region (.happyfox.com or .happyfox.net) ' +
          'or whether the account moved to a custom domain.',
        status,
        'REDIRECT'
      );
    }

    let text: string;
    try {
      text = await response.text();
    } catch (error) {
      throw this.networkError(error, method);
    }

    if (!response.ok) {
      throw new HappyFoxAPIError(this.errorMessage(response, text), status, 'API_ERROR');
    }

    if (!text.trim()) {
      // DELETE /asset/<id>/ is the only DELETE and documents no body (Docs/1201 §5). A POST or PUT the
      // docs show no success body for (Docs/1039 §9-11, Docs/1092 §7, §11) still cannot confirm its write.
      if (method === 'DELETE') return {} as T;
      throw this.invalidResponse(response, method, 'an empty body');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw this.invalidResponse(response, method, 'a non-JSON body');
    }

    // Docs/1039 §8 gives a failure body without its status, so a body holding
    // nothing but an `error` that reports one is a failure even on 2xx.
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      const keys = Object.keys(parsed);
      if (keys.length === 1 && keys[0] === 'error' && reportsError((parsed as { error: unknown }).error)) {
        throw new HappyFoxAPIError(
          formatErrorBody(parsed) ?? 'HappyFox reported an error without details.',
          status,
          'API_ERROR'
        );
      }
    }

    return parsed as T;
  }

  private errorMessage(response: Response, text: string): string {
    const fallback = `HappyFox API error: ${response.status} ${response.statusText}`.trim();
    const trimmed = text.trim();
    if (!trimmed) return fallback;

    try {
      return formatErrorBody(JSON.parse(trimmed)) ?? fallback;
    } catch {
      // An HTML error page says nothing the status does not.
      if (trimmed.startsWith('<')) return fallback;
      return trimmed.length > MAX_TEXT_ERROR_LENGTH ? `${trimmed.slice(0, MAX_TEXT_ERROR_LENGTH)}...` : trimmed;
    }
  }

  private redirectTarget(response: Response, url: string): string {
    const location = response.headers?.get('Location');
    if (!location) return 'an unspecified location';
    try {
      return new URL(location, url).host;
    } catch {
      return 'an invalid location';
    }
  }

  private invalidResponse(response: Response, method: RequestOptions['method'], what: string): HappyFoxAPIError {
    const contentType = response.headers?.get('Content-Type');
    const outcome = method === 'GET'
      ? 'so the result cannot be confirmed.'
      : 'so the write cannot be confirmed; HappyFox may still have applied it, so check before repeating it.';
    return new HappyFoxAPIError(
      `HappyFox answered HTTP ${response.status} with ${what}${contentType ? ` (${contentType})` : ''}, ${outcome}`,
      response.status,
      'INVALID_RESPONSE'
    );
  }

  private networkError(error: unknown, method: RequestOptions['method']): HappyFoxAPIError {
    const reason = error instanceof Error ? error.message : String(error);
    const message = method !== 'GET' && !neverConnected(error)
      ? `Request failed: ${reason.replace(/\.$/, '')}. HappyFox may still have applied this write, so check before repeating it.`
      : `Request failed: ${reason}`;
    return new HappyFoxAPIError(message, 0, 'NETWORK_ERROR');
  }

  // Transport failures only: fetch() raises a TypeError, Node-style sockets set `.code`.
  // A write is retried only when it never connected: a repeated POST can duplicate a ticket or
  // reply, a repeated DELETE reports a completed delete as a failure, and a repeated choices PUT
  // recreates the choices it added under new ids.
  private isRetryableError(error: any, method: RequestOptions['method']): boolean {
    if (neverConnected(error)) return true;
    if (method !== 'GET') return false;
    if (error instanceof TypeError && error.message.includes('fetch')) return true;
    return ['ECONNRESET', 'ETIMEDOUT'].includes(error?.code);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async get<T = any>(path: string, queryParams?: QueryParams): Promise<T> {
    return this.makeRequest<T>({ method: 'GET', path, queryParams });
  }

  async post<T = any>(path: string, body?: any, queryParams?: QueryParams): Promise<T> {
    return this.makeRequest<T>({ method: 'POST', path, body, queryParams });
  }

  async put<T = any>(path: string, body?: any, queryParams?: QueryParams): Promise<T> {
    return this.makeRequest<T>({ method: 'PUT', path, body, queryParams });
  }

  async delete<T = any>(path: string, queryParams?: QueryParams): Promise<T> {
    return this.makeRequest<T>({ method: 'DELETE', path, queryParams });
  }
}
