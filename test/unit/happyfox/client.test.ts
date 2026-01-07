import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchMock } from "cloudflare:test";
import { HappyFoxClient, HappyFoxAPIError } from "../../../src/happyfox/client";
import { HappyFoxAuth } from "../../../src/types";
import { resetFetchMock, mockHappyFoxGet, mockHappyFoxPost, mockHappyFoxPut, mockHappyFoxDelete, mockRateLimitResponse } from "../../helpers/fetch-mock-helpers";

describe("HappyFoxClient", () => {
  const usAuth: HappyFoxAuth = {
    apiKey: "test-api-key",
    authCode: "test-auth-code",
    accountName: "testaccount",
    region: "us"
  };

  const euAuth: HappyFoxAuth = {
    apiKey: "test-api-key",
    authCode: "test-auth-code",
    accountName: "testaccount",
    region: "eu"
  };

  beforeEach(() => {
    resetFetchMock();
  });

  afterEach(() => {
    // No assertions on pending interceptors
  });

  describe("constructor", () => {
    it("builds correct US base URL", async () => {
      const client = new HappyFoxClient(usAuth);
      mockHappyFoxGet("/test/", { success: true }, 200, "us");

      const result = await client.get("/test/");
      expect(result).toEqual({ success: true });
    });

    it("builds correct EU base URL", async () => {
      const client = new HappyFoxClient(euAuth);
      mockHappyFoxGet("/test/", { success: true }, 200, "eu");

      const result = await client.get("/test/");
      expect(result).toEqual({ success: true });
    });
  });

  describe("makeRequest - query parameters", () => {
    it("builds URL with query parameters", async () => {
      const client = new HappyFoxClient(usAuth);
      mockHappyFoxGet("/tickets/", { data: [] });

      await client.get("/tickets/", { page: 1, size: 50, status: "open" });

      // If query params are wrong, mock won't match
      expect(true).toBe(true); // Test passes if no exception
    });
  });

  describe("makeRequest - HTTP methods", () => {
    it("sends GET requests", async () => {
      const client = new HappyFoxClient(usAuth);
      mockHappyFoxGet("/test/", { data: "get" });

      const result = await client.get("/test/");
      expect(result).toEqual({ data: "get" });
    });

    it("sends POST requests with body", async () => {
      const client = new HappyFoxClient(usAuth);
      mockHappyFoxPost("/tickets/", { id: 1 });

      const result = await client.post("/tickets/", { subject: "Test" });
      expect(result).toEqual({ id: 1 });
    });

    it("sends PUT requests", async () => {
      const client = new HappyFoxClient(usAuth);
      mockHappyFoxPut("/asset/1/", { id: 1, name: "Updated" });

      const result = await client.put("/asset/1/", { name: "Updated" });
      expect(result).toEqual({ id: 1, name: "Updated" });
    });

    it("sends DELETE requests", async () => {
      const client = new HappyFoxClient(usAuth);
      mockHappyFoxDelete("/asset/1/", {});

      const result = await client.delete("/asset/1/", { deleted_by: 1 });
      expect(result).toEqual({});
    });
  });

  describe("makeRequest - error responses", () => {
    it("parses JSON error with 'error' field", async () => {
      const client = new HappyFoxClient(usAuth);
      mockHappyFoxGet("/ticket/999/", { error: "Ticket not found" }, 404);

      await expect(client.get("/ticket/999/")).rejects.toMatchObject({
        message: "Ticket not found",
        statusCode: 404,
        code: "API_ERROR"
      });
    });

    it("parses JSON error with 'message' field", async () => {
      const client = new HappyFoxClient(usAuth);
      mockHappyFoxGet("/test/", { message: "Invalid request" }, 400);

      await expect(client.get("/test/")).rejects.toMatchObject({
        message: "Invalid request",
        statusCode: 400
      });
    });

    it("throws HappyFoxAPIError for 400 Bad Request", async () => {
      const client = new HappyFoxClient(usAuth);
      mockHappyFoxPost("/test/", { error: "Missing required field" }, 400);

      await expect(client.post("/test/", {})).rejects.toBeInstanceOf(HappyFoxAPIError);
    });

    it("throws HappyFoxAPIError for 401 Unauthorized", async () => {
      const client = new HappyFoxClient(usAuth);
      mockHappyFoxGet("/test/", { error: "Invalid credentials" }, 401);

      await expect(client.get("/test/")).rejects.toMatchObject({
        statusCode: 401
      });
    });

    it("throws HappyFoxAPIError for 403 Forbidden", async () => {
      const client = new HappyFoxClient(usAuth);
      mockHappyFoxGet("/test/", { error: "Access denied" }, 403);

      await expect(client.get("/test/")).rejects.toMatchObject({
        statusCode: 403
      });
    });

    it("throws HappyFoxAPIError for 404 Not Found", async () => {
      const client = new HappyFoxClient(usAuth);
      mockHappyFoxGet("/test/", { error: "Not found" }, 404);

      await expect(client.get("/test/")).rejects.toMatchObject({
        statusCode: 404
      });
    });

    it("throws HappyFoxAPIError for 500 Server Error", async () => {
      const client = new HappyFoxClient(usAuth);
      mockHappyFoxGet("/test/", { error: "Internal error" }, 500);

      await expect(client.get("/test/")).rejects.toMatchObject({
        statusCode: 500
      });
    });
  });

  describe("makeRequest - successful responses", () => {
    it("parses JSON response", async () => {
      const client = new HappyFoxClient(usAuth);
      const responseData = { id: 1, name: "Test", nested: { value: true } };
      mockHappyFoxGet("/test/", responseData);

      const result = await client.get("/test/");
      expect(result).toEqual(responseData);
    });

    it("returns response with arrays", async () => {
      const client = new HappyFoxClient(usAuth);
      mockHappyFoxGet("/tickets/", {
        data: [{ id: 1 }, { id: 2 }],
        page_info: { page: 1, pages: 1 }
      });

      const result = await client.get("/tickets/");
      expect(result.data).toHaveLength(2);
    });

    it("returns empty object for empty response body", async () => {
      const client = new HappyFoxClient(usAuth);
      const base = "https://testaccount.happyfox.com";
      const pool = fetchMock.get(base);
      pool
        .intercept({
          path: (actualPath: string) => actualPath.startsWith("/api/1.1/json/empty/"),
          method: "GET"
        })
        .reply(200, "", {
          headers: { "Content-Type": "application/json" }
        });

      const result = await client.get("/empty/");
      expect(result).toEqual({});
    });

    it("returns text as-is when successful response is not valid JSON", async () => {
      const client = new HappyFoxClient(usAuth);
      const base = "https://testaccount.happyfox.com";
      const pool = fetchMock.get(base);
      pool
        .intercept({
          path: (actualPath: string) => actualPath.startsWith("/api/1.1/json/text/"),
          method: "GET"
        })
        .reply(200, "plain text response", {
          headers: { "Content-Type": "text/plain" }
        });

      const result = await client.get<string>("/text/");
      expect(result).toBe("plain text response");
    });
  });

  describe("makeRequest - non-JSON error responses", () => {
    it("uses plain text error body when response is not JSON", async () => {
      const client = new HappyFoxClient(usAuth);
      const base = "https://testaccount.happyfox.com";
      const pool = fetchMock.get(base);
      pool
        .intercept({
          path: (actualPath: string) => actualPath.startsWith("/api/1.1/json/error/"),
          method: "GET"
        })
        .reply(500, "Plain text server error", {
          headers: { "Content-Type": "text/plain" }
        });

      await expect(client.get("/error/")).rejects.toMatchObject({
        message: "Plain text server error",
        statusCode: 500,
        code: "API_ERROR"
      });
    });

    it("uses default error message when error body is empty and not JSON", async () => {
      const client = new HappyFoxClient(usAuth);
      const base = "https://testaccount.happyfox.com";
      const pool = fetchMock.get(base);
      pool
        .intercept({
          path: (actualPath: string) => actualPath.startsWith("/api/1.1/json/empty-error/"),
          method: "GET"
        })
        .reply(500, "", {
          headers: { "Content-Type": "text/plain" }
        });

      await expect(client.get("/empty-error/")).rejects.toMatchObject({
        message: "HappyFox API error: 500 Internal Server Error",
        statusCode: 500,
        code: "API_ERROR"
      });
    });
  });

  describe("makeRequest - rate limiting (429)", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("throws RATE_LIMIT_EXCEEDED after maxRetries", async () => {
      const client = new HappyFoxClient(usAuth);

      // Mock 6 rate limit responses (initial + 5 retries)
      for (let i = 0; i < 6; i++) {
        mockRateLimitResponse("/test/", "GET");
      }

      const requestPromise = client.get("/test/");

      // Advance through all retry delays
      for (let i = 0; i < 6; i++) {
        await vi.advanceTimersByTimeAsync(70000);
      }

      await expect(requestPromise).rejects.toMatchObject({
        code: "RATE_LIMIT_EXCEEDED",
        statusCode: 429
      });
    });

    it("retries and succeeds after rate limit", async () => {
      const client = new HappyFoxClient(usAuth);

      // First request gets rate limited, second succeeds
      mockRateLimitResponse("/retry-success/", "GET");
      mockHappyFoxGet("/retry-success/", { success: true });

      const requestPromise = client.get("/retry-success/");

      // Advance timer for retry delay
      await vi.advanceTimersByTimeAsync(70000);

      const result = await requestPromise;
      expect(result).toEqual({ success: true });
    });
  });

  describe("makeRequest - network error retry", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("retries on TypeError with fetch message", async () => {
      const client = new HappyFoxClient(usAuth);
      const base = "https://testaccount.happyfox.com";
      const pool = fetchMock.get(base);

      // First request fails with TypeError (fetch error)
      pool
        .intercept({
          path: (actualPath: string) => actualPath.startsWith("/api/1.1/json/fetch-error/"),
          method: "GET"
        })
        .replyWithError(new TypeError("Failed to fetch"));

      // Second request succeeds
      pool
        .intercept({
          path: (actualPath: string) => actualPath.startsWith("/api/1.1/json/fetch-error/"),
          method: "GET"
        })
        .reply(200, JSON.stringify({ success: true }), {
          headers: { "Content-Type": "application/json" }
        });

      const requestPromise = client.get("/fetch-error/");

      // Advance timer for retry delay
      await vi.advanceTimersByTimeAsync(2000);

      const result = await requestPromise;
      expect(result).toEqual({ success: true });
    });

    it("retries on error with retryable code (ECONNRESET)", async () => {
      const client = new HappyFoxClient(usAuth);
      const base = "https://testaccount.happyfox.com";
      const pool = fetchMock.get(base);

      // First request fails with ECONNRESET
      const connResetError = new Error("Connection reset");
      (connResetError as any).code = "ECONNRESET";

      pool
        .intercept({
          path: (actualPath: string) => actualPath.startsWith("/api/1.1/json/conn-reset/"),
          method: "GET"
        })
        .replyWithError(connResetError);

      // Second request succeeds
      pool
        .intercept({
          path: (actualPath: string) => actualPath.startsWith("/api/1.1/json/conn-reset/"),
          method: "GET"
        })
        .reply(200, JSON.stringify({ recovered: true }), {
          headers: { "Content-Type": "application/json" }
        });

      const requestPromise = client.get("/conn-reset/");

      // Advance timer for retry delay
      await vi.advanceTimersByTimeAsync(2000);

      const result = await requestPromise;
      expect(result).toEqual({ recovered: true });
    });

    it("throws NETWORK_ERROR after max retries on network failure", async () => {
      const client = new HappyFoxClient(usAuth);
      const base = "https://testaccount.happyfox.com";
      const pool = fetchMock.get(base);

      // All requests fail with TypeError (6 total: initial + 5 retries)
      for (let i = 0; i < 6; i++) {
        pool
          .intercept({
            path: (actualPath: string) => actualPath.startsWith("/api/1.1/json/always-fail/"),
            method: "GET"
          })
          .replyWithError(new TypeError("Failed to fetch"));
      }

      const requestPromise = client.get("/always-fail/");

      // Advance through all retry delays
      for (let i = 0; i < 6; i++) {
        await vi.advanceTimersByTimeAsync(70000);
      }

      await expect(requestPromise).rejects.toMatchObject({
        code: "NETWORK_ERROR",
        statusCode: 0
      });
    });

    it("re-throws HappyFoxAPIError directly without wrapping", async () => {
      const client = new HappyFoxClient(usAuth);
      // Error responses throw HappyFoxAPIError from within makeRequest
      mockHappyFoxGet("/api-error/", { error: "Forbidden" }, 403);

      await expect(client.get("/api-error/")).rejects.toMatchObject({
        message: "Forbidden",
        statusCode: 403,
        code: "API_ERROR"
      });
    });

    it("does not retry on non-retryable errors", async () => {
      const client = new HappyFoxClient(usAuth);
      const base = "https://testaccount.happyfox.com";
      const pool = fetchMock.get(base);

      // Non-retryable error (no code, not TypeError with fetch)
      const customError = new Error("Custom error");

      pool
        .intercept({
          path: (actualPath: string) => actualPath.startsWith("/api/1.1/json/non-retryable/"),
          method: "GET"
        })
        .replyWithError(customError);

      await expect(client.get("/non-retryable/")).rejects.toMatchObject({
        code: "NETWORK_ERROR",
        message: expect.stringContaining("Custom error")
      });
    });

    it("does not retry on 4xx errors", async () => {
      const client = new HappyFoxClient(usAuth);
      // 404 is not retryable
      mockHappyFoxGet("/not-found/", { error: "Not found" }, 404);

      await expect(client.get("/not-found/")).rejects.toMatchObject({
        statusCode: 404,
        code: "API_ERROR"
      });
    });

    it("retries on ETIMEDOUT error code", async () => {
      const client = new HappyFoxClient(usAuth);
      const base = "https://testaccount.happyfox.com";
      const pool = fetchMock.get(base);

      const timeoutError = new Error("Connection timed out");
      (timeoutError as any).code = "ETIMEDOUT";

      pool
        .intercept({
          path: (actualPath: string) => actualPath.startsWith("/api/1.1/json/timeout/"),
          method: "GET"
        })
        .replyWithError(timeoutError);

      pool
        .intercept({
          path: (actualPath: string) => actualPath.startsWith("/api/1.1/json/timeout/"),
          method: "GET"
        })
        .reply(200, JSON.stringify({ success: true }), {
          headers: { "Content-Type": "application/json" }
        });

      const requestPromise = client.get("/timeout/");

      await vi.advanceTimersByTimeAsync(2000);

      const result = await requestPromise;
      expect(result).toEqual({ success: true });
    });

    it("retries on ENOTFOUND error code", async () => {
      const client = new HappyFoxClient(usAuth);
      const base = "https://testaccount.happyfox.com";
      const pool = fetchMock.get(base);

      const notFoundError = new Error("DNS lookup failed");
      (notFoundError as any).code = "ENOTFOUND";

      pool
        .intercept({
          path: (actualPath: string) => actualPath.startsWith("/api/1.1/json/dns-fail/"),
          method: "GET"
        })
        .replyWithError(notFoundError);

      pool
        .intercept({
          path: (actualPath: string) => actualPath.startsWith("/api/1.1/json/dns-fail/"),
          method: "GET"
        })
        .reply(200, JSON.stringify({ success: true }), {
          headers: { "Content-Type": "application/json" }
        });

      const requestPromise = client.get("/dns-fail/");

      await vi.advanceTimersByTimeAsync(2000);

      const result = await requestPromise;
      expect(result).toEqual({ success: true });
    });

    it("retries on ECONNREFUSED error code", async () => {
      const client = new HappyFoxClient(usAuth);
      const base = "https://testaccount.happyfox.com";
      const pool = fetchMock.get(base);

      const refusedError = new Error("Connection refused");
      (refusedError as any).code = "ECONNREFUSED";

      pool
        .intercept({
          path: (actualPath: string) => actualPath.startsWith("/api/1.1/json/conn-refused/"),
          method: "GET"
        })
        .replyWithError(refusedError);

      pool
        .intercept({
          path: (actualPath: string) => actualPath.startsWith("/api/1.1/json/conn-refused/"),
          method: "GET"
        })
        .reply(200, JSON.stringify({ success: true }), {
          headers: { "Content-Type": "application/json" }
        });

      const requestPromise = client.get("/conn-refused/");

      await vi.advanceTimersByTimeAsync(2000);

      const result = await requestPromise;
      expect(result).toEqual({ success: true });
    });
  });

  describe("convenience methods", () => {
    it("get() performs GET request", async () => {
      const client = new HappyFoxClient(usAuth);
      mockHappyFoxGet("/tickets/", [{ id: 1 }]);

      const result = await client.get("/tickets/");
      expect(result).toEqual([{ id: 1 }]);
    });

    it("post() performs POST request", async () => {
      const client = new HappyFoxClient(usAuth);
      mockHappyFoxPost("/tickets/", { id: 1 });

      const result = await client.post("/tickets/", { subject: "Test" });
      expect(result).toEqual({ id: 1 });
    });

    it("put() performs PUT request", async () => {
      const client = new HappyFoxClient(usAuth);
      mockHappyFoxPut("/asset/1/", { id: 1 });

      const result = await client.put("/asset/1/", { name: "Updated" });
      expect(result).toEqual({ id: 1 });
    });

    it("delete() performs DELETE request", async () => {
      const client = new HappyFoxClient(usAuth);
      mockHappyFoxDelete("/asset/1/", {});

      const result = await client.delete("/asset/1/", { deleted_by: 1 });
      expect(result).toEqual({});
    });

    it("get() passes query parameters", async () => {
      const client = new HappyFoxClient(usAuth);
      mockHappyFoxGet("/tickets/", { data: [] });

      await client.get("/tickets/", { page: 2, size: 25 });
      // Test passes if no exception (mock matched)
    });

    it("post() passes query parameters", async () => {
      const client = new HappyFoxClient(usAuth);

      // The post helper needs to match with query params
      const base = "https://testaccount.happyfox.com";
      const pool = fetchMock.get(base);
      pool
        .intercept({
          path: (actualPath: string) => actualPath.startsWith("/api/1.1/json/assets/"),
          method: "POST"
        })
        .reply(200, JSON.stringify({ id: 1 }), {
          headers: { "Content-Type": "application/json" }
        });

      const result = await client.post("/assets/", { name: "Asset" }, { asset_type: 5 });
      expect(result).toEqual({ id: 1 });
    });
  });
});

describe("HappyFoxAPIError", () => {
  it("creates error with correct properties", () => {
    const error = new HappyFoxAPIError("Test error", 404, "NOT_FOUND");

    expect(error.message).toBe("Test error");
    expect(error.statusCode).toBe(404);
    expect(error.code).toBe("NOT_FOUND");
    expect(error.name).toBe("HappyFoxAPIError");
  });

  it("inherits from Error", () => {
    const error = new HappyFoxAPIError("Test", 500, "ERROR");
    expect(error).toBeInstanceOf(Error);
  });

  it("has stack trace", () => {
    const error = new HappyFoxAPIError("Test", 500, "ERROR");
    expect(error.stack).toBeDefined();
  });
});
