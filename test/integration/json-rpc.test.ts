import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { SELF, fetchMock } from "cloudflare:test";
import { createRequest, createNotification, createBatchRequest, MCP_PROTOCOL_VERSION, createSessionHeaders } from "../helpers/json-rpc";
import { getSessionToken, createAuthHeaders } from "../fixtures/auth";
import { resetFetchMock } from "../helpers/fetch-mock-helpers";

describe("JSON-RPC 2.0 Protocol", () => {
  let sessionId: string;

  beforeAll(async () => {
    resetFetchMock();
    sessionId = await getSessionToken();
  });

  beforeEach(() => {
    resetFetchMock();
  });

  afterEach(() => {
    // Don't assert pending interceptors - some tests may fail before API is called
  });

  describe("Request Validation", () => {
    it("rejects missing jsonrpc field", async () => {
      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: "initialize", id: 1 })
      });

      const body = await response.json() as Record<string, unknown>;
      expect((body.error as Record<string, unknown>).code).toBe(-32600);
      expect((body.error as Record<string, unknown>).message).toContain("Invalid Request");
    });

    it("rejects wrong jsonrpc version", async () => {
      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "1.0", method: "initialize", id: 1 })
      });

      const body = await response.json() as Record<string, unknown>;
      expect((body.error as Record<string, unknown>).code).toBe(-32600);
    });

    it("returns method not found for unknown methods with session", async () => {
      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: {
          ...createAuthHeaders(),
          ...createSessionHeaders(sessionId)
        },
        body: JSON.stringify(createRequest("unknown/method"))
      });

      const body = await response.json() as Record<string, unknown>;
      expect((body.error as Record<string, unknown>).code).toBe(-32601);
      expect((body.error as Record<string, unknown>).message).toBe("Method not found");
    });

    it("accepts requests with valid jsonrpc 2.0", async () => {
      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createRequest("initialize", { protocolVersion: MCP_PROTOCOL_VERSION }))
      });

      const body = await response.json() as Record<string, unknown>;
      expect(body.jsonrpc).toBe("2.0");
      expect(body.result).toBeDefined();
    });
  });

  describe("Notifications", () => {
    it("returns 202 for notification with valid session", async () => {
      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: {
          ...createAuthHeaders(),
          ...createSessionHeaders(sessionId)
        },
        body: JSON.stringify(createNotification("initialized"))
      });

      // MCP 2025-11-25: notifications MUST return 202 Accepted
      expect(response.status).toBe(202);
    });

    it("silently ignores unknown notifications with valid session", async () => {
      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: {
          ...createAuthHeaders(),
          ...createSessionHeaders(sessionId)
        },
        body: JSON.stringify(createNotification("unknown/notification"))
      });

      // MCP 2025-11-25: notifications MUST return 202 Accepted
      expect(response.status).toBe(202);
    });

    it("returns 202 for notifications/initialized with valid session", async () => {
      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: {
          ...createAuthHeaders(),
          ...createSessionHeaders(sessionId)
        },
        body: JSON.stringify(createNotification("notifications/initialized"))
      });

      // MCP 2025-11-25: notifications MUST return 202 Accepted
      expect(response.status).toBe(202);
    });

    it("rejects notifications without session", async () => {
      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createNotification("initialized"))
      });

      // Non-initialize requests without session get 400
      expect(response.status).toBe(400);
    });
  });

  describe("Batch Requests (MCP 2025-11-25)", () => {
    // MCP 2025-11-25 does NOT support batch requests - they should be rejected

    it("rejects batch requests with 400", async () => {
      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: {
          ...createAuthHeaders(),
          ...createSessionHeaders(sessionId)
        },
        body: JSON.stringify(createBatchRequest([
          createRequest("initialize", { protocolVersion: MCP_PROTOCOL_VERSION }, 1),
          createRequest("tools/list", {}, 2)
        ]))
      });

      expect(response.status).toBe(400);
      const body = await response.json() as Record<string, unknown>;
      expect((body.error as Record<string, unknown>).code).toBe(-32600);
      expect((body.error as Record<string, unknown>).message).toContain("Batch requests not supported");
    });

    it("rejects single-item array (still a batch)", async () => {
      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: {
          ...createAuthHeaders(),
          ...createSessionHeaders(sessionId)
        },
        body: JSON.stringify([createRequest("initialize", { protocolVersion: MCP_PROTOCOL_VERSION }, 1)])
      });

      expect(response.status).toBe(400);
      const body = await response.json() as Record<string, unknown>;
      expect((body.error as Record<string, unknown>).code).toBe(-32600);
    });
  });

  describe("ID Handling", () => {
    it("preserves string id", async () => {
      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createRequest("initialize", { protocolVersion: MCP_PROTOCOL_VERSION }, "my-string-id"))
      });

      const body = await response.json() as Record<string, unknown>;
      expect(body.id).toBe("my-string-id");
    });

    it("preserves null id", async () => {
      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createRequest("initialize", { protocolVersion: MCP_PROTOCOL_VERSION }, null))
      });

      const body = await response.json() as Record<string, unknown>;
      expect(body.id).toBeNull();
    });

    it("preserves numeric id", async () => {
      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createRequest("initialize", { protocolVersion: MCP_PROTOCOL_VERSION }, 42))
      });

      const body = await response.json() as Record<string, unknown>;
      expect(body.id).toBe(42);
    });

    it("preserves zero id", async () => {
      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createRequest("initialize", { protocolVersion: MCP_PROTOCOL_VERSION }, 0))
      });

      const body = await response.json() as Record<string, unknown>;
      expect(body.id).toBe(0);
    });

    it("preserves negative id", async () => {
      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createRequest("initialize", { protocolVersion: MCP_PROTOCOL_VERSION }, -1))
      });

      const body = await response.json() as Record<string, unknown>;
      expect(body.id).toBe(-1);
    });

    it("preserves UUID string id", async () => {
      const uuid = "550e8400-e29b-41d4-a716-446655440000";
      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createRequest("initialize", { protocolVersion: MCP_PROTOCOL_VERSION }, uuid))
      });

      const body = await response.json() as Record<string, unknown>;
      expect(body.id).toBe(uuid);
    });
  });

  describe("Error Response Format", () => {
    it("returns proper JSON-RPC error structure", async () => {
      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: {
          ...createAuthHeaders(),
          ...createSessionHeaders(sessionId)
        },
        body: JSON.stringify(createRequest("unknown/method", {}, 123))
      });

      const body = await response.json() as Record<string, unknown>;
      expect(body.jsonrpc).toBe("2.0");
      expect(body.error).toBeDefined();
      expect(body.result).toBeUndefined();
      expect(body.id).toBe(123);

      const error = body.error as Record<string, unknown>;
      expect(typeof error.code).toBe("number");
      expect(typeof error.message).toBe("string");
    });
  });
});
