import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { SELF } from "cloudflare:test";
import { createRequest, initializeRequest, toolsListRequest, resourcesListRequest, resourceReadRequest, toolCallRequest, MCP_PROTOCOL_VERSION, createSessionHeaders, createMCPHeaders } from "../helpers/json-rpc";
import { getSessionToken, createAuthHeaders, createSessionAuthHeaders } from "../fixtures/auth";
import { resetFetchMock } from "../helpers/fetch-mock-helpers";

describe("MCP Protocol Compliance", () => {
  let sessionId: string;

  beforeAll(async () => {
    resetFetchMock();
    sessionId = await getSessionToken();
  });

  beforeEach(() => {
    resetFetchMock();
  });

  describe("initialize", () => {
    it("returns server capabilities", async () => {
      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(initializeRequest(MCP_PROTOCOL_VERSION))
      });

      const body = await response.json() as Record<string, unknown>;
      const result = body.result as Record<string, unknown>;

      expect(result.protocolVersion).toBe(MCP_PROTOCOL_VERSION);
      expect(result.capabilities).toBeDefined();
      expect((result.capabilities as Record<string, unknown>).tools).toBeDefined();
      expect((result.capabilities as Record<string, unknown>).resources).toBeDefined();
    });

    it("returns server info", async () => {
      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(initializeRequest())
      });

      const body = await response.json() as Record<string, unknown>;
      const result = body.result as Record<string, unknown>;
      const serverInfo = result.serverInfo as Record<string, unknown>;

      expect(serverInfo.name).toBe("happyfox-mcp");
      expect(serverInfo.version).toBeDefined();
    });

    it("rejects unsupported protocol version", async () => {
      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(initializeRequest("2024-11-05"))
      });

      const body = await response.json() as Record<string, unknown>;
      const error = body.error as Record<string, unknown>;

      // Should reject old protocol version
      expect(error.code).toBe(-32602);
      expect(error.message).toContain("Unsupported protocol version");
    });

    it("returns session ID in response header", async () => {
      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: createAuthHeaders(),
        body: JSON.stringify(initializeRequest())
      });

      expect(response.headers.get("MCP-Session-Id")).toBeDefined();
      expect(response.headers.get("MCP-Session-Id")).not.toBeNull();
    });
  });

  describe("tools/list", () => {
    it("returns all registered tools", async () => {
      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: createSessionAuthHeaders(sessionId),
        body: JSON.stringify(toolsListRequest())
      });

      const body = await response.json() as Record<string, unknown>;
      const result = body.result as Record<string, unknown>;
      const tools = result.tools as Array<Record<string, unknown>>;

      expect(tools).toBeInstanceOf(Array);
      expect(tools.length).toBeGreaterThan(0);
    });

    it("returns tools with correct structure", async () => {
      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: createSessionAuthHeaders(sessionId),
        body: JSON.stringify(toolsListRequest())
      });

      const body = await response.json() as Record<string, unknown>;
      const result = body.result as Record<string, unknown>;
      const tools = result.tools as Array<Record<string, unknown>>;

      // Verify tool structure
      const tool = tools[0];
      expect(tool.name).toBeDefined();
      expect(typeof tool.name).toBe("string");
      expect(tool.description).toBeDefined();
      expect(typeof tool.description).toBe("string");
      expect(tool.inputSchema).toBeDefined();
    });

    it("returns tools with inputSchema", async () => {
      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: createSessionAuthHeaders(sessionId),
        body: JSON.stringify(toolsListRequest())
      });

      const body = await response.json() as Record<string, unknown>;
      const result = body.result as Record<string, unknown>;
      const tools = result.tools as Array<Record<string, unknown>>;

      const tool = tools[0];
      const schema = tool.inputSchema as Record<string, unknown>;
      expect(schema.type).toBe("object");
      expect(schema.properties).toBeDefined();
    });

    it("supports pagination with cursor", async () => {
      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: createSessionAuthHeaders(sessionId),
        body: JSON.stringify(toolsListRequest("0"))
      });

      const body = await response.json() as Record<string, unknown>;
      const result = body.result as Record<string, unknown>;
      const tools = result.tools as Array<Record<string, unknown>>;

      expect(tools).toBeInstanceOf(Array);
    });

    it("includes all HappyFox tools", async () => {
      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: createSessionAuthHeaders(sessionId),
        body: JSON.stringify(toolsListRequest())
      });

      const body = await response.json() as Record<string, unknown>;
      const result = body.result as Record<string, unknown>;
      const tools = result.tools as Array<Record<string, unknown>>;
      const toolNames = tools.map(t => t.name);

      // Check for key tools
      expect(toolNames).toContain("happyfox_list_tickets");
      expect(toolNames).toContain("happyfox_create_ticket");
      expect(toolNames).toContain("happyfox_list_contacts");
      expect(toolNames).toContain("happyfox_list_assets");
    });
  });

  describe("tools/call - Authentication", () => {
    it("requires session for tool calls", async () => {
      // Include required MCP headers but no session
      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: createMCPHeaders(),
        body: JSON.stringify(toolCallRequest("happyfox_list_tickets", {}))
      });

      const body = await response.json() as Record<string, unknown>;
      const error = body.error as Record<string, unknown>;

      // Without session, should get session missing error
      expect(error.code).toBe(-32000);
      expect(error.message).toContain("Session");
    });

    it("returns error for unknown tool", async () => {
      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: createSessionAuthHeaders(sessionId),
        body: JSON.stringify(toolCallRequest("unknown_tool", {}))
      });

      const body = await response.json() as Record<string, unknown>;
      const error = body.error as Record<string, unknown>;

      expect(error.code).toBe(-32602);
      expect(error.message).toContain("Tool not found");
    });

    it("returns error when tool name is missing", async () => {
      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: createSessionAuthHeaders(sessionId),
        body: JSON.stringify(createRequest("tools/call", { arguments: {} }))
      });

      const body = await response.json() as Record<string, unknown>;
      const error = body.error as Record<string, unknown>;

      expect(error.code).toBe(-32602);
      expect(error.message).toContain("Missing required parameter: name");
    });
  });

  describe("resources/list", () => {
    it("returns available resources", async () => {
      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: createSessionAuthHeaders(sessionId),
        body: JSON.stringify(resourcesListRequest())
      });

      const body = await response.json() as Record<string, unknown>;
      const result = body.result as Record<string, unknown>;
      const resources = result.resources as Array<Record<string, unknown>>;

      expect(resources).toBeInstanceOf(Array);
      expect(resources.length).toBeGreaterThan(0);
    });

    it("returns resources with correct structure", async () => {
      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: createSessionAuthHeaders(sessionId),
        body: JSON.stringify(resourcesListRequest())
      });

      const body = await response.json() as Record<string, unknown>;
      const result = body.result as Record<string, unknown>;
      const resources = result.resources as Array<Record<string, unknown>>;

      const resource = resources[0];
      expect(resource.uri).toBeDefined();
      expect(resource.name).toBeDefined();
      expect(resource.description).toBeDefined();
      expect(resource.mimeType).toBeDefined();
    });

    it("includes expected HappyFox resources", async () => {
      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: createSessionAuthHeaders(sessionId),
        body: JSON.stringify(resourcesListRequest())
      });

      const body = await response.json() as Record<string, unknown>;
      const result = body.result as Record<string, unknown>;
      const resources = result.resources as Array<Record<string, unknown>>;
      const uris = resources.map(r => r.uri);

      expect(uris).toContain("happyfox://categories");
      expect(uris).toContain("happyfox://statuses");
      expect(uris).toContain("happyfox://staff");
    });
  });

  describe("resources/read", () => {
    it("requires session for resource reads", async () => {
      // Include required MCP headers but no session
      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: createMCPHeaders(),
        body: JSON.stringify(resourceReadRequest("happyfox://categories"))
      });

      const body = await response.json() as Record<string, unknown>;
      const error = body.error as Record<string, unknown>;

      expect(error.code).toBe(-32000);
    });

    it("returns error for unknown resource URI", async () => {
      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: createSessionAuthHeaders(sessionId),
        body: JSON.stringify(resourceReadRequest("happyfox://unknown"))
      });

      const body = await response.json() as Record<string, unknown>;
      const error = body.error as Record<string, unknown>;

      expect(error.code).toBe(-32602);
      expect(error.message).toContain("Resource not found");
    });

    it("returns error when URI is missing", async () => {
      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: createSessionAuthHeaders(sessionId),
        body: JSON.stringify(createRequest("resources/read", {}))
      });

      const body = await response.json() as Record<string, unknown>;
      const error = body.error as Record<string, unknown>;

      expect(error.code).toBe(-32602);
    });
  });

  describe("completion/complete", () => {
    it("returns empty completions", async () => {
      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: createSessionAuthHeaders(sessionId),
        body: JSON.stringify(createRequest("completion/complete", {
          ref: { type: "ref/resource", uri: "happyfox://categories" },
          argument: { name: "category", value: "sup" }
        }))
      });

      const body = await response.json() as Record<string, unknown>;
      const result = body.result as Record<string, unknown>;
      const completion = result.completion as Record<string, unknown>;

      expect(completion.values).toBeInstanceOf(Array);
    });
  });
});
