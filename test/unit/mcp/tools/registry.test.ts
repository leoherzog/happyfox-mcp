import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ToolRegistry } from "../../../../src/mcp/tools/registry";
import {
  ToolNotFoundError,
  ToolExecutionError,
  InsufficientScopeError,
  CredentialsRejectedError,
  HappyFoxAuth,
  AuthContext,
  MCPTool
} from "../../../../src/types";
import { HappyFoxAPIError } from "../../../../src/happyfox/client";
import { TOOL_SCOPE_MAP, TOOLS_REQUIRING_STAFF_ID } from "../../../../src/oauth/services/scope-enforcer";

// Mock global fetch to prevent network calls in unit tests
const mockFetch = vi.fn();

describe("ToolRegistry", () => {
  let registry: ToolRegistry;
  let originalFetch: typeof globalThis.fetch;

  const testAuth: HappyFoxAuth = {
    apiKey: "test-api-key",
    authCode: "test-auth-code",
    accountName: "testaccount",
    region: "us"
  };

  const allScopes = ["happyfox:read", "happyfox:write", "happyfox:admin"];

  const testAuthContext: AuthContext = {
    credentials: testAuth,
    staffId: 1,
    scopes: allScopes
  };

  beforeEach(() => {
    registry = new ToolRegistry();
    // Replace global fetch with mock to prevent network calls
    originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;
    // Default mock response for API calls
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: "Not found" }),
      text: async () => "Not found"
    });
  });

  afterEach(() => {
    // Restore original fetch
    globalThis.fetch = originalFetch;
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
      const tools = await registry.listTools(allScopes);

      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);
    });

    it("returns tools with correct structure", async () => {
      const tools = await registry.listTools(allScopes);

      for (const tool of tools) {
        expect(tool).toHaveProperty("name");
        expect(tool).toHaveProperty("description");
        expect(tool).toHaveProperty("inputSchema");
        expect(tool.inputSchema.type).toBe("object");
        expect(tool.inputSchema).toHaveProperty("properties");
      }
    });

    it("includes expected tool names", async () => {
      const tools = await registry.listTools(allScopes);
      const toolNames = tools.map(t => t.name);

      // Check for tools from each module
      expect(toolNames).toContain("happyfox_list_tickets");
      expect(toolNames).toContain("happyfox_list_contacts");
      expect(toolNames).toContain("happyfox_list_assets");
    });

    it("includes all ticket tools", async () => {
      const tools = await registry.listTools(allScopes);
      const toolNames = tools.map(t => t.name);

      expect(toolNames).toContain("happyfox_create_ticket");
      expect(toolNames).toContain("happyfox_get_ticket");
      expect(toolNames).toContain("happyfox_add_staff_reply");
      expect(toolNames).toContain("happyfox_add_private_note");
    });

    it("includes all contact tools", async () => {
      const tools = await registry.listTools(allScopes);
      const toolNames = tools.map(t => t.name);

      expect(toolNames).toContain("happyfox_create_contact");
      expect(toolNames).toContain("happyfox_get_contact");
      expect(toolNames).toContain("happyfox_get_contact_group");
    });

    it("includes all asset tools", async () => {
      const tools = await registry.listTools(allScopes);
      const toolNames = tools.map(t => t.name);

      expect(toolNames).toContain("happyfox_create_asset");
      expect(toolNames).toContain("happyfox_get_asset");
      expect(toolNames).toContain("happyfox_delete_asset");
      expect(toolNames).toContain("happyfox_list_asset_custom_fields");
    });

    it("includes the report, knowledge base and custom field choice tools", async () => {
      const toolNames = (await registry.listTools(allScopes)).map(t => t.name);

      expect(toolNames).toContain("happyfox_get_report_summary");
      expect(toolNames).toContain("happyfox_get_report_sla_performance");
      expect(toolNames).toContain("happyfox_get_kb_article");
      expect(toolNames).toContain("happyfox_get_kb_section");
      expect(toolNames).toContain("happyfox_update_ticket_custom_field_choices");
    });

    it("returns no tools for an empty scope list", async () => {
      expect(await registry.listTools([])).toEqual([]);
    });

    it("returns only the tools a single scope permits", async () => {
      const toolNames = (await registry.listTools(["happyfox:read"])).map(t => t.name);

      expect(toolNames).toContain("happyfox_list_tickets");
      expect(toolNames).not.toContain("happyfox_create_ticket");
      expect(toolNames).not.toContain("happyfox_delete_ticket");
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
      // With mocked fetch returning 404, the handler will throw ToolExecutionError
      await expect(registry.callToolWithAuth("happyfox_get_ticket", { ticket_id: "999" }, testAuthContext))
        .rejects.toMatchObject({ name: "ToolExecutionError", statusCode: 404, errorCode: "API_ERROR" });

      // Verify fetch was called (not bypassed)
      expect(mockFetch).toHaveBeenCalled();
    });

    it("turns a HappyFox 401 into CredentialsRejectedError so the client re-authorizes", async () => {
      mockFetch.mockResolvedValue(new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" }
      }));

      const promise = registry.callToolWithAuth("happyfox_get_ticket", { ticket_id: "999" }, testAuthContext);

      await expect(promise).rejects.toBeInstanceOf(CredentialsRejectedError);
      await expect(promise).rejects.not.toBeInstanceOf(ToolExecutionError);
    });

    it("keeps a HappyFox 403 a tool execution error, since it can be the agent's role", async () => {
      mockFetch.mockResolvedValue(new Response(JSON.stringify({ error: "Permission denied" }), {
        status: 403,
        headers: { "Content-Type": "application/json" }
      }));

      await expect(registry.callToolWithAuth("happyfox_get_ticket", { ticket_id: "7" }, testAuthContext))
        .rejects.toMatchObject({ name: "ToolExecutionError", statusCode: 403, errorCode: "API_ERROR" });
    });

    it("reports a non-JSON 200 as a tool execution error, not a result", async () => {
      mockFetch.mockResolvedValue(new Response("<!DOCTYPE html><title>Login</title>", {
        status: 200,
        headers: { "Content-Type": "text/html" }
      }));

      await expect(registry.callToolWithAuth(
        "happyfox_add_staff_reply", { ticket_id: "7", plaintext: "Hi" }, testAuthContext
      )).rejects.toMatchObject({ name: "ToolExecutionError", statusCode: 200, errorCode: "INVALID_RESPONSE" });
    });

    it("reports a redirect as a tool execution error without following it", async () => {
      mockFetch.mockResolvedValue(new Response(null, {
        status: 301,
        headers: { Location: "https://elsewhere.example.com/api/1.1/json/user/5/" }
      }));

      await expect(registry.callToolWithAuth(
        "happyfox_update_contact", { contact_id: "5", name: "New" }, testAuthContext
      )).rejects.toMatchObject({ name: "ToolExecutionError", statusCode: 301, errorCode: "REDIRECT" });
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch.mock.calls[0][1]).toMatchObject({ method: "POST", redirect: "manual" });
    });

    describe("id path injection", () => {
      const writeOnly: AuthContext = { ...testAuthContext, staffId: 7, scopes: ["happyfox:write"] };
      const readOnly: AuthContext = { ...testAuthContext, staffId: 7, scopes: ["happyfox:read"] };
      const adminOnly: AuthContext = { ...testAuthContext, staffId: 7, scopes: ["happyfox:admin"] };

      // Each would otherwise reach an admin-only or unexposed endpoint, e.g. POST /ticket/123/delete/.
      const attempts: Array<[string, Record<string, unknown>, AuthContext]> = [
        ["happyfox_update_ticket_tags", { ticket_id: "123/delete/#" }, writeOnly],
        ["happyfox_update_ticket_tags", { ticket_id: "123/delete/?" }, writeOnly],
        ["happyfox_subscribe_to_ticket", { ticket_id: "123/delete/#" }, writeOnly],
        ["happyfox_unsubscribe_from_ticket", { ticket_id: "123/delete/#" }, writeOnly],
        ["happyfox_forward_ticket", { ticket_id: "123/delete/#", to: ["x@example.com"], subject: "s", message: "m" }, writeOnly],
        ["happyfox_update_ticket_custom_fields", { ticket_id: "123/move/#", custom_fields: { staff_id: 7, target_category_id: "2" } }, writeOnly],
        ["happyfox_update_ticket_custom_fields", { ticket_id: "%2e%2e", custom_fields: {} }, writeOnly],
        ["happyfox_add_staff_reply", { ticket_id: "..", plaintext: "Hi" }, writeOnly],
        ["happyfox_update_ticket_properties", { ticket_id: "123/delete/#", status: 2 }, writeOnly],
        ["happyfox_update_contact", { contact_id: "../ticket/5/delete", custom_fields: { staff_id: 1 } }, writeOnly],
        ["happyfox_update_contact_group", { group_id: "1?x=y", name: "G" }, writeOnly],
        ["happyfox_update_asset", { asset_id: "../ticket_custom_field/5/#", custom_fields: { choices: [] } }, writeOnly],
        ["happyfox_get_ticket", { ticket_id: "../report/4/staffperformance/#" }, readOnly],
        ["happyfox_get_asset", { asset_id: "../reports/#" }, readOnly],
        ["happyfox_get_asset_custom_field", { custom_field_id: "../reports/#" }, readOnly],
        ["happyfox_get_contact_group", { group_id: "../users" }, readOnly],
        ["happyfox_get_contact", { contact_id: "x@y/../../reports/#" }, readOnly],
        ["happyfox_get_report_summary", { report_id: "../ticket/5/delete/#" }, readOnly],
        ["happyfox_get_report_tabular_data", { report_id: "1/../../users/?" }, readOnly],
        ["happyfox_get_report_staff_activity", { report_id: "%2e%2e" }, readOnly],
        ["happyfox_get_kb_article", { article_id: "../../ticket/5/#" }, readOnly],
        ["happyfox_get_kb_section", { section_id: "3?x=y" }, readOnly],
        ["happyfox_update_ticket_custom_field_choices", { custom_field_id: "1/../../user_custom_field/2", choices: [] }, adminOnly]
      ];

      it.each(attempts)("%s with %j is refused before any request", async (tool, args, context) => {
        await expect(registry.callToolWithAuth(tool, args, context)).rejects.toMatchObject({
          name: "ToolExecutionError",
          statusCode: 400,
          errorCode: "INVALID_ID"
        });
        expect(mockFetch).not.toHaveBeenCalled();
      });
    });

    describe("acting staff injection", () => {
      const context: AuthContext = { ...testAuthContext, staffId: 7, scopes: ["happyfox:write"] };

      beforeEach(() => {
        mockFetch.mockResolvedValue(new Response(JSON.stringify({ id: 5 }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }));
      });

      function sentBody(): any {
        expect(mockFetch).toHaveBeenCalledTimes(1);
        return JSON.parse(mockFetch.mock.calls[0][1].body);
      }

      it("fills the required staff of update_custom_fields with the consenting agent (Docs/1039 §11)", async () => {
        await registry.callToolWithAuth(
          "happyfox_update_ticket_custom_fields", { ticket_id: "5", custom_fields: { "t-cf-1": "x" } }, context
        );

        expect(mockFetch.mock.calls[0][0]).toContain("/ticket/5/update_custom_fields/");
        expect(sentBody()).toEqual({ staff: 7, "t-cf-1": "x" });
      });

      it("keeps an explicitly named agent", async () => {
        await registry.callToolWithAuth(
          "happyfox_update_ticket_custom_fields",
          { ticket_id: "5", staff_id: 9, custom_fields: { "t-cf-1": "x" } },
          context
        );

        expect(sentBody()).toEqual({ staff: 9, "t-cf-1": "x" });
      });

      it("sends a property-only staff_update as the consenting agent (Docs/1039 §8.1)", async () => {
        await registry.callToolWithAuth(
          "happyfox_update_ticket_properties", { ticket_id: "5", status: 3, assignee: null }, context
        );

        expect(mockFetch.mock.calls[0][0]).toContain("/ticket/5/staff_update/");
        expect(sentBody()).toEqual({ staff: 7, status: 3, assignee: null });
      });
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

    it("throws InsufficientScopeError (not a tool execution error) for insufficient scopes", async () => {
      const limitedAuthContext: AuthContext = {
        ...testAuthContext,
        scopes: ["happyfox:read"] // Only read scope, not admin
      };

      await expect(registry.callToolWithAuth("happyfox_delete_ticket", { ticket_id: "123" }, limitedAuthContext))
        .rejects.toThrow(InsufficientScopeError);

      try {
        await registry.callToolWithAuth("happyfox_delete_ticket", { ticket_id: "123" }, limitedAuthContext);
      } catch (error) {
        expect(error).toBeInstanceOf(InsufficientScopeError);
        expect(error).not.toBeInstanceOf(ToolExecutionError);
        expect((error as InsufficientScopeError).message).toContain("Insufficient scope");
        // The transport puts these in the WWW-Authenticate scope="" parameter.
        expect((error as InsufficientScopeError).requiredScopes).toEqual(["happyfox:admin"]);
      }
    });
  });

  describe("tool registration", () => {
    const registered = (): MCPTool[] => Array.from((registry as any).tools.values());

    it("gives every registered tool a scope, so none is invisible", () => {
      for (const tool of registered()) {
        expect(TOOL_SCOPE_MAP[tool.name], tool.name).toBeDefined();
      }
    });

    it("injects the acting agent into every tool that takes one", () => {
      for (const tool of registered()) {
        const param = TOOLS_REQUIRING_STAFF_ID[tool.name];
        if (tool.inputSchema.properties.staff_id) expect(param, tool.name).toBe("staff_id");
        if (param) expect(tool.inputSchema.properties, tool.name).toHaveProperty(param);
      }
    });

    it("declares items on every array schema, which OpenAI function calling requires", () => {
      /** Paths of every array schema without items, searched through every nested subschema. */
      const missingItems = (schema: unknown, path: string): string[] => {
        if (Array.isArray(schema)) return schema.flatMap((item, index) => missingItems(item, `${path}[${index}]`));
        if (typeof schema !== "object" || schema === null) return [];
        const node = schema as Record<string, unknown>;
        const types = Array.isArray(node.type) ? node.type : [node.type];
        const own = types.includes("array") && node.items === undefined ? [path] : [];
        return own.concat(Object.entries(node).flatMap(([key, child]) => missingItems(child, `${path}.${key}`)));
      };

      for (const tool of registered()) {
        expect(missingItems(tool.inputSchema, tool.name), tool.name).toEqual([]);
      }
    });

    it("registers tools with unique names", async () => {
      const tools = await registry.listTools(allScopes);
      const toolNames = tools.map(t => t.name);
      const uniqueNames = new Set(toolNames);

      expect(toolNames.length).toBe(uniqueNames.size);
    });

    it("binds handlers correctly", async () => {
      // Verify that handlers are bound by checking they exist for all tools
      // Uses mocked fetch to prevent network calls
      const tools = await registry.listTools(allScopes);

      for (const tool of tools) {
        // This would throw ToolNotFoundError if handler wasn't registered
        // With mocked fetch, it will throw ToolExecutionError from the mock 404 response
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
