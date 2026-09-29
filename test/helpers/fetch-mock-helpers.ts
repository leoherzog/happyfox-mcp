import { fetchMock, type SentRequest } from "./fetch-mock";

const HAPPYFOX_BASE_US = "https://testaccount.happyfox.com";
const HAPPYFOX_BASE_EU = "https://testaccount.happyfox.net";
const API_PREFIX = "/api/1.1/json";

type Method = "GET" | "POST" | "PUT" | "DELETE";
type Region = "us" | "eu";

function getHappyFoxBase(region: Region = "us"): string {
  return region === "us" ? HAPPYFOX_BASE_US : HAPPYFOX_BASE_EU;
}

export function resetFetchMock() {
  // Deactivate and reactivate to clear all interceptors and recorded requests
  fetchMock.deactivate();
  fetchMock.activate();
  fetchMock.disableNetConnect();
}

export { fetchMock };

/**
 * Matches an API path exactly. A `path` without "?" matches any query string;
 * one with "?" must equal the request's path and query byte for byte.
 */
function apiPathMatcher(path: string) {
  const expected = `${API_PREFIX}${path}`;
  return (actualPath: string) =>
    path.includes("?") ? actualPath === expected : actualPath.split("?")[0] === expected;
}

/** Pool for an origin, pre-registered to intercept `path` for `method`. */
function interceptPool(path: string, method: string, region: Region) {
  const pool = fetchMock.get(getHappyFoxBase(region));
  const interceptor = pool.intercept({ path: apiPathMatcher(path), method });
  return { pool, interceptor };
}

function mockHappyFox(method: Method, path: string, response: unknown, status = 200, region: Region = "us") {
  const { pool, interceptor } = interceptPool(path, method, region);
  interceptor.reply(status, JSON.stringify(response), {
    headers: { "Content-Type": "application/json" }
  });
  return pool;
}

export const mockHappyFoxGet = (path: string, response: unknown, status = 200, region: Region = "us") =>
  mockHappyFox("GET", path, response, status, region);

export const mockHappyFoxPost = (path: string, response: unknown, status = 200, region: Region = "us") =>
  mockHappyFox("POST", path, response, status, region);

export const mockHappyFoxPut = (path: string, response: unknown, status = 200, region: Region = "us") =>
  mockHappyFox("PUT", path, response, status, region);

export const mockHappyFoxDelete = (path: string, response: unknown, status = 200, region: Region = "us") =>
  mockHappyFox("DELETE", path, response, status, region);

/** Reply with a raw body and headers, e.g. a redirect, an HTML page or an empty 2xx. */
export function mockHappyFoxRaw(
  method: Method,
  path: string,
  status: number,
  body = "",
  headers: Record<string, string> = {},
  region: Region = "us"
) {
  const { pool, interceptor } = interceptPool(path, method, region);
  interceptor.reply(status, body, { headers });
  return pool;
}

export function mockRateLimitResponse(
  path: string,
  method: Method = "GET",
  region: Region = "us",
  headers: Record<string, string> = {}
) {
  const { pool, interceptor } = interceptPool(path, method, region);
  interceptor.reply(429, "Rate limit exceeded", {
    headers: { "Content-Type": "text/plain", ...headers }
  });
  return pool;
}

export function mockNetworkError(path: string, method: Method = "GET", region: Region = "us") {
  const { pool, interceptor } = interceptPool(path, method, region);
  interceptor.replyWithError(new Error("Network error"));
  return pool;
}

/** A recorded request plus its path relative to /api/1.1/json. */
export interface SentHappyFoxRequest extends SentRequest {
  apiPath: string;
}

function withApiPath(request: SentRequest): SentHappyFoxRequest {
  const { pathname } = request.url;
  const apiPath = pathname.startsWith(API_PREFIX) ? pathname.slice(API_PREFIX.length) : pathname;
  return { ...request, apiPath };
}

/** Every request sent to HappyFox since the last reset, in order. */
export function sentHappyFoxRequests(): SentHappyFoxRequest[] {
  return fetchMock.requests().map(withApiPath);
}

/** The most recent request sent to HappyFox; throws when none was sent. */
export function lastHappyFoxRequest(): SentHappyFoxRequest {
  return withApiPath(fetchMock.lastRequest());
}
