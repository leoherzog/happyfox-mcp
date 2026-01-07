import { fetchMock } from "cloudflare:test";

const HAPPYFOX_BASE_US = "https://testaccount.happyfox.com";
const HAPPYFOX_BASE_EU = "https://testaccount.happyfox.net";

export function getHappyFoxBase(region: "us" | "eu" = "us"): string {
  return region === "us" ? HAPPYFOX_BASE_US : HAPPYFOX_BASE_EU;
}

export function resetFetchMock() {
  // Deactivate and reactivate to clear all interceptors
  fetchMock.deactivate();
  fetchMock.activate();
  fetchMock.disableNetConnect();
}

export function mockHappyFoxGet(
  path: string,
  response: unknown,
  status = 200,
  region: "us" | "eu" = "us"
) {
  const base = getHappyFoxBase(region);
  const pool = fetchMock.get(base);
  // Use a function matcher to handle query parameters
  pool
    .intercept({
      path: (actualPath: string) => actualPath.startsWith(`/api/1.1/json${path}`),
      method: "GET"
    })
    .reply(status, JSON.stringify(response), {
      headers: { "Content-Type": "application/json" }
    });
  return pool;
}

export function mockHappyFoxPost(
  path: string,
  response: unknown,
  status = 200,
  region: "us" | "eu" = "us"
) {
  const base = getHappyFoxBase(region);
  const pool = fetchMock.get(base);
  pool
    .intercept({
      path: (actualPath: string) => actualPath.startsWith(`/api/1.1/json${path}`),
      method: "POST"
    })
    .reply(status, JSON.stringify(response), {
      headers: { "Content-Type": "application/json" }
    });
  return pool;
}

export function mockHappyFoxPut(
  path: string,
  response: unknown,
  status = 200,
  region: "us" | "eu" = "us"
) {
  const base = getHappyFoxBase(region);
  const pool = fetchMock.get(base);
  pool
    .intercept({
      path: (actualPath: string) => actualPath.startsWith(`/api/1.1/json${path}`),
      method: "PUT"
    })
    .reply(status, JSON.stringify(response), {
      headers: { "Content-Type": "application/json" }
    });
  return pool;
}

export function mockHappyFoxDelete(
  path: string,
  response: unknown,
  status = 200,
  region: "us" | "eu" = "us"
) {
  const base = getHappyFoxBase(region);
  const pool = fetchMock.get(base);
  pool
    .intercept({
      path: (actualPath: string) => actualPath.startsWith(`/api/1.1/json${path}`),
      method: "DELETE"
    })
    .reply(status, JSON.stringify(response), {
      headers: { "Content-Type": "application/json" }
    });
  return pool;
}

export function mockRateLimitResponse(
  path: string,
  method: "GET" | "POST" | "PUT" | "DELETE" = "GET",
  region: "us" | "eu" = "us"
) {
  const base = getHappyFoxBase(region);
  const pool = fetchMock.get(base);
  pool
    .intercept({
      path: (actualPath: string) => actualPath.startsWith(`/api/1.1/json${path}`),
      method
    })
    .reply(429, "Rate limit exceeded", {
      headers: { "Content-Type": "text/plain" }
    });
  return pool;
}

export function mockNetworkError(
  path: string,
  method: "GET" | "POST" | "PUT" | "DELETE" = "GET",
  region: "us" | "eu" = "us"
) {
  const base = getHappyFoxBase(region);
  const pool = fetchMock.get(base);
  pool
    .intercept({
      path: (actualPath: string) => actualPath.startsWith(`/api/1.1/json${path}`),
      method
    })
    .replyWithError(new Error("Network error"));
  return pool;
}

export function mockServerError(
  path: string,
  method: "GET" | "POST" | "PUT" | "DELETE" = "GET",
  region: "us" | "eu" = "us"
) {
  const base = getHappyFoxBase(region);
  const pool = fetchMock.get(base);
  pool
    .intercept({
      path: (actualPath: string) => actualPath.startsWith(`/api/1.1/json${path}`),
      method
    })
    .reply(500, "Internal Server Error", {
      headers: { "Content-Type": "text/plain" }
    });
  return pool;
}
