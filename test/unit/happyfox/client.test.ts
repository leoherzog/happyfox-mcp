import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchMock } from "../../helpers/fetch-mock";
import { HappyFoxClient, HappyFoxAPIError } from "../../../src/happyfox/client";
import { HappyFoxAuth } from "../../../src/types";
import {
  resetFetchMock,
  mockHappyFoxGet,
  mockHappyFoxPost,
  mockHappyFoxPut,
  mockHappyFoxDelete,
  mockHappyFoxRaw,
  mockRateLimitResponse,
  lastHappyFoxRequest,
  sentHappyFoxRequests
} from "../../helpers/fetch-mock-helpers";

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

  describe("constructor", () => {
    it("builds correct US base URL", async () => {
      const client = new HappyFoxClient(usAuth);
      mockHappyFoxGet("/test/", { success: true }, 200, "us");

      const result = await client.get("/test/");
      expect(result).toEqual({ success: true });
      expect(lastHappyFoxRequest().url.origin).toBe("https://testaccount.happyfox.com");
    });

    it("builds correct EU base URL", async () => {
      const client = new HappyFoxClient(euAuth);
      mockHappyFoxGet("/test/", { success: true }, 200, "eu");

      const result = await client.get("/test/");
      expect(result).toEqual({ success: true });
      expect(lastHappyFoxRequest().url.origin).toBe("https://testaccount.happyfox.net");
    });

    it("sends every request to the custom domain when one is set (Docs/1039 note 1)", async () => {
      const client = new HappyFoxClient({ ...usAuth, apiHost: "support.example.com" });
      fetchMock.get("https://support.example.com")
        .intercept({ path: "/api/1.1/json/tickets/", method: "GET" })
        .reply(200, JSON.stringify({ data: [] }), { headers: { "Content-Type": "application/json" } });

      await client.get("/tickets/");
      expect(lastHappyFoxRequest().url.toString()).toBe("https://support.example.com/api/1.1/json/tickets/");
    });

    it.each(["us/../eu", "../eu/victim/staff#", "EU"])("refuses the region %j before any request", (region) => {
      expect(() => new HappyFoxClient({ ...usAuth, region: region as any })).toThrow(HappyFoxAPIError);
      expect(sentHappyFoxRequests()).toHaveLength(0);
    });

    it.each(["https://support.example.com", "support.example.com:8443", "127.0.0.1", "api.localhost"])(
      "refuses the custom host %j before any request",
      (apiHost) => {
        expect(() => new HappyFoxClient({ ...usAuth, apiHost })).toThrow(HappyFoxAPIError);
        expect(sentHappyFoxRequests()).toHaveLength(0);
      }
    );
  });

  describe("makeRequest - request on the wire", () => {
    it("sends Basic auth built from the API key and auth code (Docs/1039)", async () => {
      const client = new HappyFoxClient(usAuth);
      mockHappyFoxGet("/test/", {});

      await client.get("/test/");

      const sent = lastHappyFoxRequest();
      expect(sent.headers.get("Authorization")).toBe(`Basic ${btoa("test-api-key:test-auth-code")}`);
      expect(sent.headers.get("Content-Type")).toBe("application/json");
    });

    it("sends the JSON body and never follows redirects", async () => {
      const client = new HappyFoxClient(usAuth);
      mockHappyFoxPost("/tickets/", { id: 1 });

      await client.post("/tickets/", { subject: "Test", tags: "a,b" });

      const sent = lastHappyFoxRequest();
      expect(sent.method).toBe("POST");
      expect(sent.apiPath).toBe("/tickets/");
      expect(sent.json()).toEqual({ subject: "Test", tags: "a,b" });
      expect(sent.redirect).toBe("manual");
    });

    it("sends no body on GET", async () => {
      const client = new HappyFoxClient(usAuth);
      mockHappyFoxGet("/test/", {});

      await client.get("/test/");

      expect(lastHappyFoxRequest().body).toBeUndefined();
    });
  });

  describe("makeRequest - query parameters", () => {
    it("encodes query parameters in order", async () => {
      const client = new HappyFoxClient(usAuth);
      mockHappyFoxGet("/tickets/", { data: [] });

      await client.get("/tickets/", { page: 1, size: 50, status: "_pending" });

      expect(lastHappyFoxRequest().url.search).toBe("?page=1&size=50&status=_pending");
    });

    it("sends each array element under the same key", async () => {
      const client = new HappyFoxClient(usAuth);
      mockHappyFoxGet("/tickets/", { data: [] });

      await client.get("/tickets/", { category: [1, 2], fields: ["id"] });

      const sent = lastHappyFoxRequest();
      expect(sent.url.search).toBe("?category=1&category=2&fields=id");
      expect(sent.query.getAll("category")).toEqual(["1", "2"]);
    });

    it("skips undefined and null values", async () => {
      const client = new HappyFoxClient(usAuth);
      mockHappyFoxGet("/tickets/", { data: [] });

      await client.get("/tickets/", { page: 1, q: undefined, status: null });

      expect(lastHappyFoxRequest().url.search).toBe("?page=1");
    });

    it("omits the query string when there are no parameters", async () => {
      const client = new HappyFoxClient(usAuth);
      mockHappyFoxGet("/tickets/", { data: [] });

      await client.get("/tickets/", {});

      expect(lastHappyFoxRequest().path).toBe("/api/1.1/json/tickets/");
    });

    it("form-encodes a space as + (Docs/1039 search strings)", async () => {
      const client = new HappyFoxClient(usAuth);
      mockHappyFoxGet("/tickets/", { data: [] });

      await client.get("/tickets/", { q: "status:In Progress" });

      expect(lastHappyFoxRequest().url.search).toBe("?q=status%3AIn+Progress");
    });

    it("keeps query parameters on POST", async () => {
      const client = new HappyFoxClient(usAuth);
      mockHappyFoxPost("/assets/?asset_type=5", { id: 1 });

      const result = await client.post("/assets/", { name: "Asset" }, { asset_type: 5 });

      expect(result).toEqual({ id: 1 });
      expect(lastHappyFoxRequest().json()).toEqual({ name: "Asset" });
    });
  });

  describe("makeRequest - path safety", () => {
    it.each([
      "/ticket/../users/",
      "/ticket/123/delete/#/update_tags/",
      "/ticket/1?x=y/",
      "/ticket/%2e%2e/users/",
      "/ticket/%2F/",
      "/ticket\\1/",
      "/ticket/ 1/",
      "ticket/1/"
    ])("refuses %j without sending a request", async (path) => {
      const client = new HappyFoxClient(usAuth);

      await expect(client.post(path, { staff_id: 1 })).rejects.toMatchObject({
        statusCode: 400,
        code: "INVALID_PATH"
      });
      expect(sentHappyFoxRequests()).toHaveLength(0);
    });

    it("accepts a percent-encoded email segment", async () => {
      const client = new HappyFoxClient(usAuth);
      mockHappyFoxGet("/user/a%2Bb@example.com/", { id: 1 });

      await expect(client.get("/user/a%2Bb@example.com/")).resolves.toEqual({ id: 1 });
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
      expect(lastHappyFoxRequest().json()).toEqual({ name: "Updated" });
    });

    it("sends DELETE requests with query parameters", async () => {
      const client = new HappyFoxClient(usAuth);
      mockHappyFoxDelete("/asset/1/", {});

      const result = await client.delete("/asset/1/", { deleted_by: 1 });
      expect(result).toEqual({});
      expect(lastHappyFoxRequest().url.search).toBe("?deleted_by=1");
    });
  });

  describe("makeRequest - documented error bodies", () => {
    it("names the field for an error list (Docs/1039 create ticket 400)", async () => {
      const client = new HappyFoxClient(usAuth);
      mockHappyFoxPost("/tickets/", { error: [{ field: "category", errors: ["This field is required."] }] }, 400);

      await expect(client.post("/tickets/", {})).rejects.toMatchObject({
        message: "category: This field is required.",
        statusCode: 400,
        code: "API_ERROR"
      });
    });

    it("names a mandatory custom field (Docs/1039 and Docs/1092)", async () => {
      const client = new HappyFoxClient(usAuth);
      mockHappyFoxPost("/users/", {
        error: [
          { field: "name", errors: ["This field is required."] },
          { field: "c-cf-13", errors: ["This field is required"] }
        ]
      }, 400);

      await expect(client.post("/users/", {})).rejects.toMatchObject({
        message: "name: This field is required.; c-cf-13: This field is required",
        statusCode: 400
      });
    });

    it("names the field for an error object (Docs/1039 staff_update)", async () => {
      const client = new HappyFoxClient(usAuth);
      mockHappyFoxPost("/ticket/1/staff_update/", {
        error: { "t-cf-2": "This field should be filled before marking this ticket as completed" }
      }, 400);

      await expect(client.post("/ticket/1/staff_update/", {})).rejects.toMatchObject({
        message: "t-cf-2: This field should be filled before marking this ticket as completed",
        statusCode: 400
      });
    });

    it("flattens mixed and nested field errors (Docs/1201 asset 400)", async () => {
      const client = new HappyFoxClient(usAuth);
      mockHappyFoxPost("/assets/", {
        error: {
          display_id: ["This field is required."],
          contact_ids: "Enter a list of values.",
          custom_fields: { "1": "Provide a valid choice. 5 is not one of the available choices." }
        }
      }, 400);

      await expect(client.post("/assets/", {}, { asset_type: 1 })).rejects.toMatchObject({
        message:
          "display_id: This field is required.; contact_ids: Enter a list of values.; " +
          "custom_fields.1: Provide a valid choice. 5 is not one of the available choices.",
        statusCode: 400
      });
    });

    it("numbers failed items of a bulk result (Docs/1039 create multiple tickets)", async () => {
      const client = new HappyFoxClient(usAuth);
      mockHappyFoxPost("/tickets/", [
        { display_id: "#DC00000011", id: 11, success: true },
        { success: false, error: [{ field: "category", errors: ["This field is required."] }] }
      ], 400);

      await expect(client.post("/tickets/", [])).rejects.toMatchObject({
        message: "item 2: category: This field is required.",
        statusCode: 400
      });
    });

    it("keeps a plain string error", async () => {
      const client = new HappyFoxClient(usAuth);
      mockHappyFoxGet("/ticket/999/", { error: "Ticket not found" }, 404);

      await expect(client.get("/ticket/999/")).rejects.toMatchObject({
        message: "Ticket not found",
        statusCode: 404,
        code: "API_ERROR"
      });
    });

    it("uses a 'message' field", async () => {
      const client = new HappyFoxClient(usAuth);
      mockHappyFoxGet("/test/", { message: "Invalid request" }, 400);

      await expect(client.get("/test/")).rejects.toMatchObject({
        message: "Invalid request",
        statusCode: 400
      });
    });

    it("treats a 2xx body holding only 'error' as a failure and keeps the status", async () => {
      const client = new HappyFoxClient(usAuth);
      mockHappyFoxPost("/ticket/1/staff_update/", { error: { "t-cf-2": "This field should be filled" } }, 200);

      await expect(client.post("/ticket/1/staff_update/", {})).rejects.toMatchObject({
        message: "t-cf-2: This field should be filled",
        statusCode: 200,
        code: "API_ERROR"
      });
    });

    it.each([false, 0, "", [], {}, null])("returns a 2xx body of only error: %j, which reports no failure", async (error) => {
      const client = new HappyFoxClient(usAuth);
      mockHappyFoxGet("/test/", { error });

      await expect(client.get("/test/")).resolves.toEqual({ error });
    });

    it("treats a 2xx body of only error: true as a failure", async () => {
      const client = new HappyFoxClient(usAuth);
      mockHappyFoxGet("/test/", { error: true });

      await expect(client.get("/test/")).rejects.toMatchObject({
        message: "HappyFox reported an error without details.",
        statusCode: 200,
        code: "API_ERROR"
      });
    });

    it.each([400, 401, 403, 404, 500])("throws HappyFoxAPIError carrying HTTP %i", async (status) => {
      const client = new HappyFoxClient(usAuth);
      mockHappyFoxGet("/test/", { error: [{ field: "name", errors: ["This field is required."] }] }, status);

      const failure = client.get("/test/");
      await expect(failure).rejects.toBeInstanceOf(HappyFoxAPIError);
      await expect(failure).rejects.toMatchObject({ statusCode: status });
    });
  });

  describe("makeRequest - non-JSON error responses", () => {
    it("uses plain text error body when response is not JSON", async () => {
      const client = new HappyFoxClient(usAuth);
      mockHappyFoxRaw("GET", "/error/", 500, "Plain text server error", { "Content-Type": "text/plain" });

      await expect(client.get("/error/")).rejects.toMatchObject({
        message: "Plain text server error",
        statusCode: 500,
        code: "API_ERROR"
      });
    });

    it("uses default error message when error body is empty", async () => {
      const client = new HappyFoxClient(usAuth);
      mockHappyFoxRaw("GET", "/empty-error/", 500, "", { "Content-Type": "text/plain" });

      await expect(client.get("/empty-error/")).rejects.toMatchObject({
        message: "HappyFox API error: 500 Internal Server Error",
        statusCode: 500,
        code: "API_ERROR"
      });
    });

    it("does not copy an HTML error page into the message", async () => {
      const client = new HappyFoxClient(usAuth);
      mockHappyFoxRaw("GET", "/html-error/", 502, "<!DOCTYPE html><html><body>Bad gateway</body></html>", {
        "Content-Type": "text/html"
      });

      await expect(client.get("/html-error/")).rejects.toMatchObject({
        message: "HappyFox API error: 502 Bad Gateway",
        statusCode: 502
      });
    });

    it("truncates a long plain text error body", async () => {
      const client = new HappyFoxClient(usAuth);
      mockHappyFoxRaw("GET", "/long-error/", 500, "x".repeat(2000), { "Content-Type": "text/plain" });

      const error = await client.get("/long-error/").catch(e => e);
      expect(error.message).toBe(`${"x".repeat(500)}...`);
    });
  });

  describe("makeRequest - redirects", () => {
    it("reports a cross-host redirect on POST without following it", async () => {
      const client = new HappyFoxClient(usAuth);
      mockHappyFoxRaw("POST", "/user/5/", 301, "", { Location: "https://testaccount.happyfox.net/api/1.1/json/user/5/" });

      await expect(client.post("/user/5/", { name: "New" })).rejects.toMatchObject({
        statusCode: 301,
        code: "REDIRECT",
        message: expect.stringContaining("testaccount.happyfox.net")
      });
      expect(sentHappyFoxRequests()).toHaveLength(1);
    });

    it("resolves a relative Location against the request host", async () => {
      const client = new HappyFoxClient(usAuth);
      mockHappyFoxRaw("POST", "/tickets/", 302, "", { Location: "/login/" });

      await expect(client.post("/tickets/", {})).rejects.toMatchObject({
        statusCode: 302,
        code: "REDIRECT",
        message: expect.stringContaining("testaccount.happyfox.com")
      });
    });

    it.each([303, 307, 308])("reports HTTP %i as a redirect", async (status) => {
      const client = new HappyFoxClient(usAuth);
      mockHappyFoxRaw("PUT", "/asset/1/", status, "", { Location: "https://support.example.com/asset/1/" });

      await expect(client.put("/asset/1/", {})).rejects.toMatchObject({
        statusCode: status,
        code: "REDIRECT",
        message: expect.stringContaining("support.example.com")
      });
    });

    it("says so when Location is missing", async () => {
      const client = new HappyFoxClient(usAuth);
      mockHappyFoxRaw("GET", "/test/", 302);

      await expect(client.get("/test/")).rejects.toMatchObject({
        code: "REDIRECT",
        message: expect.stringContaining("an unspecified location")
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

    it("returns a paginated list in the Docs/1039 envelope", async () => {
      const client = new HappyFoxClient(usAuth);
      mockHappyFoxGet("/tickets/", {
        page_info: { count: 2, last_index: 2, page_count: 1, start_index: 1, end_index: 2 },
        data: [{ id: 1 }, { id: 2 }]
      });

      const result = await client.get("/tickets/");
      expect(result.data).toHaveLength(2);
    });

    it("returns an empty object for an empty DELETE response (Docs/1201 delete asset)", async () => {
      const client = new HappyFoxClient(usAuth);
      mockHappyFoxRaw("DELETE", "/asset/1/", 200, "");

      await expect(client.delete("/asset/1/", { deleted_by: 1 })).resolves.toEqual({});
    });

    it.each([
      ["POST", "/ticket/1/subscribe/", 204],
      ["POST", "/ticket/7/staff_update/", 200],
      ["PUT", "/asset/1/", 200]
    ] as const)("rejects an empty %s %s answer (HTTP %i), since its documented success is JSON", async (method, path, status) => {
      const client = new HappyFoxClient(usAuth);
      mockHappyFoxRaw(method, path, status);

      const error = await client.makeRequest({ method, path, body: { staff_id: 1 } }).catch(e => e);
      expect(error).toMatchObject({ statusCode: status, code: "INVALID_RESPONSE" });
      expect(error.message).toContain("HappyFox may still have applied it");
    });

    it("rejects an empty body on GET, since every documented read returns JSON", async () => {
      const client = new HappyFoxClient(usAuth);
      mockHappyFoxRaw("GET", "/empty/", 200, "", { "Content-Type": "application/json" });

      await expect(client.get("/empty/")).rejects.toMatchObject({
        statusCode: 200,
        code: "INVALID_RESPONSE"
      });
    });

    it("rejects a non-JSON 2xx body without echoing it", async () => {
      const client = new HappyFoxClient(usAuth);
      mockHappyFoxRaw("POST", "/ticket/7/staff_update/", 200, "<!DOCTYPE html><title>HappyFox - Login</title>", {
        "Content-Type": "text/html"
      });

      const error = await client.post("/ticket/7/staff_update/", { html: "Hi" }).catch(e => e);
      expect(error).toBeInstanceOf(HappyFoxAPIError);
      expect(error).toMatchObject({ statusCode: 200, code: "INVALID_RESPONSE" });
      expect(error.message).toContain("text/html");
      expect(error.message).not.toContain("Login");
    });

    it("rejects a plain text 2xx body", async () => {
      const client = new HappyFoxClient(usAuth);
      mockHappyFoxRaw("GET", "/text/", 200, "plain text response", { "Content-Type": "text/plain" });

      await expect(client.get("/text/")).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    });

    it("returns a 2xx bulk result with per-item failures as data", async () => {
      const client = new HappyFoxClient(usAuth);
      const bulk = [
        { display_id: "#DC00000011", id: 11, success: true },
        { success: false, error: [{ field: "category", errors: ["This field is required."] }] }
      ];
      mockHappyFoxPost("/tickets/", bulk);

      await expect(client.post("/tickets/", [{}, {}])).resolves.toEqual(bulk);
    });
  });

  describe("makeRequest - rate limiting (429, Docs/1148)", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("retries once without Retry-After, then succeeds", async () => {
      const client = new HappyFoxClient(usAuth);
      mockRateLimitResponse("/retry-success/", "GET");
      mockHappyFoxGet("/retry-success/", { success: true });

      const requestPromise = client.get("/retry-success/");
      await vi.advanceTimersByTimeAsync(2000);

      await expect(requestPromise).resolves.toEqual({ success: true });
      expect(sentHappyFoxRequests()).toHaveLength(2);
    });

    it("fails fast after one retry and names the 10-minute lockout", async () => {
      const client = new HappyFoxClient(usAuth);
      for (let i = 0; i < 3; i++) mockRateLimitResponse("/test/", "GET");

      // Attach the rejection handler before advancing timers - the promise settles
      // while the timers run, and an unattached rejection is an unhandled rejection.
      const assertion = expect(client.get("/test/")).rejects.toMatchObject({
        code: "RATE_LIMIT_EXCEEDED",
        statusCode: 429,
        message: expect.stringContaining("10 minutes")
      });
      await vi.advanceTimersByTimeAsync(2000);
      await assertion;

      expect(sentHappyFoxRequests()).toHaveLength(2);
    });

    it("waits exactly a short Retry-After before retrying", async () => {
      const client = new HappyFoxClient(usAuth);
      mockRateLimitResponse("/test/", "GET", "us", { "Retry-After": "3" });
      mockHappyFoxGet("/test/", { ok: true });

      const requestPromise = client.get("/test/");
      await vi.advanceTimersByTimeAsync(2999);
      expect(sentHappyFoxRequests()).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(1);
      await expect(requestPromise).resolves.toEqual({ ok: true });
      expect(sentHappyFoxRequests()).toHaveLength(2);
    });

    it("waits until a Retry-After HTTP-date before retrying", async () => {
      // A whole second, so toUTCString loses nothing; 8 s is past the 1-2 s fallback delay.
      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
      const client = new HappyFoxClient(usAuth);
      const retryAt = new Date(Date.now() + 8000).toUTCString();
      mockRateLimitResponse("/test/", "GET", "us", { "Retry-After": retryAt });
      mockHappyFoxGet("/test/", { ok: true });

      const requestPromise = client.get("/test/");
      await vi.advanceTimersByTimeAsync(7999);
      expect(sentHappyFoxRequests()).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(1);
      await expect(requestPromise).resolves.toEqual({ ok: true });
      expect(sentHappyFoxRequests()).toHaveLength(2);
    });

    it("fails at once when Retry-After is longer than the retry budget", async () => {
      const client = new HappyFoxClient(usAuth);
      mockRateLimitResponse("/test/", "POST", "us", { "Retry-After": "600" });

      await expect(client.post("/test/", {})).rejects.toMatchObject({
        code: "RATE_LIMIT_EXCEEDED",
        statusCode: 429,
        message: expect.stringContaining("600 s")
      });
      expect(sentHappyFoxRequests()).toHaveLength(1);
    });
  });

  describe("makeRequest - network error retry", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    /** One failure then one JSON success on the same path. */
    function failThenSucceed(path: string, failure: Error, body: unknown) {
      const pool = fetchMock.get("https://testaccount.happyfox.com");
      const matcher = (actualPath: string) => actualPath.startsWith(`/api/1.1/json${path}`);
      pool.intercept({ path: matcher, method: "GET" }).replyWithError(failure);
      pool.intercept({ path: matcher, method: "GET" }).reply(200, JSON.stringify(body), {
        headers: { "Content-Type": "application/json" }
      });
    }

    function withCode(message: string, code: string): Error {
      return Object.assign(new Error(message), { code });
    }

    it("retries on TypeError with fetch message", async () => {
      const client = new HappyFoxClient(usAuth);
      failThenSucceed("/fetch-error/", new TypeError("Failed to fetch"), { success: true });

      const requestPromise = client.get("/fetch-error/");
      await vi.advanceTimersByTimeAsync(2000);

      await expect(requestPromise).resolves.toEqual({ success: true });
    });

    it.each(["ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "ECONNREFUSED"])("retries on %s", async (code) => {
      const client = new HappyFoxClient(usAuth);
      failThenSucceed("/flaky/", withCode("Transport failure", code), { recovered: true });

      const requestPromise = client.get("/flaky/");
      await vi.advanceTimersByTimeAsync(2000);

      await expect(requestPromise).resolves.toEqual({ recovered: true });
    });

    it("throws NETWORK_ERROR after max retries on network failure", async () => {
      const client = new HappyFoxClient(usAuth);
      const pool = fetchMock.get("https://testaccount.happyfox.com");

      // 6 total: initial + 5 retries
      for (let i = 0; i < 6; i++) {
        pool
          .intercept({
            path: (actualPath: string) => actualPath.startsWith("/api/1.1/json/always-fail/"),
            method: "GET"
          })
          .replyWithError(new TypeError("Failed to fetch"));
      }

      // Attach the rejection handler before advancing timers (see note above)
      const assertion = expect(client.get("/always-fail/")).rejects.toMatchObject({
        code: "NETWORK_ERROR",
        statusCode: 0
      });

      for (let i = 0; i < 6; i++) {
        await vi.advanceTimersByTimeAsync(70000);
      }

      await assertion;
    });

    it("does not retry a POST after a transport failure, and says the write may have happened", async () => {
      const client = new HappyFoxClient(usAuth);
      fetchMock
        .get("https://testaccount.happyfox.com")
        .intercept({ path: "/api/1.1/json/tickets/", method: "POST" })
        .replyWithError(new TypeError("Failed to fetch"));

      await expect(client.post("/tickets/", { subject: "Test" })).rejects.toMatchObject({
        statusCode: 0,
        code: "NETWORK_ERROR",
        message: "Request failed: Failed to fetch. HappyFox may still have applied this write, so check before repeating it."
      });
      expect(sentHappyFoxRequests()).toHaveLength(1);
    });

    it.each(["ENOTFOUND", "ECONNREFUSED"])("retries a POST that never connected (%s)", async (code) => {
      const client = new HappyFoxClient(usAuth);
      const pool = fetchMock.get("https://testaccount.happyfox.com");
      pool.intercept({ path: "/api/1.1/json/tickets/", method: "POST" }).replyWithError(withCode("No connection", code));
      pool.intercept({ path: "/api/1.1/json/tickets/", method: "POST" }).reply(200, JSON.stringify({ id: 1 }), {
        headers: { "Content-Type": "application/json" }
      });

      const requestPromise = client.post("/tickets/", { subject: "Test" });
      await vi.advanceTimersByTimeAsync(2000);

      await expect(requestPromise).resolves.toEqual({ id: 1 });
      expect(sentHappyFoxRequests()).toHaveLength(2);
    });

    it.each([
      ["PUT", "/asset/1/", withCode("Reset", "ECONNRESET")],
      ["PUT", "/ticket_custom_field/61/", withCode("Timed out", "ETIMEDOUT")],
      ["DELETE", "/asset/1/", new TypeError("Failed to fetch")]
    ] as const)("does not retry a %s %s after a failure that may follow an applied write", async (method, path, failure) => {
      const client = new HappyFoxClient(usAuth);
      fetchMock
        .get("https://testaccount.happyfox.com")
        .intercept({ path: (actual: string) => actual.startsWith(`/api/1.1/json${path}`), method })
        .replyWithError(failure);

      const error = await client.makeRequest({ method, path, body: method === "PUT" ? { name: "A" } : undefined })
        .catch(e => e);
      expect(error).toMatchObject({ statusCode: 0, code: "NETWORK_ERROR" });
      expect(error.message).toContain("HappyFox may still have applied this write");
      expect(sentHappyFoxRequests()).toHaveLength(1);
    });

    it.each(["PUT", "DELETE"] as const)("retries a %s that never connected", async (method) => {
      const client = new HappyFoxClient(usAuth);
      const pool = fetchMock.get("https://testaccount.happyfox.com");
      pool.intercept({ path: "/api/1.1/json/asset/1/", method }).replyWithError(withCode("No connection", "ECONNREFUSED"));
      pool.intercept({ path: "/api/1.1/json/asset/1/", method }).reply(200, JSON.stringify({ id: 1 }), {
        headers: { "Content-Type": "application/json" }
      });

      const requestPromise = client.makeRequest({ method, path: "/asset/1/" });
      await vi.advanceTimersByTimeAsync(2000);

      await expect(requestPromise).resolves.toEqual({ id: 1 });
      expect(sentHappyFoxRequests()).toHaveLength(2);
    });

    it("does not retry on non-retryable errors", async () => {
      const client = new HappyFoxClient(usAuth);
      fetchMock
        .get("https://testaccount.happyfox.com")
        .intercept({
          path: (actualPath: string) => actualPath.startsWith("/api/1.1/json/non-retryable/"),
          method: "GET"
        })
        .replyWithError(new Error("Custom error"));

      await expect(client.get("/non-retryable/")).rejects.toMatchObject({
        code: "NETWORK_ERROR",
        message: expect.stringContaining("Custom error")
      });
      expect(sentHappyFoxRequests()).toHaveLength(1);
    });

    it("does not retry on 4xx errors", async () => {
      const client = new HappyFoxClient(usAuth);
      mockHappyFoxGet("/not-found/", { error: "Not found" }, 404);

      await expect(client.get("/not-found/")).rejects.toMatchObject({
        statusCode: 404,
        code: "API_ERROR"
      });
      expect(sentHappyFoxRequests()).toHaveLength(1);
    });

    it("does not retry on 5xx errors", async () => {
      const client = new HappyFoxClient(usAuth);
      mockHappyFoxGet("/server-error/", { error: "Internal error" }, 500);

      await expect(client.get("/server-error/")).rejects.toMatchObject({
        statusCode: 500,
        code: "API_ERROR"
      });
      expect(sentHappyFoxRequests()).toHaveLength(1);
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
