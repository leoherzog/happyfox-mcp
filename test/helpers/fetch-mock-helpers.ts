import { fetchMock } from "./fetch-mock";

const HAPPYFOX_BASE_US = "https://testaccount.happyfox.com";
const HAPPYFOX_BASE_EU = "https://testaccount.happyfox.net";

function getHappyFoxBase(region: "us" | "eu" = "us"): string {
  return region === "us" ? HAPPYFOX_BASE_US : HAPPYFOX_BASE_EU;
}

export function resetFetchMock() {
  // Deactivate and reactivate to clear all interceptors
  fetchMock.deactivate();
  fetchMock.activate();
  fetchMock.disableNetConnect();
}

export { fetchMock };

/** Pool for an origin, pre-registered to intercept `path` for `method`. */
function interceptPool(path: string, method: string, region: "us" | "eu") {
  const pool = fetchMock.get(getHappyFoxBase(region));
  const interceptor = pool.intercept({
    // Use a function matcher to handle query parameters
    path: (actualPath: string) => actualPath.startsWith(`/api/1.1/json${path}`),
    method
  });
  return { pool, interceptor };
}

function mockHappyFox(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  response: unknown,
  status = 200,
  region: "us" | "eu" = "us"
) {
  const { pool, interceptor } = interceptPool(path, method, region);
  interceptor.reply(status, JSON.stringify(response), {
    headers: { "Content-Type": "application/json" }
  });
  return pool;
}

export const mockHappyFoxGet = (path: string, response: unknown, status = 200, region: "us" | "eu" = "us") =>
  mockHappyFox("GET", path, response, status, region);

export const mockHappyFoxPost = (path: string, response: unknown, status = 200, region: "us" | "eu" = "us") =>
  mockHappyFox("POST", path, response, status, region);

export const mockHappyFoxPut = (path: string, response: unknown, status = 200, region: "us" | "eu" = "us") =>
  mockHappyFox("PUT", path, response, status, region);

export const mockHappyFoxDelete = (path: string, response: unknown, status = 200, region: "us" | "eu" = "us") =>
  mockHappyFox("DELETE", path, response, status, region);

export function mockRateLimitResponse(
  path: string,
  method: "GET" | "POST" | "PUT" | "DELETE" = "GET",
  region: "us" | "eu" = "us"
) {
  const { pool, interceptor } = interceptPool(path, method, region);
  interceptor.reply(429, "Rate limit exceeded", {
    headers: { "Content-Type": "text/plain" }
  });
  return pool;
}

export function mockNetworkError(
  path: string,
  method: "GET" | "POST" | "PUT" | "DELETE" = "GET",
  region: "us" | "eu" = "us"
) {
  const { pool, interceptor } = interceptPool(path, method, region);
  interceptor.replyWithError(new Error("Network error"));
  return pool;
}
