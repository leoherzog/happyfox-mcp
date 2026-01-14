import { describe, it, expect, beforeEach, vi } from "vitest";
import { MCPServer } from "../../../src/mcp/server";
import { MCPRequest, MCPNotification, AuthContext, MCP_PROTOCOL_VERSION } from "../../../src/types";
import { ToolRegistry } from "../../../src/mcp/tools/registry";
import { ResourceRegistry } from "../../../src/mcp/resources/registry";
import packageJson from "../../../package.json";

describe("MCPServer", () => {
  // Create test AuthContext (authentication is now handled by OAuth layer)
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

  describe("handleMessage - notifications", () => {
    it("returns null for 'initialized' notification", async () => {
      const notification: MCPNotification = {
        jsonrpc: "2.0",
        method: "initialized"
      };

      const result = await server.handleMessage(notification);
      expect(result).toBeNull();
    });

    it("returns null for 'notifications/initialized' notification", async () => {
      const notification: MCPNotification = {
        jsonrpc: "2.0",
        method: "notifications/initialized"
      };

      const result = await server.handleMessage(notification);
      expect(result).toBeNull();
    });

    it("silently ignores unknown notifications", async () => {
      const notification: MCPNotification = {
        jsonrpc: "2.0",
        method: "unknown/notification"
      };

      const result = await server.handleMessage(notification);
      expect(result).toBeNull();
    });
  });

  describe("handleMessage - unknown methods", () => {
    it("throws Method not found for unknown requests", async () => {
      const request: MCPRequest = {
        jsonrpc: "2.0",
        method: "unknown/method",
        id: 1
      };

      const result = await server.handleMessage(request);
      expect(result?.error?.code).toBe(-32601);
      expect(result?.error?.message).toBe("Method not found");
    });
  });

  describe("handleInitialize", () => {
    it("accepts matching protocol version", async () => {
      const request: MCPRequest = {
        jsonrpc: "2.0",
        method: "initialize",
        params: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {}
        },
        id: 1
      };

      const result = await server.handleMessage(request);

      expect(result?.error).toBeUndefined();
      expect(result?.result?.protocolVersion).toBe(MCP_PROTOCOL_VERSION);
    });

    it("rejects mismatched protocol version", async () => {
      const request: MCPRequest = {
        jsonrpc: "2.0",
        method: "initialize",
        params: {
          protocolVersion: "2024-01-01",
          capabilities: {}
        },
        id: 1
      };

      const result = await server.handleMessage(request);

      expect(result?.error?.code).toBe(-32602);
      expect(result?.error?.message).toContain("Unsupported protocol version");
      expect(result?.error?.data?.supported).toContain(MCP_PROTOCOL_VERSION);
    });

    it("rejects missing protocol version", async () => {
      const request: MCPRequest = {
        jsonrpc: "2.0",
        method: "initialize",
        params: {
          capabilities: {}
        },
        id: 1
      };

      const result = await server.handleMessage(request);

      expect(result?.error?.code).toBe(-32602);
      expect(result?.error?.message).toContain("Unsupported protocol version");
    });

    it("returns server capabilities", async () => {
      const request: MCPRequest = {
        jsonrpc: "2.0",
        method: "initialize",
        params: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {}
        },
        id: 1
      };

      const result = await server.handleMessage(request);

      expect(result?.result?.capabilities).toEqual({
        tools: {},
        resources: {}
      });
    });

    it("returns correct serverInfo", async () => {
      const request: MCPRequest = {
        jsonrpc: "2.0",
        method: "initialize",
        params: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {}
        },
        id: 1
      };

      const result = await server.handleMessage(request);

      expect(result?.result?.serverInfo).toEqual({
        name: "happyfox-mcp",
        version: packageJson.version
      });
    });
  });

  describe("handleToolsList", () => {
    it("returns tools array", async () => {
      const request: MCPRequest = {
        jsonrpc: "2.0",
        method: "tools/list",
        id: 1
      };

      const result = await server.handleMessage(request);

      expect(result?.result?.tools).toBeDefined();
      expect(Array.isArray(result?.result?.tools)).toBe(true);
    });

    it("handles cursor for pagination", async () => {
      const request: MCPRequest = {
        jsonrpc: "2.0",
        method: "tools/list",
        params: { cursor: "50" },
        id: 1
      };

      const result = await server.handleMessage(request);

      expect(result?.result?.tools).toBeDefined();
      // The result depends on actual number of tools
    });

    it("includes nextCursor when more items exist", async () => {
      // First get without cursor
      const firstRequest: MCPRequest = {
        jsonrpc: "2.0",
        method: "tools/list",
        id: 1
      };

      const firstResult = await server.handleMessage(firstRequest);
      const allTools = firstResult?.result?.tools?.length || 0;

      // If we have more than 50 tools, there should be a nextCursor
      if (allTools >= 50) {
        expect(firstResult?.result?.nextCursor).toBeDefined();
      }
    });
  });

  describe("handleToolCall", () => {
    // Note: Authentication is now handled by OAuth layer in index.ts
    // MCPServer expects an already-authenticated AuthContext

    it("requires tool name parameter", async () => {
      const request: MCPRequest = {
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          arguments: {}
        },
        id: 1
      };

      const result = await server.handleMessage(request);

      expect(result?.error?.code).toBe(-32602);
      expect(result?.error?.message).toContain("Missing required parameter: name");
    });

    it("returns error for unknown tool", async () => {
      const request: MCPRequest = {
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "nonexistent_tool",
          arguments: {}
        },
        id: 1
      };

      const result = await server.handleMessage(request);

      expect(result?.error?.code).toBe(-32602);
      expect(result?.error?.message).toContain("Tool not found");
    });

    it("handles unknown errors during tool execution", async () => {
      const errorServer = new MCPServer(testAuthContext);

      // Mock toolRegistry.callToolWithAuth to throw a plain Error (not ToolExecutionError)
      vi.spyOn((errorServer as any).toolRegistry, 'callToolWithAuth').mockRejectedValue(
        new Error("Unexpected error")
      );

      const request: MCPRequest = {
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "happyfox_list_tickets",
          arguments: {}
        },
        id: 1
      };

      const result = await errorServer.handleMessage(request);

      // Unknown errors are returned as tool results with isError: true
      expect(result?.result?.isError).toBe(true);
      expect(result?.result?.content[0]?.text).toContain("Unexpected error");
    });

    it("handles non-Error objects thrown during tool execution", async () => {
      const errorServer = new MCPServer(testAuthContext);

      // Mock toolRegistry.callToolWithAuth to throw a non-Error value
      vi.spyOn((errorServer as any).toolRegistry, 'callToolWithAuth').mockRejectedValue(
        "string error from tool"
      );

      const request: MCPRequest = {
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "happyfox_list_tickets",
          arguments: {}
        },
        id: 1
      };

      const result = await errorServer.handleMessage(request);

      expect(result?.result?.isError).toBe(true);
      expect(result?.result?.content[0]?.text).toContain("string error from tool");
    });
  });

  describe("handleResourcesList", () => {
    it("returns resources array", async () => {
      const request: MCPRequest = {
        jsonrpc: "2.0",
        method: "resources/list",
        id: 1
      };

      const result = await server.handleMessage(request);

      expect(result?.result?.resources).toBeDefined();
      expect(Array.isArray(result?.result?.resources)).toBe(true);
    });

    it("handles cursor for pagination", async () => {
      const request: MCPRequest = {
        jsonrpc: "2.0",
        method: "resources/list",
        params: { cursor: "0" },
        id: 1
      };

      const result = await server.handleMessage(request);

      expect(result?.result?.resources).toBeDefined();
    });
  });

  describe("handleResourceRead", () => {
    // Note: Authentication is now handled by OAuth layer in index.ts
    // MCPServer expects an already-authenticated AuthContext

    it("requires uri parameter", async () => {
      const request: MCPRequest = {
        jsonrpc: "2.0",
        method: "resources/read",
        params: {},
        id: 1
      };

      const result = await server.handleMessage(request);

      expect(result?.error?.code).toBe(-32602);
      expect(result?.error?.message).toContain("Missing required parameter: uri");
    });

    it("handles unknown resource error", async () => {
      const request: MCPRequest = {
        jsonrpc: "2.0",
        method: "resources/read",
        params: {
          uri: "happyfox://unknown-resource"
        },
        id: 1
      };

      const result = await server.handleMessage(request);

      expect(result?.error?.code).toBe(-32602);
      expect(result?.error?.message).toContain("Resource not found");
    });
  });

  describe("handleCompletion", () => {
    it("returns empty completion result", async () => {
      const request: MCPRequest = {
        jsonrpc: "2.0",
        method: "completion/complete",
        params: {
          ref: { type: "ref/resource", uri: "happyfox://categories" },
          argument: { name: "param", value: "" }
        },
        id: 1
      };

      const result = await server.handleMessage(request);

      expect(result?.result?.completion).toEqual({
        values: [],
        total: 0,
        hasMore: false
      });
    });
  });

  describe("error handling", () => {
    it("includes correct id in error responses", async () => {
      const request: MCPRequest = {
        jsonrpc: "2.0",
        method: "unknown/method",
        id: "test-id-123"
      };

      const result = await server.handleMessage(request);

      expect(result?.id).toBe("test-id-123");
    });

    it("handles numeric ids", async () => {
      const request: MCPRequest = {
        jsonrpc: "2.0",
        method: "unknown/method",
        id: 42
      };

      const result = await server.handleMessage(request);

      expect(result?.id).toBe(42);
    });

    it("handles null ids", async () => {
      const request: MCPRequest = {
        jsonrpc: "2.0",
        method: "unknown/method",
        id: null
      };

      const result = await server.handleMessage(request);

      expect(result?.id).toBeNull();
    });

    it("handles internal errors (non-MCPError)", async () => {
      // Create a server instance and mock handleInitialize to throw a plain Error
      const errorServer = new MCPServer(testAuthContext);
      const originalHandleMessage = errorServer.handleMessage.bind(errorServer);

      // Spy on handleMessage to throw a plain Error for a specific test case
      vi.spyOn(errorServer as any, 'handleInitialize').mockImplementation(() => {
        throw new Error("Internal server error");
      });

      const request: MCPRequest = {
        jsonrpc: "2.0",
        method: "initialize",
        params: { protocolVersion: MCP_PROTOCOL_VERSION },
        id: 1
      };

      const result = await errorServer.handleMessage(request);

      expect(result?.error?.code).toBe(-32603);
      expect(result?.error?.message).toBe("Internal error");
      expect(result?.error?.data).toBe("Internal server error");
    });

    it("handles non-Error objects thrown as internal errors", async () => {
      const errorServer = new MCPServer(testAuthContext);

      // Mock to throw a non-Error value
      vi.spyOn(errorServer as any, 'handleInitialize').mockImplementation(() => {
        throw "string error";
      });

      const request: MCPRequest = {
        jsonrpc: "2.0",
        method: "initialize",
        params: { protocolVersion: MCP_PROTOCOL_VERSION },
        id: 1
      };

      const result = await errorServer.handleMessage(request);

      expect(result?.error?.code).toBe(-32603);
      expect(result?.error?.message).toBe("Internal error");
      expect(result?.error?.data).toBe("string error");
    });
  });

  describe("isRequest type guard", () => {
    it("identifies requests (with id)", async () => {
      const request: MCPRequest = {
        jsonrpc: "2.0",
        method: "initialize",
        params: { protocolVersion: MCP_PROTOCOL_VERSION },
        id: 1
      };

      // If it's a request, we should get a response
      const result = await server.handleMessage(request);
      expect(result).not.toBeNull();
    });

    it("identifies notifications (without id)", async () => {
      const notification: MCPNotification = {
        jsonrpc: "2.0",
        method: "initialized"
      };

      // If it's a notification, we should get null
      const result = await server.handleMessage(notification);
      expect(result).toBeNull();
    });

    it("treats message with id: null as request", async () => {
      const request: MCPRequest = {
        jsonrpc: "2.0",
        method: "initialize",
        params: { protocolVersion: MCP_PROTOCOL_VERSION },
        id: null
      };

      // Per JSON-RPC 2.0, null is valid id, so this is a request
      const result = await server.handleMessage(request);
      expect(result).not.toBeNull();
    });
  });

  describe("response format", () => {
    it("includes jsonrpc version in all responses", async () => {
      const request: MCPRequest = {
        jsonrpc: "2.0",
        method: "initialize",
        params: { protocolVersion: MCP_PROTOCOL_VERSION },
        id: 1
      };

      const result = await server.handleMessage(request);
      expect(result?.jsonrpc).toBe("2.0");
    });

    it("includes jsonrpc version in error responses", async () => {
      const request: MCPRequest = {
        jsonrpc: "2.0",
        method: "unknown",
        id: 1
      };

      const result = await server.handleMessage(request);
      expect(result?.jsonrpc).toBe("2.0");
    });
  });
});
