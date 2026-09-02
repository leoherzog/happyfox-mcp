import { describe, it, expect, beforeEach, vi } from "vitest";
import { MCPServer } from "../../../src/mcp/server";
import {
  MCPRequest,
  AuthContext,
  InsufficientScopeError,
  MCP_PROTOCOL_VERSION,
  META_SERVER_INFO,
  CACHE_TTL_MS_DISCOVER,
  CACHE_TTL_MS_STANDARD,
} from "../../../src/types";
import packageJson from "../../../package.json";

/**
 * MCP 2026-07-28 protocol layer.
 *
 * The transport (src/index.ts) has already validated headers, `params`, and
 * `params._meta` by the time a request reaches MCPServer, so every request
 * literal here is a fully-formed modern request built by `req()`.
 */
function req(
  method: string,
  params: Record<string, unknown> = {},
  id: string | number = 1
): MCPRequest {
  return {
    jsonrpc: "2.0",
    method,
    id,
    params: {
      ...params,
      _meta: {
        "io.modelcontextprotocol/protocolVersion": MCP_PROTOCOL_VERSION,
        "io.modelcontextprotocol/clientCapabilities": {},
      },
    },
  };
}

const SERVER_INFO = { name: "happyfox-mcp", version: packageJson.version };

describe("MCPServer", () => {
  // Authentication is handled by the OAuth layer; MCPServer receives a ready AuthContext.
  const testAuthContext: AuthContext = {
    credentials: {
      apiKey: "test-api-key",
      authCode: "test-auth-code",
      accountName: "testaccount",
      region: "us"
    },
    staffId: 1,
    staffEmail: "test@example.com",
    scopes: ["happyfox:read", "happyfox:write"],
    tokenId: "test-token-id"
  };

  let server: MCPServer;

  beforeEach(() => {
    server = new MCPServer(testAuthContext);
  });

  describe("unknown methods", () => {
    it("returns Method not found (defense in depth - the transport 404s first)", async () => {
      const result = await server.handleRequest(req("unknown/method"));

      expect(result.error?.code).toBe(-32601);
      expect(result.error?.message).toContain("Method not found");
    });

    it("has no handler left for the deleted legacy methods", async () => {
      for (const method of [
        "initialize",
        "notifications/initialized",
        "completion/complete",
        "prompts/list",
        "subscriptions/listen"
      ]) {
        const result = await server.handleRequest(req(method));
        expect(result.error?.code).toBe(-32601);
        expect(result.result).toBeUndefined();
      }
    });
  });

  describe("handleDiscover", () => {
    it("marks the result complete", async () => {
      const result = await server.handleRequest(req("server/discover"));
      expect(result.result?.resultType).toBe("complete");
    });

    it("advertises exactly one supported version", async () => {
      const result = await server.handleRequest(req("server/discover"));
      expect(result.result?.supportedVersions).toEqual(["2026-07-28"]);
    });

    it("declares bare tools and resources capabilities", async () => {
      const result = await server.handleRequest(req("server/discover"));
      expect(result.result?.capabilities).toEqual({ tools: {}, resources: {} });
    });

    it("does not advertise listChanged or subscribe (nothing can deliver them)", async () => {
      const result = await server.handleRequest(req("server/discover"));
      const capabilities = result.result?.capabilities as Record<string, Record<string, unknown>>;

      expect(capabilities.tools).not.toHaveProperty("listChanged");
      expect(capabilities.resources).not.toHaveProperty("listChanged");
      expect(capabilities.resources).not.toHaveProperty("subscribe");
    });

    it("does not declare completions, prompts or logging", async () => {
      const result = await server.handleRequest(req("server/discover"));
      const capabilities = result.result?.capabilities as Record<string, unknown>;

      expect(capabilities).not.toHaveProperty("completions");
      expect(capabilities).not.toHaveProperty("prompts");
      expect(capabilities).not.toHaveProperty("logging");
    });

    it("returns non-empty instructions", async () => {
      const result = await server.handleRequest(req("server/discover"));
      expect(typeof result.result?.instructions).toBe("string");
      expect((result.result?.instructions as string).length).toBeGreaterThan(0);
    });

    it("carries the required caching hints", async () => {
      const result = await server.handleRequest(req("server/discover"));

      expect(result.result?.ttlMs).toBe(CACHE_TTL_MS_DISCOVER);
      expect(result.result?.ttlMs).toBe(3_600_000);
      // Byte-identical for every caller regardless of OAuth scope.
      expect(result.result?.cacheScope).toBe("public");
    });

    it("carries serverInfo in the result _meta", async () => {
      const result = await server.handleRequest(req("server/discover"));
      expect(result.result?._meta?.[META_SERVER_INFO]).toEqual(SERVER_INFO);
    });

    it("does not put serverInfo at the result top level (that was the 2025-11-25 shape)", async () => {
      const result = await server.handleRequest(req("server/discover"));
      expect(result.result).not.toHaveProperty("serverInfo");
      expect(result.result).not.toHaveProperty("protocolVersion");
    });

    it("succeeds with no granted scopes", async () => {
      const unscoped = new MCPServer({ ...testAuthContext, scopes: [] });
      const result = await unscoped.handleRequest(req("server/discover"));

      expect(result.error).toBeUndefined();
      expect(result.result?.supportedVersions).toEqual(["2026-07-28"]);
    });
  });

  describe("handleToolsList", () => {
    it("returns tools array", async () => {
      const result = await server.handleRequest(req("tools/list"));

      expect(result.result?.tools).toBeDefined();
      expect(Array.isArray(result.result?.tools)).toBe(true);
    });

    it("marks the result complete and carries serverInfo", async () => {
      const result = await server.handleRequest(req("tools/list"));

      expect(result.result?.resultType).toBe("complete");
      expect(result.result?._meta?.[META_SERVER_INFO]).toEqual(SERVER_INFO);
    });

    it("carries private caching hints (the list is filtered by the caller's scopes)", async () => {
      const result = await server.handleRequest(req("tools/list"));

      expect(result.result?.ttlMs).toBe(CACHE_TTL_MS_STANDARD);
      expect(result.result?.ttlMs).toBe(900_000);
      expect(result.result?.cacheScope).toBe("private");
    });

    it("handles a cursor for pagination", async () => {
      const result = await server.handleRequest(req("tools/list", { cursor: "50" }));
      expect(result.result?.tools).toBeDefined();
    });

    it("rejects an invalid cursor", async () => {
      const result = await server.handleRequest(req("tools/list", { cursor: "not-a-number" }));

      expect(result.error?.code).toBe(-32602);
      expect(result.error?.message).toContain("Invalid cursor");
    });

    it("includes nextCursor when more items exist", async () => {
      const first = await server.handleRequest(req("tools/list"));
      const allTools = (first.result?.tools as unknown[])?.length ?? 0;

      if (allTools >= 50) {
        expect(first.result?.nextCursor).toBeDefined();
      }
    });

    it("keeps the same cacheScope on a later page", async () => {
      const page = await server.handleRequest(req("tools/list", { cursor: "0" }));
      expect(page.result?.cacheScope).toBe("private");
    });

    it("returns tools in a deterministic order across identical requests", async () => {
      const first = await server.handleRequest(req("tools/list"));
      const second = await server.handleRequest(req("tools/list"));

      expect(JSON.stringify(second.result?.tools)).toBe(JSON.stringify(first.result?.tools));
    });

    it("sorts tools by name", async () => {
      const result = await server.handleRequest(req("tools/list"));
      const names = (result.result?.tools as { name: string }[]).map(t => t.name);

      expect(names).toEqual([...names].sort());
    });

    it("filters by scope without breaking the ordering guarantee", async () => {
      const readOnly = new MCPServer({ ...testAuthContext, scopes: ["happyfox:read"] });
      const first = await readOnly.handleRequest(req("tools/list"));
      const second = await readOnly.handleRequest(req("tools/list"));

      expect(JSON.stringify(second.result?.tools)).toBe(JSON.stringify(first.result?.tools));
      expect(second.result?.cacheScope).toBe("private");
    });
  });

  describe("handleToolCall", () => {
    it("propagates InsufficientScopeError instead of an isError result", async () => {
      const readOnly = new MCPServer({ ...testAuthContext, scopes: ["happyfox:read"] });

      const promise = readOnly.handleRequest(
        req("tools/call", { name: "happyfox_delete_ticket", arguments: { ticket_id: "1" } })
      );
      await expect(promise).rejects.toBeInstanceOf(InsufficientScopeError);
      await expect(promise).rejects.toMatchObject({ requiredScopes: ["happyfox:admin"] });
    });

    it("requires the name parameter", async () => {
      const result = await server.handleRequest(req("tools/call", { arguments: {} }));

      expect(result.error?.code).toBe(-32602);
      expect(result.error?.message).toContain("Missing required parameter: name");
    });

    it("returns a protocol error for an unknown tool", async () => {
      const result = await server.handleRequest(
        req("tools/call", { name: "nonexistent_tool", arguments: {} })
      );

      expect(result.error?.code).toBe(-32602);
      expect(result.error?.message).toContain("Tool not found");
      expect(result.result).toBeUndefined();
    });

    it("returns a complete result carrying serverInfo on success", async () => {
      const okServer = new MCPServer(testAuthContext);
      vi.spyOn((okServer as any).toolRegistry, "callToolWithAuth").mockResolvedValue({ ok: true });

      const result = await okServer.handleRequest(
        req("tools/call", { name: "happyfox_list_tickets", arguments: {} })
      );

      expect(result.result?.resultType).toBe("complete");
      expect(result.result?._meta?.[META_SERVER_INFO]).toEqual(SERVER_INFO);
      expect((result.result?.content as { type: string }[])[0].type).toBe("text");
    });

    it("does not set isError on success", async () => {
      const okServer = new MCPServer(testAuthContext);
      vi.spyOn((okServer as any).toolRegistry, "callToolWithAuth").mockResolvedValue("done");

      const result = await okServer.handleRequest(
        req("tools/call", { name: "happyfox_list_tickets", arguments: {} })
      );

      expect(result.result).not.toHaveProperty("isError");
    });

    it("carries NO caching hints (CallToolResult is not a CacheableResult)", async () => {
      const okServer = new MCPServer(testAuthContext);
      vi.spyOn((okServer as any).toolRegistry, "callToolWithAuth").mockResolvedValue("done");

      const result = await okServer.handleRequest(
        req("tools/call", { name: "happyfox_list_tickets", arguments: {} })
      );

      expect(result.result).not.toHaveProperty("ttlMs");
      expect(result.result).not.toHaveProperty("cacheScope");
    });

    it("reports a ToolExecutionError as a successful result with isError", async () => {
      const { ToolExecutionError } = await import("../../../src/types");
      const errorServer = new MCPServer(testAuthContext);
      vi.spyOn((errorServer as any).toolRegistry, "callToolWithAuth").mockRejectedValue(
        new ToolExecutionError("Ticket not found", 404, "not_found")
      );

      const result = await errorServer.handleRequest(
        req("tools/call", { name: "happyfox_get_ticket", arguments: { id: 1 } })
      );

      // A tool execution error is a successful JSON-RPC result: it still has a resultType.
      expect(result.error).toBeUndefined();
      expect(result.result?.resultType).toBe("complete");
      expect(result.result?.isError).toBe(true);
    });

    it("merges statusCode/errorCode with serverInfo in _meta rather than clobbering", async () => {
      const { ToolExecutionError } = await import("../../../src/types");
      const errorServer = new MCPServer(testAuthContext);
      vi.spyOn((errorServer as any).toolRegistry, "callToolWithAuth").mockRejectedValue(
        new ToolExecutionError("Ticket not found", 404, "not_found")
      );

      const result = await errorServer.handleRequest(
        req("tools/call", { name: "happyfox_get_ticket", arguments: { id: 1 } })
      );

      expect(result.result?._meta).toEqual({
        statusCode: 404,
        errorCode: "not_found",
        [META_SERVER_INFO]: SERVER_INFO
      });
    });

    it("handles unknown errors during tool execution", async () => {
      const errorServer = new MCPServer(testAuthContext);
      vi.spyOn((errorServer as any).toolRegistry, "callToolWithAuth").mockRejectedValue(
        new Error("Unexpected error")
      );

      const result = await errorServer.handleRequest(
        req("tools/call", { name: "happyfox_list_tickets", arguments: {} })
      );

      expect(result.result?.isError).toBe(true);
      expect(result.result?.resultType).toBe("complete");
      expect((result.result?.content as { text: string }[])[0].text).toContain("Unexpected error");
    });

    it("handles non-Error objects thrown during tool execution", async () => {
      const errorServer = new MCPServer(testAuthContext);
      vi.spyOn((errorServer as any).toolRegistry, "callToolWithAuth").mockRejectedValue(
        "string error from tool"
      );

      const result = await errorServer.handleRequest(
        req("tools/call", { name: "happyfox_list_tickets", arguments: {} })
      );

      expect(result.result?.isError).toBe(true);
      expect((result.result?.content as { text: string }[])[0].text).toContain(
        "string error from tool"
      );
    });
  });

  describe("handleResourcesList", () => {
    it("returns resources array", async () => {
      const result = await server.handleRequest(req("resources/list"));

      expect(result.result?.resources).toBeDefined();
      expect(Array.isArray(result.result?.resources)).toBe(true);
    });

    it("marks the result complete and carries serverInfo", async () => {
      const result = await server.handleRequest(req("resources/list"));

      expect(result.result?.resultType).toBe("complete");
      expect(result.result?._meta?.[META_SERVER_INFO]).toEqual(SERVER_INFO);
    });

    it("carries private caching hints (resources are per-HappyFox-account)", async () => {
      const result = await server.handleRequest(req("resources/list"));

      expect(result.result?.ttlMs).toBe(CACHE_TTL_MS_STANDARD);
      expect(result.result?.cacheScope).toBe("private");
    });

    it("handles a cursor for pagination", async () => {
      const result = await server.handleRequest(req("resources/list", { cursor: "0" }));
      expect(result.result?.resources).toBeDefined();
    });

    it("returns an empty list - never an error - for a caller without happyfox:read", async () => {
      const unscoped = new MCPServer({ ...testAuthContext, scopes: [] });
      const result = await unscoped.handleRequest(req("resources/list"));

      expect(result.error).toBeUndefined();
      expect(result.result?.resources).toEqual([]);
      expect(result.result?.resultType).toBe("complete");
      expect(result.result?.ttlMs).toBe(CACHE_TTL_MS_STANDARD);
      expect(result.result?.cacheScope).toBe("private");
    });
  });

  describe("handleResourceRead", () => {
    it("requires the uri parameter", async () => {
      const result = await server.handleRequest(req("resources/read"));

      expect(result.error?.code).toBe(-32602);
      expect(result.error?.message).toContain("Missing required parameter: uri");
    });

    it("returns -32602 with data.uri for an unknown resource", async () => {
      const result = await server.handleRequest(
        req("resources/read", { uri: "happyfox://unknown-resource" })
      );

      expect(result.error?.code).toBe(-32602);
      expect(result.error?.message).toContain("Resource not found");
      expect(result.error?.data).toEqual({ uri: "happyfox://unknown-resource" });
    });

    it("never emits the retired -32002 resource-not-found code", async () => {
      const result = await server.handleRequest(
        req("resources/read", { uri: "happyfox://unknown-resource" })
      );

      expect(result.error?.code).not.toBe(-32002);
    });

    it("propagates InsufficientScopeError for a caller without happyfox:read", async () => {
      const unscoped = new MCPServer({ ...testAuthContext, scopes: [] });

      // Not a JSON-RPC outcome: -32602 is for a resource that does not exist.
      // The transport turns this into HTTP 403 + WWW-Authenticate insufficient_scope.
      const promise = unscoped.handleRequest(req("resources/read", { uri: "happyfox://categories" }));
      await expect(promise).rejects.toBeInstanceOf(InsufficientScopeError);
      await expect(promise).rejects.toMatchObject({ requiredScopes: ["happyfox:read"] });
    });

    it("returns a complete, privately-cacheable result on success", async () => {
      const okServer = new MCPServer(testAuthContext);
      vi.spyOn((okServer as any).resourceRegistry, "readResource").mockResolvedValue({
        uri: "happyfox://categories",
        mimeType: "application/json",
        text: "[]"
      });

      const result = await okServer.handleRequest(
        req("resources/read", { uri: "happyfox://categories" })
      );

      expect(result.result?.resultType).toBe("complete");
      expect(result.result?.contents).toEqual([
        { uri: "happyfox://categories", mimeType: "application/json", text: "[]" }
      ]);
      expect(result.result?.ttlMs).toBe(CACHE_TTL_MS_STANDARD);
      expect(result.result?.cacheScope).toBe("private");
      expect(result.result?._meta?.[META_SERVER_INFO]).toEqual(SERVER_INFO);
    });

    it("does not paginate (ReadResourceResult has no nextCursor)", async () => {
      const okServer = new MCPServer(testAuthContext);
      vi.spyOn((okServer as any).resourceRegistry, "readResource").mockResolvedValue({
        uri: "happyfox://categories",
        mimeType: "application/json",
        text: "[]"
      });

      const result = await okServer.handleRequest(
        req("resources/read", { uri: "happyfox://categories" })
      );

      expect(result.result).not.toHaveProperty("nextCursor");
    });

    it("propagates non-ResourceNotFoundError failures as internal errors", async () => {
      const errorServer = new MCPServer(testAuthContext);
      vi.spyOn((errorServer as any).resourceRegistry, "readResource").mockRejectedValue(
        new Error("upstream exploded")
      );

      const result = await errorServer.handleRequest(
        req("resources/read", { uri: "happyfox://categories" })
      );

      expect(result.error?.code).toBe(-32603);
      expect(result.error?.data).toBe("upstream exploded");
    });
  });

  describe("error handling", () => {
    it("echoes a string id in error responses", async () => {
      const result = await server.handleRequest(req("unknown/method", {}, "test-id-123"));
      expect(result.id).toBe("test-id-123");
    });

    it("echoes a numeric id in error responses", async () => {
      const result = await server.handleRequest(req("unknown/method", {}, 42));
      expect(result.id).toBe(42);
    });

    it("never emits id: null", async () => {
      const result = await server.handleRequest(req("unknown/method", {}, 7));
      expect(result.id).not.toBeNull();
    });

    it("carries no resultType or _meta on error responses", async () => {
      const result = await server.handleRequest(req("unknown/method"));

      expect(result.result).toBeUndefined();
      expect(result).not.toHaveProperty("resultType");
    });

    it("handles internal errors (non-MCPError)", async () => {
      const errorServer = new MCPServer(testAuthContext);
      vi.spyOn(errorServer as any, "handleDiscover").mockImplementation(() => {
        throw new Error("Internal server error");
      });

      const result = await errorServer.handleRequest(req("server/discover"));

      expect(result.error?.code).toBe(-32603);
      expect(result.error?.message).toBe("Internal error");
      expect(result.error?.data).toBe("Internal server error");
    });

    it("handles non-Error objects thrown as internal errors", async () => {
      const errorServer = new MCPServer(testAuthContext);
      vi.spyOn(errorServer as any, "handleDiscover").mockImplementation(() => {
        throw "string error";
      });

      const result = await errorServer.handleRequest(req("server/discover"));

      expect(result.error?.code).toBe(-32603);
      expect(result.error?.data).toBe("string error");
    });

    it("never emits a code from the reserved -32020..-32099 band at this layer", async () => {
      const results = await Promise.all([
        server.handleRequest(req("unknown/method")),
        server.handleRequest(req("tools/call", { arguments: {} })),
        server.handleRequest(req("resources/read", { uri: "happyfox://nope" })),
        server.handleRequest(req("tools/list", { cursor: "bad" }))
      ]);

      for (const result of results) {
        const code = result.error?.code as number;
        expect(code <= -32020 && code >= -32099).toBe(false);
      }
    });
  });

  describe("response format", () => {
    it("includes the jsonrpc version in success responses", async () => {
      const result = await server.handleRequest(req("server/discover"));
      expect(result.jsonrpc).toBe("2.0");
    });

    it("includes the jsonrpc version in error responses", async () => {
      const result = await server.handleRequest(req("unknown"));
      expect(result.jsonrpc).toBe("2.0");
    });

    it("stamps resultType and serverInfo on every supported method's result", async () => {
      const okServer = new MCPServer(testAuthContext);
      vi.spyOn((okServer as any).toolRegistry, "callToolWithAuth").mockResolvedValue("ok");
      vi.spyOn((okServer as any).resourceRegistry, "readResource").mockResolvedValue({
        uri: "happyfox://categories",
        mimeType: "application/json",
        text: "[]"
      });

      const requests = [
        req("server/discover"),
        req("tools/list"),
        req("tools/call", { name: "happyfox_list_tickets", arguments: {} }),
        req("resources/list"),
        req("resources/read", { uri: "happyfox://categories" })
      ];

      for (const request of requests) {
        const result = await okServer.handleRequest(request);
        expect(result.error).toBeUndefined();
        expect(result.result?.resultType).toBe("complete");
        expect(result.result?._meta?.[META_SERVER_INFO]).toEqual(SERVER_INFO);
      }
    });
  });
});
