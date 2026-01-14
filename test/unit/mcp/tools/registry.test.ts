import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ToolRegistry } from "../../../../src/mcp/tools/registry";
import { ToolNotFoundError, ToolExecutionError, HappyFoxAuth, AuthContext } from "../../../../src/types";
import { HappyFoxAPIError } from "../../../../src/happyfox/client";

// Mock global fetch to prevent network calls in unit tests
const mockFetch = vi.fn();

describe("ToolRegistry", () => {
  let registry: ToolRegistry;
  let originalFetch: typeof global.fetch;

  const testAuth: HappyFoxAuth = {
    apiKey: "test-api-key",
    authCode: "test-auth-code",
    accountName: "testaccount",
    region: "us"
  };

  const testAuthContext: AuthContext = {
    credentials: testAuth,
    staffId: 1,
    staffEmail: "test@example.com",
    scopes: ["happyfox:read", "happyfox:write", "happyfox:admin"],
    tokenId: "test-token-id"
  };

  beforeEach(() => {
    registry = new ToolRegistry();
    // Replace global fetch with mock to prevent network calls
    originalFetch = global.fetch;
    global.fetch = mockFetch;
    // Default mock response for API calls
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: "Unauthorized" }),
      text: async () => "Unauthorized"
    });
  });

  afterEach(() => {
    // Restore original fetch
    global.fetch = originalFetch;
    mockFetch.mockReset();
  });

  describe("constructor", () => {
    it("initializes with all tool modules", () => {
      // Just verify it doesn't throw
      expect(registry).toBeInstanceOf(ToolRegistry);
    });
  });

  describe("listTools", () => {
    it("returns all registered tools", async () => {
      const tools = await registry.listTools();

      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);
    });

    it("returns tools with correct structure", async () => {
      const tools = await registry.listTools();

      for (const tool of tools) {
        expect(tool).toHaveProperty("name");
        expect(tool).toHaveProperty("description");
        expect(tool).toHaveProperty("inputSchema");
        expect(tool.inputSchema.type).toBe("object");
        expect(tool.inputSchema).toHaveProperty("properties");
      }
    });

    it("includes expected tool names", async () => {
      const tools = await registry.listTools();
      const toolNames = tools.map(t => t.name);

      // Check for tools from each module
      expect(toolNames).toContain("happyfox_list_tickets");
      expect(toolNames).toContain("happyfox_list_contacts");
      expect(toolNames).toContain("happyfox_list_assets");
    });

    it("includes all ticket tools", async () => {
      const tools = await registry.listTools();
      const toolNames = tools.map(t => t.name);

      expect(toolNames).toContain("happyfox_create_ticket");
      expect(toolNames).toContain("happyfox_get_ticket");
      expect(toolNames).toContain("happyfox_add_staff_reply");
      expect(toolNames).toContain("happyfox_add_private_note");
    });

    it("includes all contact tools", async () => {
      const tools = await registry.listTools();
      const toolNames = tools.map(t => t.name);

      expect(toolNames).toContain("happyfox_create_contact");
      expect(toolNames).toContain("happyfox_get_contact");
      expect(toolNames).toContain("happyfox_get_contact_group");
    });

    it("includes all asset tools", async () => {
      const tools = await registry.listTools();
      const toolNames = tools.map(t => t.name);

      expect(toolNames).toContain("happyfox_create_asset");
      expect(toolNames).toContain("happyfox_get_asset");
      expect(toolNames).toContain("happyfox_delete_asset");
      expect(toolNames).toContain("happyfox_list_asset_custom_fields");
    });
  });

  describe("callToolWithAuth", () => {
    it("throws ToolNotFoundError for unknown tool", async () => {
      await expect(registry.callToolWithAuth("nonexistent_tool", {}, testAuthContext))
        .rejects.toThrow(ToolNotFoundError);
    });

    it("throws ToolNotFoundError with correct message", async () => {
      await expect(registry.callToolWithAuth("unknown_tool", {}, testAuthContext))
        .rejects.toThrow("Tool not found: unknown_tool");
    });

    it("wraps HappyFoxAPIError in ToolExecutionError", async () => {
      // With mocked fetch returning 401, the handler will throw ToolExecutionError
      await expect(registry.callToolWithAuth("happyfox_get_ticket", { ticket_id: "invalid" }, testAuthContext))
        .rejects.toThrow(ToolExecutionError);

      // Verify fetch was called (not bypassed)
      expect(mockFetch).toHaveBeenCalled();
    });

    it("wraps non-Error thrown values in ToolExecutionError", async () => {
      // Mock a handler to throw a non-Error value
      const testRegistry = new ToolRegistry();

      // Access private toolHandlers map and replace a handler
      (testRegistry as any).toolHandlers.set("happyfox_list_tickets", async () => {
        throw "string error from handler";
      });

      await expect(testRegistry.callToolWithAuth("happyfox_list_tickets", {}, testAuthContext))
        .rejects.toThrow(ToolExecutionError);

      try {
        await testRegistry.callToolWithAuth("happyfox_list_tickets", {}, testAuthContext);
      } catch (error) {
        expect(error).toBeInstanceOf(ToolExecutionError);
        expect((error as ToolExecutionError).message).toBe("string error from handler");
      }
    });

    it("wraps regular Error in ToolExecutionError", async () => {
      const testRegistry = new ToolRegistry();

      (testRegistry as any).toolHandlers.set("happyfox_list_tickets", async () => {
        throw new Error("regular error from handler");
      });

      await expect(testRegistry.callToolWithAuth("happyfox_list_tickets", {}, testAuthContext))
        .rejects.toThrow(ToolExecutionError);

      try {
        await testRegistry.callToolWithAuth("happyfox_list_tickets", {}, testAuthContext);
      } catch (error) {
        expect(error).toBeInstanceOf(ToolExecutionError);
        expect((error as ToolExecutionError).message).toBe("regular error from handler");
      }
    });

    it("throws ToolExecutionError for insufficient scopes", async () => {
      const limitedAuthContext: AuthContext = {
        ...testAuthContext,
        scopes: ["happyfox:read"] // Only read scope, not admin
      };

      await expect(registry.callToolWithAuth("happyfox_delete_ticket", { ticket_id: "123" }, limitedAuthContext))
        .rejects.toThrow(ToolExecutionError);

      try {
        await registry.callToolWithAuth("happyfox_delete_ticket", { ticket_id: "123" }, limitedAuthContext);
      } catch (error) {
        expect(error).toBeInstanceOf(ToolExecutionError);
        expect((error as ToolExecutionError).message).toContain("Insufficient permissions");
      }
    });
  });

  describe("tool registration", () => {
    it("registers tools with unique names", async () => {
      const tools = await registry.listTools();
      const toolNames = tools.map(t => t.name);
      const uniqueNames = new Set(toolNames);

      expect(toolNames.length).toBe(uniqueNames.size);
    });

    it("binds handlers correctly", async () => {
      // Verify that handlers are bound by checking they exist for all tools
      // Uses mocked fetch to prevent network calls
      const tools = await registry.listTools();

      for (const tool of tools) {
        // This would throw ToolNotFoundError if handler wasn't registered
        // With mocked fetch, it will throw ToolExecutionError from the mock 401 response
        try {
          await registry.callToolWithAuth(tool.name, {}, testAuthContext);
        } catch (error) {
          // Should NOT be ToolNotFoundError - that would mean handler wasn't registered
          expect(error).not.toBeInstanceOf(ToolNotFoundError);
          // Should be ToolExecutionError from the mocked API response
          expect(error).toBeInstanceOf(ToolExecutionError);
        }
      }
      // Verify fetch was actually called (handlers executed, not just registered)
      expect(mockFetch).toHaveBeenCalled();
    });
  });
});

describe("ToolNotFoundError", () => {
  it("creates error with correct message format", () => {
    const error = new ToolNotFoundError("my_tool");

    expect(error.message).toBe("Tool not found: my_tool");
    expect(error.name).toBe("ToolNotFoundError");
  });

  it("inherits from Error", () => {
    const error = new ToolNotFoundError("test");
    expect(error).toBeInstanceOf(Error);
  });
});

describe("ToolExecutionError", () => {
  it("creates error with message only", () => {
    const error = new ToolExecutionError("Something went wrong");

    expect(error.message).toBe("Something went wrong");
    expect(error.name).toBe("ToolExecutionError");
    expect(error.statusCode).toBeUndefined();
    expect(error.errorCode).toBeUndefined();
  });

  it("creates error with statusCode and errorCode", () => {
    const error = new ToolExecutionError("API Error", 404, "NOT_FOUND");

    expect(error.message).toBe("API Error");
    expect(error.statusCode).toBe(404);
    expect(error.errorCode).toBe("NOT_FOUND");
  });

  it("inherits from Error", () => {
    const error = new ToolExecutionError("test");
    expect(error).toBeInstanceOf(Error);
  });
});
