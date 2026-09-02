import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { env } from "cloudflare:workers";
import { McpApiHandler } from "../../../src/index";
import { createCredentialStore } from "../../../src/oauth/services/credential-store";
import { CREDENTIAL_TTL_SECONDS } from "../../../src/oauth/types";
import { fetchMock } from "../../helpers/fetch-mock";
import {
  MCP_PROTOCOL_VERSION,
  createRequest,
  createNotification,
  createMCPHeaders,
  base64Sentinel,
  type HeaderOptions,
  type RequestOptions,
} from "../../helpers/json-rpc";

/**
 * MCP 2026-07-28 Streamable HTTP transport validation.
 *
 * `/mcp` sits behind @cloudflare/workers-oauth-provider, which answers 401 before
 * McpApiHandler ever runs - so an integration test through `exports.default.fetch`
 * can never reach this pipeline. The handler is therefore driven directly with a
 * synthetic `ctx.props` and KV-seeded credentials.
 */

const TOKEN_ID = "test-token-id";

const testCtx = {
  props: {
    tokenId: TOKEN_ID,
    staffId: 1,
    staffEmail: "test@example.com",
    accountName: "testaccount",
    region: "us" as const,
    scopes: ["happyfox:read", "happyfox:write"],
  },
  waitUntil() {},
  passThroughOnException() {},
};

function post(body: unknown, headers: Record<string, string>): Request {
  return new Request("https://worker.test/mcp", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** Send a fully-valid modern request, with optional header overrides. */
async function send(
  method: string,
  params: Record<string, unknown> = {},
  headerOptions: HeaderOptions = {},
  requestOptions: RequestOptions = {}
): Promise<Response> {
  const body = createRequest(method, params, requestOptions);
  const headers = createMCPHeaders(method, params, headerOptions);
  return new McpApiHandler().fetch(post(body, headers), env, testCtx as any);
}

async function jsonBody(response: Response): Promise<Record<string, any>> {
  return (await response.json()) as Record<string, any>;
}

describe("McpApiHandler - MCP 2026-07-28 transport", () => {
  beforeAll(async () => {
    const store = createCredentialStore(env.OAUTH_KV, env.CREDENTIAL_ENCRYPTION_KEY);
    const now = Math.floor(Date.now() / 1000);
    await store.store(TOKEN_ID, {
      apiKey: "test-api-key",
      authCode: "test-auth-code",
      accountName: "testaccount",
      region: "us",
      staffId: 1,
      staffName: "Test Staff",
      staffEmail: "test@example.com",
      createdAt: now,
      expiresAt: now + CREDENTIAL_TTL_SECONDS,
    });

    // Nothing in this suite should reach the HappyFox API; if it does, fail loudly
    // instead of hitting the network.
    fetchMock.activate();
    fetchMock.disableNetConnect();
  });

  afterAll(() => {
    fetchMock.deactivate();
  });

  describe("HTTP method handling", () => {
    it("returns 405 for GET (there is no SSE stream to open)", async () => {
      const response = await new McpApiHandler().fetch(
        new Request("https://worker.test/mcp", { method: "GET" }),
        env,
        testCtx as any
      );

      expect(response.status).toBe(405);
      expect(response.headers.get("Allow")).toBe("POST, OPTIONS");
    });

    it("returns 405 for DELETE (there is no session to terminate)", async () => {
      const response = await new McpApiHandler().fetch(
        new Request("https://worker.test/mcp", { method: "DELETE" }),
        env,
        testCtx as any
      );

      expect(response.status).toBe(405);
      expect(response.headers.get("Allow")).toBe("POST, OPTIONS");
    });

    it("returns 405 for PUT", async () => {
      const response = await new McpApiHandler().fetch(
        new Request("https://worker.test/mcp", { method: "PUT" }),
        env,
        testCtx as any
      );

      expect(response.status).toBe(405);
    });

    it("answers OPTIONS preflight", async () => {
      const response = await new McpApiHandler().fetch(
        new Request("https://worker.test/mcp", {
          method: "OPTIONS",
          headers: { Origin: "http://localhost:3000" },
        }),
        env,
        testCtx as any
      );

      expect([200, 204]).toContain(response.status);
      expect(response.headers.get("Access-Control-Allow-Methods")).toBe("POST, OPTIONS");
    });
  });

  describe("Origin validation", () => {
    it("returns 403 for a disallowed Origin", async () => {
      const body = createRequest("server/discover");
      const response = await new McpApiHandler().fetch(
        post(body, {
          ...createMCPHeaders("server/discover"),
          Origin: "https://evil.example.com",
        }),
        env,
        testCtx as any
      );

      expect(response.status).toBe(403);
    });

    it("does not reject a request with no Origin header", async () => {
      const response = await send("server/discover");
      expect(response.status).not.toBe(403);
      expect(response.status).toBe(200);
    });
  });

  describe("body envelope", () => {
    it("returns 400 -32700 with no id for unparseable JSON", async () => {
      const response = await new McpApiHandler().fetch(
        post("{not json", createMCPHeaders("server/discover")),
        env,
        testCtx as any
      );

      expect(response.status).toBe(400);
      const json = await jsonBody(response);
      expect(json.error.code).toBe(-32700);
      // The id could not be read, so the member must be absent - never null.
      expect("id" in json).toBe(false);
    });

    it("rejects batch requests with 400 -32600 and no id", async () => {
      const response = await new McpApiHandler().fetch(
        post([createRequest("server/discover")], createMCPHeaders("server/discover")),
        env,
        testCtx as any
      );

      expect(response.status).toBe(400);
      const json = await jsonBody(response);
      expect(json.error.code).toBe(-32600);
      expect(json.error.message).toContain("Batch");
      expect("id" in json).toBe(false);
    });

    it("rejects a non-object body", async () => {
      const response = await new McpApiHandler().fetch(
        post("42", createMCPHeaders("server/discover")),
        env,
        testCtx as any
      );

      expect(response.status).toBe(400);
      expect((await jsonBody(response)).error.code).toBe(-32600);
    });

    it("rejects a wrong jsonrpc version", async () => {
      const body = { ...createRequest("server/discover"), jsonrpc: "1.0" };
      const response = await new McpApiHandler().fetch(
        post(body, createMCPHeaders("server/discover")),
        env,
        testCtx as any
      );

      expect(response.status).toBe(400);
      expect((await jsonBody(response)).error.code).toBe(-32600);
    });

    it("rejects a missing method field", async () => {
      const body: Record<string, unknown> = { ...createRequest("server/discover") };
      delete body.method;
      const response = await new McpApiHandler().fetch(
        post(body, createMCPHeaders("server/discover")),
        env,
        testCtx as any
      );

      expect(response.status).toBe(400);
      expect((await jsonBody(response)).error.code).toBe(-32600);
    });

    it("rejects id: null - unlike base JSON-RPC, null is no longer a valid id", async () => {
      const body = { ...createRequest("server/discover"), id: null };
      const response = await new McpApiHandler().fetch(
        post(body, createMCPHeaders("server/discover")),
        env,
        testCtx as any
      );

      expect(response.status).toBe(400);
      const json = await jsonBody(response);
      expect(json.error.code).toBe(-32600);
      expect(json.error.message).toContain("id must be a string or a number");
      expect("id" in json).toBe(false);
    });

    it("rejects a non-scalar id", async () => {
      const body = { ...createRequest("server/discover"), id: { nested: true } };
      const response = await new McpApiHandler().fetch(
        post(body, createMCPHeaders("server/discover")),
        env,
        testCtx as any
      );

      expect(response.status).toBe(400);
      expect((await jsonBody(response)).error.code).toBe(-32600);
    });

    it("echoes a readable string id on a validation error", async () => {
      const response = await send("tools/list", {}, { mcpMethod: "tools/call" }, { id: "abc-123" });

      expect(response.status).toBe(400);
      expect((await jsonBody(response)).id).toBe("abc-123");
    });

    it("echoes a readable numeric id on a validation error", async () => {
      const response = await send("tools/list", {}, { mcpMethod: "tools/call" }, { id: 99 });

      expect(response.status).toBe(400);
      expect((await jsonBody(response)).id).toBe(99);
    });
  });

  describe("notifications", () => {
    it("returns 202 with an empty body for an id-less request", async () => {
      const response = await new McpApiHandler().fetch(
        post(createNotification("notifications/initialized"), {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        }),
        env,
        testCtx as any
      );

      expect(response.status).toBe(202);
      expect(await response.text()).toBe("");
    });

    it("runs no header validation on a notification (no Mcp-Method needed)", async () => {
      const response = await new McpApiHandler().fetch(
        post(createNotification("anything/at/all"), { "Content-Type": "application/json" }),
        env,
        testCtx as any
      );

      expect(response.status).toBe(202);
    });
  });

  describe("Accept and Content-Type", () => {
    it("rejects an Accept header missing text/event-stream", async () => {
      const response = await send("server/discover", {}, {
        extra: { Accept: "application/json" },
      });

      expect(response.status).toBe(400);
      expect((await jsonBody(response)).error.code).toBe(-32600);
    });

    it("accepts */*", async () => {
      const response = await send("server/discover", {}, { extra: { Accept: "*/*" } });
      expect(response.status).toBe(200);
    });

    it("rejects a non-JSON Content-Type", async () => {
      const response = await send("server/discover", {}, {
        extra: { "Content-Type": "text/plain" },
      });

      expect(response.status).toBe(400);
      expect((await jsonBody(response)).error.code).toBe(-32600);
    });
  });

  describe("Mcp-Method header", () => {
    it("returns 400 -32020 when the header is missing", async () => {
      const headers = createMCPHeaders("tools/list");
      delete headers["Mcp-Method"];
      const response = await new McpApiHandler().fetch(
        post(createRequest("tools/list"), headers),
        env,
        testCtx as any
      );

      expect(response.status).toBe(400);
      const json = await jsonBody(response);
      expect(json.error.code).toBe(-32020);
      // Legacy clients have no fall-forward mechanism; name the version we speak.
      expect(json.error.message).toContain("2026-07-28");
    });

    it("compares header values case-sensitively", async () => {
      const response = await send("tools/list", {}, { mcpMethod: "TOOLS/LIST" });

      expect(response.status).toBe(400);
      const json = await jsonBody(response);
      expect(json.error.code).toBe(-32020);
      expect(json.error.message).toContain("does not match body value");
    });

    it("returns 400 -32020 when the header names a different method", async () => {
      const response = await send("tools/list", {}, { mcpMethod: "resources/list" });

      expect(response.status).toBe(400);
      expect((await jsonBody(response)).error.code).toBe(-32020);
    });
  });

  describe("MCP-Protocol-Version header and params._meta", () => {
    it("returns 400 -32020 when the header is missing", async () => {
      const headers = createMCPHeaders("tools/list");
      delete headers["MCP-Protocol-Version"];
      const response = await new McpApiHandler().fetch(
        post(createRequest("tools/list"), headers),
        env,
        testCtx as any
      );

      expect(response.status).toBe(400);
      const json = await jsonBody(response);
      expect(json.error.code).toBe(-32020);
      expect(json.error.message).toContain("2026-07-28");
    });

    it("returns 400 -32602 when params is absent entirely", async () => {
      const body: Record<string, unknown> = { ...createRequest("tools/list") };
      delete body.params;
      const response = await new McpApiHandler().fetch(
        post(body, createMCPHeaders("tools/list")),
        env,
        testCtx as any
      );

      expect(response.status).toBe(400);
      expect((await jsonBody(response)).error.code).toBe(-32602);
    });

    it("returns 400 -32602 when params._meta is absent", async () => {
      const response = await new McpApiHandler().fetch(
        post(
          { jsonrpc: "2.0", method: "tools/list", id: 1, params: {} },
          createMCPHeaders("tools/list")
        ),
        env,
        testCtx as any
      );

      expect(response.status).toBe(400);
      expect((await jsonBody(response)).error.code).toBe(-32602);
    });

    it("returns 400 -32602 when _meta omits the protocol version", async () => {
      const response = await new McpApiHandler().fetch(
        post(
          {
            jsonrpc: "2.0",
            method: "tools/list",
            id: 1,
            params: { _meta: { "io.modelcontextprotocol/clientCapabilities": {} } },
          },
          createMCPHeaders("tools/list")
        ),
        env,
        testCtx as any
      );

      expect(response.status).toBe(400);
      expect((await jsonBody(response)).error.code).toBe(-32602);
    });

    it("returns 400 -32020 when the header and _meta disagree", async () => {
      const response = await send(
        "tools/list",
        {},
        { protocolVersion: MCP_PROTOCOL_VERSION },
        { metaProtocolVersion: "2025-11-25" }
      );

      expect(response.status).toBe(400);
      const json = await jsonBody(response);
      expect(json.error.code).toBe(-32020);
      expect(json.error.message).toContain("does not match body value");
    });

    it("returns 400 -32022 with data.supported when both agree on an old version", async () => {
      const response = await send(
        "tools/list",
        {},
        { protocolVersion: "2025-11-25" },
        { metaProtocolVersion: "2025-11-25" }
      );

      expect(response.status).toBe(400);
      const json = await jsonBody(response);
      expect(json.error.code).toBe(-32022);
      expect(json.error.data).toEqual({
        supported: ["2026-07-28"],
        requested: "2025-11-25",
      });
    });

    it("returns 400 -32602 when clientCapabilities is missing", async () => {
      const response = await send("tools/list", {}, {}, { omitClientCapabilities: true });

      expect(response.status).toBe(400);
      const json = await jsonBody(response);
      expect(json.error.code).toBe(-32602);
      expect(json.error.message).toContain("clientCapabilities");
    });

    it("accepts a request with no clientInfo - its absence is legal", async () => {
      const response = await send("tools/list", {}, {}, { omitClientInfo: true });
      expect(response.status).toBe(200);
    });
  });

  describe("Mcp-Name header", () => {
    it("returns 400 -32020 when tools/call omits it", async () => {
      const params = { name: "happyfox_list_tickets", arguments: {} };
      const headers = createMCPHeaders("tools/call", params);
      delete headers["Mcp-Name"];
      const response = await new McpApiHandler().fetch(
        post(createRequest("tools/call", params), headers),
        env,
        testCtx as any
      );

      expect(response.status).toBe(400);
      const json = await jsonBody(response);
      expect(json.error.code).toBe(-32020);
      expect(json.error.message).toContain("Mcp-Name");
    });

    it("returns 400 -32020 when tools/call sends the wrong name", async () => {
      const response = await send(
        "tools/call",
        { name: "happyfox_list_tickets", arguments: {} },
        { mcpName: "wrong_tool" }
      );

      expect(response.status).toBe(400);
      expect((await jsonBody(response)).error.code).toBe(-32020);
    });

    it("returns 400 -32020 when resources/read omits it", async () => {
      const params = { uri: "happyfox://categories" };
      const headers = createMCPHeaders("resources/read", params);
      delete headers["Mcp-Name"];
      const response = await new McpApiHandler().fetch(
        post(createRequest("resources/read", params), headers),
        env,
        testCtx as any
      );

      expect(response.status).toBe(400);
      expect((await jsonBody(response)).error.code).toBe(-32020);
    });

    it("accepts a plain resource URI", async () => {
      const response = await send("resources/read", { uri: "happyfox://not-a-resource" });

      // Reaches the protocol layer: unknown resource, not a header rejection.
      expect(response.status).toBe(200);
      expect((await jsonBody(response)).error.code).toBe(-32602);
    });

    it("decodes the base64 sentinel before comparing (tools/call)", async () => {
      const response = await send(
        "tools/call",
        { name: "nonexistent_tool", arguments: {} },
        { mcpName: base64Sentinel("nonexistent_tool") }
      );

      // The header matched and the request reached the protocol layer: the only
      // complaint left is the unknown tool, not a -32020 header mismatch.
      expect(response.status).toBe(200);
      expect((await jsonBody(response)).error.code).toBe(-32602);
    });

    it("decodes the base64 sentinel before comparing (resources/read)", async () => {
      const response = await send(
        "resources/read",
        { uri: "happyfox://not-a-resource" },
        { mcpName: base64Sentinel("happyfox://not-a-resource") }
      );

      expect(response.status).toBe(200);
      expect((await jsonBody(response)).error.code).toBe(-32602);
    });

    it("uses the literal sentinel constant from the spec", () => {
      expect(base64Sentinel("happyfox_list_tickets")).toBe(
        "=?base64?aGFwcHlmb3hfbGlzdF90aWNrZXRz?="
      );
      expect(base64Sentinel("happyfox://categories")).toBe(
        "=?base64?aGFwcHlmb3g6Ly9jYXRlZ29yaWVz?="
      );
    });

    it("returns 400 -32020 for a malformed sentinel payload", async () => {
      const response = await send(
        "tools/call",
        { name: "happyfox_list_tickets", arguments: {} },
        { mcpName: "=?base64?not!valid!?=" }
      );

      expect(response.status).toBe(400);
      expect((await jsonBody(response)).error.code).toBe(-32020);
    });

    it("returns 400 -32602 when tools/call has a header but no params.name", async () => {
      // A body with no params.name fails the CallToolRequest schema: a malformed
      // request (-32602, HTTP 400), not a header that disagrees with a body value
      // that is actually present (-32020).
      const response = await send("tools/call", { arguments: {} }, { mcpName: "some_tool" });

      expect(response.status).toBe(400);
      const json = await jsonBody(response);
      expect(json.error.code).toBe(-32602);
      expect(json.error.message).toContain("params.name");
      expect(json.error.message).toContain("some_tool");
    });

    it("returns 400 -32602 when resources/read has a header but no params.uri", async () => {
      const response = await send("resources/read", {}, { mcpName: "happyfox://categories" });

      expect(response.status).toBe(400);
      const json = await jsonBody(response);
      expect(json.error.code).toBe(-32602);
      expect(json.error.message).toContain("params.uri");
    });

    it("ignores Mcp-Name on methods that do not require it", async () => {
      const response = await send("tools/list", {}, { mcpName: "irrelevant" });
      expect(response.status).toBe(200);
    });
  });

  describe("unknown methods", () => {
    const unknown = [
      "initialize",
      "notifications/initialized",
      "completion/complete",
      "prompts/list",
      "prompts/get",
      "resources/templates/list",
      "resources/subscribe",
      "subscriptions/listen",
      "ping",
      "logging/setLevel",
      "tasks/get",
    ];

    for (const method of unknown) {
      it(`returns 404 -32601 for ${method}`, async () => {
        const response = await send(method, { name: "x", uri: "x" }, { mcpName: "x" });

        expect(response.status).toBe(404);
        const json = await jsonBody(response);
        expect(json.error.code).toBe(-32601);
        expect(json.id).toBe(1);
      });
    }

    it("names the supported version in the 404 body for a legacy initialize", async () => {
      const response = await send("initialize");

      expect(response.status).toBe(404);
      const json = await jsonBody(response);
      expect(json.error.message).toContain("2026-07-28");
      expect(json.error.message).toContain("server/discover");
    });
  });

  describe("legacy session headers", () => {
    it("ignores an inbound Mcp-Session-Id rather than honoring or rejecting it", async () => {
      const response = await send("server/discover", {}, {
        extra: { "Mcp-Session-Id": "garbage-session", "Last-Event-ID": "42" },
      });

      expect(response.status).toBe(200);
      expect((await jsonBody(response)).result.resultType).toBe("complete");
    });

    it("never mints or echoes a session id", async () => {
      const response = await send("server/discover");

      expect(response.headers.get("MCP-Session-Id")).toBeNull();
      expect(response.headers.get("Mcp-Session-Id")).toBeNull();
    });
  });

  describe("successful dispatch", () => {
    it("returns a complete server/discover result", async () => {
      const response = await send("server/discover");

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("application/json");

      const json = await jsonBody(response);
      expect(json.id).toBe(1);
      expect(json.result.resultType).toBe("complete");
      expect(json.result.supportedVersions).toEqual(["2026-07-28"]);
      expect(json.result.ttlMs).toBe(3_600_000);
      expect(json.result.cacheScope).toBe("public");
      expect(json.result._meta["io.modelcontextprotocol/serverInfo"].name).toBe("happyfox-mcp");
    });

    it("returns a privately-cacheable tools/list result", async () => {
      const response = await send("tools/list");

      expect(response.status).toBe(200);
      const json = await jsonBody(response);
      expect(json.result.resultType).toBe("complete");
      expect(Array.isArray(json.result.tools)).toBe(true);
      expect(json.result.ttlMs).toBe(900_000);
      expect(json.result.cacheScope).toBe("private");
      expect(json.result._meta["io.modelcontextprotocol/serverInfo"]).toBeDefined();
    });

    it("returns a privately-cacheable resources/list result", async () => {
      const response = await send("resources/list");

      expect(response.status).toBe(200);
      const json = await jsonBody(response);
      expect(json.result.resultType).toBe("complete");
      expect(json.result.ttlMs).toBe(900_000);
      expect(json.result.cacheScope).toBe("private");
    });
  });

  describe("the -32602 status split", () => {
    it("returns HTTP 200 for an unknown resource (application-level -32602)", async () => {
      const response = await send("resources/read", { uri: "happyfox://nonexistent" });

      expect(response.status).toBe(200);
      const json = await jsonBody(response);
      expect(json.error.code).toBe(-32602);
      expect(json.error.data).toEqual({ uri: "happyfox://nonexistent" });
    });

    it("returns HTTP 200 for an unknown tool (application-level -32602)", async () => {
      const response = await send("tools/call", { name: "nonexistent_tool", arguments: {} });

      expect(response.status).toBe(200);
      expect((await jsonBody(response)).error.code).toBe(-32602);
    });

    it("returns HTTP 400 for a malformed _meta (transport-level -32602)", async () => {
      const response = await send("tools/list", {}, {}, { omitClientCapabilities: true });

      expect(response.status).toBe(400);
      expect((await jsonBody(response)).error.code).toBe(-32602);
    });
  });

  describe("server misconfiguration", () => {
    it("returns 500 -32603 when the encryption key is invalid", async () => {
      const response = await new McpApiHandler().fetch(
        post(createRequest("server/discover"), createMCPHeaders("server/discover")),
        { ...env, CREDENTIAL_ENCRYPTION_KEY: "too-short" },
        testCtx as any
      );

      expect(response.status).toBe(500);
      const json = await jsonBody(response);
      expect(json.error.code).toBe(-32603);
      expect("id" in json).toBe(false);
    });
  });

  describe("insufficient scope (authorization spec: runtime insufficient scope errors)", () => {
    it("returns 403 with an insufficient_scope challenge for a tool the token cannot call", async () => {
      // testCtx grants read+write; happyfox_delete_ticket needs happyfox:admin.
      const response = await send("tools/call", {
        name: "happyfox_delete_ticket",
        arguments: { ticket_id: "1" },
      });

      expect(response.status).toBe(403);
      const challenge = response.headers.get("WWW-Authenticate") ?? "";
      expect(challenge).toMatch(/^Bearer /);
      expect(challenge).toContain('error="insufficient_scope"');
      expect(challenge).toContain('scope="happyfox:admin"');
      expect(challenge).toContain(
        'resource_metadata="https://worker.test/.well-known/oauth-protected-resource/mcp"'
      );

      const json = await jsonBody(response);
      expect(json.id).toBe(1);
      expect(json.error.code).toBe(403);
      expect(json.error.data).toEqual({ requiredScopes: ["happyfox:admin"] });
      expect(json.result).toBeUndefined();
    });

    it("returns 403 with an insufficient_scope challenge for resources/read without happyfox:read", async () => {
      const params = { uri: "happyfox://categories" };
      const response = await new McpApiHandler().fetch(
        post(createRequest("resources/read", params), createMCPHeaders("resources/read", params)),
        env,
        { ...testCtx, props: { ...testCtx.props, scopes: [] } } as any
      );

      expect(response.status).toBe(403);
      const challenge = response.headers.get("WWW-Authenticate") ?? "";
      expect(challenge).toContain('error="insufficient_scope"');
      expect(challenge).toContain('scope="happyfox:read"');

      const json = await jsonBody(response);
      expect(json.error.code).toBe(403);
      // Never the resource-not-found shape: the resource exists, the caller may not read it.
      expect(json.error.code).not.toBe(-32602);
    });

    it("keeps CORS headers on the 403 so a browser client can read the challenge", async () => {
      const response = await send(
        "tools/call",
        { name: "happyfox_delete_ticket", arguments: { ticket_id: "1" } },
        { extra: { Origin: "http://localhost:3000" } }
      );

      expect(response.status).toBe(403);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3000");
      expect(response.headers.get("Access-Control-Expose-Headers")).toBe("WWW-Authenticate");
    });
  });

  describe("credential retrieval failure", () => {
    it("returns 401 with an invalid_token challenge when the stored credentials are gone", async () => {
      const response = await new McpApiHandler().fetch(
        post(createRequest("tools/list"), createMCPHeaders("tools/list")),
        env,
        { ...testCtx, props: { ...testCtx.props, tokenId: "missing-token" } } as any
      );

      expect(response.status).toBe(401);
      const challenge = response.headers.get("WWW-Authenticate") ?? "";
      expect(challenge).toMatch(/^Bearer /);
      expect(challenge).toContain('error="invalid_token"');
      expect(challenge).toContain(
        'resource_metadata="https://worker.test/.well-known/oauth-protected-resource/mcp"'
      );

      const json = await jsonBody(response);
      // Application-defined code outside the JSON-RPC reserved range, mirroring
      // the HTTP status. Not -32603: nothing went wrong inside the server.
      expect(json.error.code).toBe(401);
      expect(json.id).toBe(1);
    });

    it("never emits the forbidden -32000/-32001/-32002 legacy codes", async () => {
      const response = await new McpApiHandler().fetch(
        post(createRequest("tools/list"), createMCPHeaders("tools/list")),
        env,
        { ...testCtx, props: { ...testCtx.props, tokenId: "missing-token" } } as any
      );

      const code = (await jsonBody(response)).error.code as number;
      expect([-32000, -32001, -32002]).not.toContain(code);
    });
  });
});
