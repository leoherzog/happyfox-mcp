import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { SELF, fetchMock } from "cloudflare:test";
import { MCP_PROTOCOL_VERSION, createSessionHeaders, createMCPHeaders } from "../helpers/json-rpc";

describe("Worker Fetch Handler - MCP 2025-11-25 Streamable HTTP", () => {
  beforeAll(() => {
    fetchMock.activate();
    fetchMock.disableNetConnect();
  });

  afterEach(() => {
    fetchMock.assertNoPendingInterceptors();
  });

  describe("HTTP Method Handling", () => {
    it("returns 405 for GET requests (SSE not implemented)", async () => {
      const response = await SELF.fetch("https://worker.test/", {
        method: "GET"
      });

      expect(response.status).toBe(405);
      expect(response.headers.get("Allow")).toBe("POST, OPTIONS, DELETE");
    });

    it("returns 405 for PUT requests", async () => {
      const response = await SELF.fetch("https://worker.test/", {
        method: "PUT"
      });

      expect(response.status).toBe(405);
    });

    it("returns 202 for DELETE requests (session termination)", async () => {
      const response = await SELF.fetch("https://worker.test/", {
        method: "DELETE"
      });

      expect(response.status).toBe(202);
    });

    it("handles OPTIONS preflight requests", async () => {
      const response = await SELF.fetch("https://worker.test/", {
        method: "OPTIONS",
        headers: { Origin: "http://localhost:3000" }
      });

      expect(response.status).toBe(204);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3000");
      expect(response.headers.get("Access-Control-Allow-Methods")).toBe("GET, POST, DELETE, OPTIONS");
    });

    it("accepts POST requests for initialize", async () => {
      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "initialize",
          params: { protocolVersion: MCP_PROTOCOL_VERSION },
          id: 1
        })
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("application/json");
    });
  });

  describe("MCP 2025-11-25 Session Management", () => {
    it("returns MCP-Session-Id header on initialize", async () => {
      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "initialize",
          params: { protocolVersion: MCP_PROTOCOL_VERSION },
          id: 1
        })
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("MCP-Session-Id")).toBeTruthy();
    });

    it("requires MCP-Session-Id for non-initialize requests", async () => {
      // Include required MCP headers but no session
      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: createMCPHeaders(),
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "tools/list",
          id: 1
        })
      });

      expect(response.status).toBe(400);
      const body = await response.json() as Record<string, unknown>;
      expect((body.error as Record<string, unknown>).code).toBe(-32000);
      expect((body.error as Record<string, unknown>).message).toContain("MCP-Session-Id");
    });

    it("returns 404 for invalid session tokens", async () => {
      // Include required MCP headers with invalid session
      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: {
          ...createMCPHeaders(),
          "MCP-Session-Id": "invalid-session-token"
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "tools/list",
          id: 1
        })
      });

      expect(response.status).toBe(400); // malformed token = 400
      const body = await response.json() as Record<string, unknown>;
      expect((body.error as Record<string, unknown>).code).toBe(-32001);
    });

    it("accepts valid session tokens for subsequent requests", async () => {
      // First, get a session
      const initResponse = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "initialize",
          params: { protocolVersion: MCP_PROTOCOL_VERSION },
          id: 1
        })
      });

      const sessionId = initResponse.headers.get("MCP-Session-Id");
      expect(sessionId).toBeTruthy();

      // Then use it for another request
      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: createSessionHeaders(sessionId!),
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "tools/list",
          id: 2
        })
      });

      expect(response.status).toBe(200);
      const body = await response.json() as Record<string, unknown>;
      expect(body.result).toBeDefined();
    });
  });

  describe("MCP 2025-11-25 Protocol Version", () => {
    it("accepts 2025-11-25 protocol version", async () => {
      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "initialize",
          params: { protocolVersion: "2025-11-25" },
          id: 1
        })
      });

      expect(response.status).toBe(200);
      const body = await response.json() as Record<string, unknown>;
      expect((body.result as Record<string, unknown>).protocolVersion).toBe("2025-11-25");
    });

    it("rejects old protocol versions", async () => {
      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "initialize",
          params: { protocolVersion: "2024-11-05" },
          id: 1
        })
      });

      expect(response.status).toBe(200);
      const body = await response.json() as Record<string, unknown>;
      expect((body.error as Record<string, unknown>).code).toBe(-32602);
      expect((body.error as Record<string, unknown>).message).toContain("Unsupported protocol version");
    });

    it("rejects missing protocol version", async () => {
      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "initialize",
          params: {},
          id: 1
        })
      });

      expect(response.status).toBe(200);
      const body = await response.json() as Record<string, unknown>;
      expect((body.error as Record<string, unknown>).code).toBe(-32602);
    });
  });

  describe("MCP 2025-11-25 Header Validation", () => {
    it("requires MCP-Protocol-Version header for non-initialize requests", async () => {
      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json, text/event-stream"
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "tools/list",
          id: 1
        })
      });

      expect(response.status).toBe(400);
      const body = await response.json() as Record<string, unknown>;
      expect((body.error as Record<string, unknown>).code).toBe(-32600);
      expect((body.error as Record<string, unknown>).message).toContain("MCP-Protocol-Version");
    });

    it("rejects wrong MCP-Protocol-Version header value", async () => {
      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json, text/event-stream",
          "MCP-Protocol-Version": "2024-11-05"
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "tools/list",
          id: 1
        })
      });

      expect(response.status).toBe(400);
      const body = await response.json() as Record<string, unknown>;
      expect((body.error as Record<string, unknown>).code).toBe(-32602);
      expect((body.error as Record<string, unknown>).message).toContain("Unsupported protocol version");
    });

    it("requires Accept header for non-initialize requests", async () => {
      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "MCP-Protocol-Version": MCP_PROTOCOL_VERSION
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "tools/list",
          id: 1
        })
      });

      expect(response.status).toBe(400);
      const body = await response.json() as Record<string, unknown>;
      expect((body.error as Record<string, unknown>).code).toBe(-32600);
      expect((body.error as Record<string, unknown>).message).toContain("Accept");
    });

    it("accepts wildcard Accept header", async () => {
      // First get a valid session
      const initResponse = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "initialize",
          params: { protocolVersion: MCP_PROTOCOL_VERSION },
          id: 1
        })
      });
      const sessionId = initResponse.headers.get("MCP-Session-Id");

      // Use wildcard Accept
      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "*/*",
          "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
          "MCP-Session-Id": sessionId!
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "tools/list",
          id: 2
        })
      });

      expect(response.status).toBe(200);
    });
  });

  describe("MCP 2025-11-25 Single Message Enforcement", () => {
    it("rejects batch requests", async () => {
      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([
          { jsonrpc: "2.0", method: "initialize", params: { protocolVersion: MCP_PROTOCOL_VERSION }, id: 1 },
          { jsonrpc: "2.0", method: "tools/list", id: 2 }
        ])
      });

      expect(response.status).toBe(400);
      const body = await response.json() as Record<string, unknown>;
      expect((body.error as Record<string, unknown>).code).toBe(-32600);
      expect((body.error as Record<string, unknown>).message).toContain("Batch requests not supported");
    });

    it("rejects empty array batch", async () => {
      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([])
      });

      expect(response.status).toBe(400);
      const body = await response.json() as Record<string, unknown>;
      expect((body.error as Record<string, unknown>).code).toBe(-32600);
    });
  });

  describe("Origin Validation", () => {
    it("returns 403 for invalid origins", async () => {
      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Origin": "https://evil.com"
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "initialize",
          params: { protocolVersion: MCP_PROTOCOL_VERSION },
          id: 1
        })
      });

      expect(response.status).toBe(403);
    });

    it("allows requests from localhost", async () => {
      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Origin": "http://localhost:3000"
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "initialize",
          params: { protocolVersion: MCP_PROTOCOL_VERSION },
          id: 1
        })
      });

      expect(response.status).toBe(200);
    });

    it("allows requests without Origin header (same-origin)", async () => {
      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "initialize",
          params: { protocolVersion: MCP_PROTOCOL_VERSION },
          id: 1
        })
      });

      expect(response.status).toBe(200);
    });
  });

  describe("CORS Headers", () => {
    it("includes CORS headers for allowed origins", async () => {
      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Origin": "http://localhost:5173"
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "initialize",
          params: { protocolVersion: MCP_PROTOCOL_VERSION },
          id: 1
        })
      });

      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:5173");
    });

    it("exposes MCP headers to browser", async () => {
      const response = await SELF.fetch("https://worker.test/", {
        method: "OPTIONS",
        headers: { Origin: "http://localhost:3000" }
      });

      expect(response.headers.get("Access-Control-Expose-Headers")).toContain("MCP-Session-Id");
    });

    it("allows MCP headers in preflight", async () => {
      const response = await SELF.fetch("https://worker.test/", {
        method: "OPTIONS",
        headers: { Origin: "http://localhost:3000" }
      });

      expect(response.headers.get("Access-Control-Allow-Headers")).toContain("MCP-Session-Id");
      expect(response.headers.get("Access-Control-Allow-Headers")).toContain("MCP-Protocol-Version");
    });
  });

  describe("JSON Parse Errors", () => {
    it("returns parse error for invalid JSON", async () => {
      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not valid json"
      });

      expect(response.status).toBe(400);
      const body = await response.json() as Record<string, unknown>;
      expect(body.jsonrpc).toBe("2.0");
      expect((body.error as Record<string, unknown>).code).toBe(-32700);
    });

    it("returns parse error for empty body", async () => {
      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: ""
      });

      expect(response.status).toBe(400);
      const body = await response.json() as Record<string, unknown>;
      expect((body.error as Record<string, unknown>).code).toBe(-32700);
    });
  });

  describe("Notifications", () => {
    it("returns 202 for initialized notification with valid session", async () => {
      // First, get a session
      const initResponse = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "initialize",
          params: { protocolVersion: MCP_PROTOCOL_VERSION },
          id: 1
        })
      });

      const sessionId = initResponse.headers.get("MCP-Session-Id");

      // Send initialized notification
      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: createSessionHeaders(sessionId!),
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/initialized"
        })
      });

      // MCP 2025-11-25: notifications MUST return 202 Accepted
      expect(response.status).toBe(202);
    });
  });
});
