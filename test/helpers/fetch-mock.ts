/**
 * Outbound fetch mocking for tests.
 *
 * `@cloudflare/vitest-pool-workers` has no fetch mock, so this module replaces
 * `globalThis.fetch` and keeps the slice of undici's MockAgent API the suite relies on:
 * `get(origin).intercept({...}).reply(...) / .replyWithError(...)`.
 *
 * Semantics that match undici:
 * - Interceptors are matched in registration order and consumed after one match.
 * - Unmatched requests reject (equivalent to `disableNetConnect()`).
 * - `assertNoPendingInterceptors()` fails if any registered interceptor went unused.
 *
 * Beyond undici: every request is recorded, matched or not, so a test can assert the
 * query string, JSON body, headers and redirect mode that actually went out.
 * Redirects are never followed: a 3xx reply reaches the caller as-is.
 */

/** Response reason phrases - undici sets these, the Response constructor does not. */
const STATUS_TEXT: Record<number, string> = {
  200: "OK",
  201: "Created",
  202: "Accepted",
  204: "No Content",
  301: "Moved Permanently",
  302: "Found",
  303: "See Other",
  307: "Temporary Redirect",
  308: "Permanent Redirect",
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  409: "Conflict",
  422: "Unprocessable Entity",
  429: "Too Many Requests",
  500: "Internal Server Error",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
};

// The Response constructor rejects a body for these statuses.
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

type PathMatcher = string | RegExp | ((path: string) => boolean);

export interface InterceptOptions {
  path: PathMatcher;
  method?: string;
}

interface ReplyOptions {
  headers?: Record<string, string>;
}

interface Interceptor {
  origin: string;
  method: string;
  path: PathMatcher;
  respond: () => Response;
  consumed: boolean;
}

/** One request as the code under test sent it. */
export interface SentRequest {
  method: string;
  url: URL;
  /** Pathname plus search, e.g. "/api/1.1/json/tickets/?page=1". */
  path: string;
  query: URLSearchParams;
  headers: Headers;
  body: string | undefined;
  redirect: RequestInit["redirect"];
  /** The body parsed as JSON; throws when there is no JSON body. */
  json(): unknown;
}

const interceptors: Interceptor[] = [];
const sentRequests: SentRequest[] = [];
let originalFetch: typeof globalThis.fetch | null = null;

function matchesPath(matcher: PathMatcher, path: string): boolean {
  if (typeof matcher === "function") return matcher(path);
  if (matcher instanceof RegExp) return matcher.test(path);
  return matcher === path;
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase();
  if (typeof input !== "string" && !(input instanceof URL)) return input.method.toUpperCase();
  return "GET";
}

async function requestBody(input: RequestInfo | URL, init?: RequestInit): Promise<string | undefined> {
  if (init?.body !== undefined && init.body !== null) {
    return typeof init.body === "string" ? init.body : await new Response(init.body).text();
  }
  if (input instanceof Request && input.body) return await input.clone().text();
  return undefined;
}

const mockedFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = new URL(requestUrl(input));
  const method = requestMethod(input, init);
  const path = `${url.pathname}${url.search}`;
  const body = await requestBody(input, init);

  sentRequests.push({
    method,
    url,
    path,
    query: url.searchParams,
    headers: new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)),
    body,
    redirect: init?.redirect ?? (input instanceof Request ? input.redirect : undefined),
    json() {
      if (body === undefined) throw new Error(`${method} ${url} was sent without a body`);
      return JSON.parse(body);
    },
  });

  const match = interceptors.find(
    i => !i.consumed && i.origin === url.origin && i.method === method && matchesPath(i.path, path)
  );

  if (!match) {
    // Equivalent to undici's disableNetConnect(): no real requests escape the test.
    throw new Error(`fetch is mocked and no interceptor matched ${method} ${url.toString()}`);
  }

  match.consumed = true;
  return match.respond();
};

class MockInterceptor {
  constructor(
    private readonly origin: string,
    private readonly options: InterceptOptions
  ) {}

  /** Reply with a status, optional body and headers. */
  reply(status: number, body: BodyInit = "", options: ReplyOptions = {}): void {
    interceptors.push({
      origin: this.origin,
      method: (this.options.method ?? "GET").toUpperCase(),
      path: this.options.path,
      consumed: false,
      respond: () =>
        new Response(NULL_BODY_STATUSES.has(status) ? null : body, {
          status,
          statusText: STATUS_TEXT[status] ?? "",
          headers: options.headers,
        }),
    });
  }

  /** Reject the request, as a transport-level failure would. */
  replyWithError(error: Error): void {
    interceptors.push({
      origin: this.origin,
      method: (this.options.method ?? "GET").toUpperCase(),
      path: this.options.path,
      consumed: false,
      respond: () => {
        throw error;
      },
    });
  }
}

class MockPool {
  constructor(private readonly origin: string) {}

  intercept(options: InterceptOptions): MockInterceptor {
    return new MockInterceptor(this.origin, options);
  }
}

export const fetchMock = {
  /** Get a pool for an origin, e.g. "https://testaccount.happyfox.com". */
  get(origin: string): MockPool {
    return new MockPool(origin);
  },

  /** Install the mock over globalThis.fetch. */
  activate(): void {
    if (originalFetch) return;
    originalFetch = globalThis.fetch;
    globalThis.fetch = mockedFetch as typeof globalThis.fetch;
  },

  /** Restore the real fetch and drop every interceptor and recorded request. */
  deactivate(): void {
    if (originalFetch) {
      globalThis.fetch = originalFetch;
      originalFetch = null;
    }
    interceptors.length = 0;
    sentRequests.length = 0;
  },

  /** Every request sent since the last deactivate(), in order. */
  requests(): readonly SentRequest[] {
    return sentRequests;
  },

  /** The most recent request; throws when none was sent. */
  lastRequest(): SentRequest {
    const last = sentRequests[sentRequests.length - 1];
    if (!last) throw new Error("fetch was never called");
    return last;
  },

  /** No-op: this mock never lets a request reach the network. */
  disableNetConnect(): void {},

  /** Interceptors registered but never matched. */
  pendingInterceptors(): Interceptor[] {
    return interceptors.filter(i => !i.consumed);
  },

  assertNoPendingInterceptors(): void {
    const pending = this.pendingInterceptors();
    if (pending.length > 0) {
      const list = pending.map(i => `  ${i.method} ${i.origin} ${String(i.path)}`).join("\n");
      throw new Error(`${pending.length} interceptor(s) were never used:\n${list}`);
    }
  },
};
