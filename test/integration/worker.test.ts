import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { env, exports as workerExports } from "cloudflare:workers";
import { getOAuthApi } from "@cloudflare/workers-oauth-provider";
import { fetchMock } from "../helpers/fetch-mock";
import { createRequest, createMCPHeaders } from "../helpers/json-rpc";
import { resetFetchMock, mockHappyFoxGet, sentHappyFoxRequests } from "../helpers/fetch-mock-helpers";
import { CredentialStore } from "../../src/oauth/services/credential-store";

/**
 * Worker Integration Tests for OAuth-Protected MCP Server
 *
 * With the OAuth integration, the architecture is:
 * - /mcp -> OAuth-protected MCP API (requires Bearer token)
 * - /authorize -> Consent flow (GET shows form, POST processes credentials)
 * - /.well-known/* -> OAuth metadata endpoints
 * - /oauth/token -> Token exchange endpoint (handled by OAuthProvider)
 *
 * MCP functionality tests require OAuth tokens which are complex to mock.
 * These tests focus on non-OAuth endpoints and basic routing.
 */

describe("Worker Fetch Handler - OAuth MCP Server", () => {
  beforeAll(() => {
    fetchMock.activate();
    fetchMock.disableNetConnect();
  });

  afterEach(() => {
    fetchMock.assertNoPendingInterceptors();
  });

  describe("Well-Known Endpoints", () => {
    it("returns OAuth authorization server metadata", async () => {
      const response = await workerExports.default.fetch("https://worker.test/.well-known/oauth-authorization-server", {
        method: "GET"
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("application/json");

      const body = await response.json() as Record<string, unknown>;
      expect(body.issuer).toBeDefined();
      expect(body.authorization_endpoint).toBeDefined();
      expect(body.token_endpoint).toBeDefined();
      expect(body.response_types_supported).toContain("code");
      expect(body.code_challenge_methods_supported).toContain("S256");
    });

    it("returns OAuth protected resource metadata", async () => {
      const response = await workerExports.default.fetch("https://worker.test/.well-known/oauth-protected-resource/mcp", {
        method: "GET"
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("application/json");

      const body = await response.json() as Record<string, unknown>;
      expect(body.resource).toBe("https://worker.test/mcp");
      expect(body.authorization_servers).toBeDefined();
      expect(body.scopes_supported).toEqual(["happyfox:read", "happyfox:write", "happyfox:admin"]);
    });

    it("binds each origin to its own /mcp resource", async () => {
      const response = await workerExports.default.fetch("http://localhost:8787/.well-known/oauth-protected-resource/mcp");

      expect(response.status).toBe(200);
      expect((await response.json() as Record<string, unknown>).resource).toBe("http://localhost:8787/mcp");
    });

    it("serves protected resource metadata only at the resource's path", async () => {
      const response = await workerExports.default.fetch("https://worker.test/.well-known/oauth-protected-resource");

      expect(response.status).toBe(404);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    });
  });

  describe("Authorization Endpoint (Consent Flow)", () => {
    // The library rejects these before handleAuthorize validates anything; the handler turns its
    // AuthorizationError or CimdFetchError into a 400 page, never the generic 500.

    it("returns 400 for missing PKCE (handled by OAuth library)", async () => {
      const response = await workerExports.default.fetch("https://worker.test/authorize?client_id=https://example.com/.well-known/oauth-client-metadata&redirect_uri=https://example.com/callback&response_type=code&state=test", {
        method: "GET"
      });

      expect(response.status).toBe(400);
    });

    it("returns 400 for unsupported response types (handled by OAuth library)", async () => {
      const response = await workerExports.default.fetch("https://worker.test/authorize?client_id=https://example.com/.well-known/oauth-client-metadata&redirect_uri=https://example.com/callback&response_type=token&code_challenge=test&code_challenge_method=S256", {
        method: "GET"
      });

      expect(response.status).toBe(400);
    });
  });

  describe("Default Handler Routing", () => {
    it("returns 404 for unknown paths", async () => {
      const response = await workerExports.default.fetch("https://worker.test/unknown-path", {
        method: "GET"
      });

      expect(response.status).toBe(404);
    });

    it("marks unknown paths as non-cacheable", async () => {
      const response = await workerExports.default.fetch("https://worker.test/unknown-path", {
        method: "GET"
      });

      expect(response.headers.get("Cache-Control")).toBe("no-store");
    });
  });

  describe("Home Page", () => {
    it("serves the home page at the root path", async () => {
      const response = await workerExports.default.fetch("https://worker.test/", {
        method: "GET"
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");

      const html = await response.text();
      expect(html).toContain("<title>HappyFox MCP Adapter</title>");
      // Shows the client-facing MCP endpoint for this deployment
      expect(html).toContain("https://worker.test/mcp");
      expect(html).toContain("happyfox:read");
    });

    it("allows the home page to be cached at the edge", async () => {
      const response = await workerExports.default.fetch("https://worker.test/", {
        method: "GET"
      });

      expect(response.headers.get("Cache-Control")).toContain("public");
      expect(response.headers.get("Cache-Control")).toContain("max-age=3600");
    });

    it("rejects non-read methods on the home page", async () => {
      const response = await workerExports.default.fetch("https://worker.test/", {
        method: "POST"
      });

      expect(response.status).toBe(405);
      expect(response.headers.get("Allow")).toBe("GET, HEAD");
    });
  });

  describe("MCP Endpoint (OAuth Protected)", () => {
    // Note: These tests verify OAuth protection is active.
    // Full MCP testing requires valid OAuth tokens.

    it("requires authentication for /mcp endpoint", async () => {
      const response = await workerExports.default.fetch("https://worker.test/mcp", {
        method: "POST",
        headers: createMCPHeaders("server/discover"),
        body: JSON.stringify(createRequest("server/discover"))
      });

      // OAuth provider should reject unauthenticated requests
      expect(response.status).toBe(401);
      // Never cacheable - responses are per-user
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    });

    it("rejects GET requests to /mcp", async () => {
      const response = await workerExports.default.fetch("https://worker.test/mcp", {
        method: "GET",
        headers: { "Authorization": "Bearer invalid-token" }
      });

      // 401 from the OAuth provider (it runs first) or 405 from the transport.
      expect([401, 405]).toContain(response.status);
    });

    it("rejects DELETE requests to /mcp (there is no session to terminate)", async () => {
      const response = await workerExports.default.fetch("https://worker.test/mcp", {
        method: "DELETE",
        headers: { "Authorization": "Bearer invalid-token" }
      });

      expect([401, 405]).toContain(response.status);
    });
  });

  describe("Origin Validation", () => {
    it("allows requests from localhost", async () => {
      const response = await workerExports.default.fetch("https://worker.test/.well-known/oauth-authorization-server", {
        method: "GET",
        headers: {
          "Origin": "http://localhost:3000"
        }
      });

      expect(response.status).toBe(200);
    });

    it("allows requests without Origin header (same-origin)", async () => {
      const response = await workerExports.default.fetch("https://worker.test/.well-known/oauth-authorization-server", {
        method: "GET"
      });

      expect(response.status).toBe(200);
    });
  });

  describe("OPTIONS Preflight", () => {
    it("handles OPTIONS preflight for well-known endpoints", async () => {
      const response = await workerExports.default.fetch("https://worker.test/.well-known/oauth-authorization-server", {
        method: "OPTIONS",
        headers: { Origin: "http://localhost:3000" }
      });

      // Well-known endpoints may or may not have CORS middleware
      // At minimum should not error
      expect([200, 204, 404]).toContain(response.status);
    });
  });
});

const REDIRECT_URI = "https://client.example/callback";
const STAFF_EMAIL = "george@happyfox-test.com";

/** A GET /staff/ record shaped like the Docs/360 §2 example. */
function staffRecord(overrides: Record<string, unknown> = {}) {
  return {
    name: "George - Admin",
    is_account_admin: false,
    email: STAFF_EMAIL,
    role: { name: "Administrator", id: 1 },
    active: true,
    id: 14,
    categories: [3, 4],
    permissions: ["move_tickets", "manage_assets"],
    ...overrides,
  };
}

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function registerClient(): Promise<string> {
  const helpers = getOAuthApi({
    apiRoute: "/mcp",
    apiHandler: { fetch: async () => new Response(null) },
    defaultHandler: { fetch: async () => new Response(null) },
    authorizeEndpoint: "/authorize",
    tokenEndpoint: "/oauth/token",
    resourceMetadata: { resource: "https://worker.test/mcp" },
  }, env);
  const client = await helpers.createClient({
    redirectUris: [REDIRECT_URI],
    clientName: "Test Client",
    tokenEndpointAuthMethod: "none",
  });
  return client.clientId;
}

interface Consent {
  url: string;
  csrf: string;
  verifier: string;
}

/** GET /authorize with an S256 challenge; returns the consent URL and its CSRF token. */
async function openConsent(clientId: string, scope = "happyfox:read"): Promise<Consent> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const url = `https://worker.test/authorize?${new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope,
    state: "state-1",
  })}`;

  const response = await workerExports.default.fetch(url);
  expect(response.status).toBe(200);
  const csrf = /csrf_token=([^;]+)/.exec(response.headers.get("Set-Cookie") ?? "")?.[1];
  expect(csrf).toBeDefined();
  await response.text();
  return { url, csrf: csrf!, verifier };
}

async function submitConsent(consent: Consent, fields: Record<string, string> = {}): Promise<Response> {
  const form = new URLSearchParams({
    csrf_token: consent.csrf,
    account_name: "testaccount",
    api_key: "test-api-key",
    auth_code: "test-auth-code",
    email: STAFF_EMAIL,
    region: "us",
    ...fields,
  });
  return workerExports.default.fetch(consent.url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: `csrf_token=${consent.csrf}` },
    body: form,
    // The entrypoint fetch follows redirects like a service binding; the 302 to the client is the result.
    redirect: "manual",
  });
}

async function tokenRequest(fields: Record<string, string>): Promise<Response> {
  return workerExports.default.fetch("https://worker.test/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });
}

interface Tokens {
  access_token: string;
  refresh_token: string;
}

/** Complete consent (GET /staff/ answered by `staff`) and exchange the code for tokens. */
async function connect(clientId: string, fields: Record<string, string> = {}, origin = "https://testaccount.happyfox.com"): Promise<Tokens> {
  const consent = await openConsent(clientId);
  fetchMock.get(origin)
    .intercept({ path: "/api/1.1/json/staff/", method: "GET" })
    .reply(200, JSON.stringify([staffRecord()]), { headers: { "Content-Type": "application/json" } });

  const approved = await submitConsent(consent, fields);
  expect(approved.status).toBe(302);
  const code = new URL(approved.headers.get("Location")!).searchParams.get("code")!;

  const exchanged = await tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    client_id: clientId,
    code_verifier: consent.verifier,
  });
  expect(exchanged.status).toBe(200);
  return await exchanged.json() as Tokens;
}

/** The KV credential record id: the grant's userId, the first segment of every token. */
function tokenIdOf(tokens: Tokens): string {
  return tokens.access_token.split(":")[0];
}

async function discover(accessToken: string): Promise<Response> {
  return workerExports.default.fetch("https://worker.test/mcp", {
    method: "POST",
    headers: { ...createMCPHeaders("server/discover"), Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(createRequest("server/discover")),
  });
}

describe("Consent POST", () => {
  let clientId: string;
  const store = new CredentialStore(env.OAUTH_KV, env.CREDENTIAL_ENCRYPTION_KEY);

  beforeAll(async () => {
    clientId = await registerClient();
  });

  beforeEach(() => {
    resetFetchMock();
  });

  it.each(["us/../eu", "../eu/victim/staff#", "EU", "net"])(
    "rejects the region %j with a consent error and no HappyFox call",
    async (region) => {
      const response = await submitConsent(await openConsent(clientId), { region });

      expect(response.status).toBe(400);
      expect(await response.text()).toContain("Choose the US or EU region.");
      expect(sentHappyFoxRequests()).toHaveLength(0);
    }
  );

  it.each(["https://support.example.com", "support.example.com:8443", "support.example.com/api", "user@support.example.com", "10.0.0.1", "api.localhost"])(
    "rejects the custom domain %j with a consent error and no HappyFox call",
    async (apiHost) => {
      const response = await submitConsent(await openConsent(clientId), { api_host: apiHost });

      expect(response.status).toBe(400);
      expect(await response.text()).toContain("Enter the custom domain as a host name only");
      expect(sentHappyFoxRequests()).toHaveLength(0);
    }
  );

  it("sets the CSRF cookie for the whole origin, so /api/validate-staff receives it", async () => {
    const response = await workerExports.default.fetch((await openConsent(clientId)).url);
    await response.text();

    expect(response.headers.get("Set-Cookie")).toContain("; Path=/;");
  });

  it("keeps the CSRF token in a re-rendered form, so the next submit succeeds", async () => {
    const consent = await openConsent(clientId);

    const failed = await submitConsent(consent, { region: "EU" });
    expect(failed.status).toBe(400);
    expect(await failed.text()).toContain(`<input type="hidden" name="csrf_token" value="${consent.csrf}">`);

    mockHappyFoxGet("/staff/", [staffRecord()]);
    expect((await submitConsent(consent)).status).toBe(302);
  });

  it("rejects an agent whose staff record is inactive", async () => {
    const consent = await openConsent(clientId);
    mockHappyFoxGet("/staff/", [staffRecord({ active: false })]);

    const response = await submitConsent(consent);

    expect(response.status).toBe(400);
    expect(await response.text()).toContain(`Staff member ${STAFF_EMAIL} is inactive`);
  });

  it("stores the subdomain account without an apiHost", async () => {
    const tokens = await connect(clientId);

    const stored = await store.retrieve(tokenIdOf(tokens));
    expect(stored).toMatchObject({ accountName: "testaccount", region: "us", staffId: 14, staffEmail: STAFF_EMAIL });
    expect(stored).not.toHaveProperty("apiHost");
  });

  it("validates against and stores a custom domain, normalized to lowercase", async () => {
    const tokens = await connect(clientId, { api_host: " Support.Example.com " }, "https://support.example.com");

    expect((await store.retrieve(tokenIdOf(tokens)))?.apiHost).toBe("support.example.com");
    expect(sentHappyFoxRequests()[0].url.toString()).toBe("https://support.example.com/api/1.1/json/staff/");
  });

  it("serves /mcp with a stored credential that has no apiHost", async () => {
    const tokens = await connect(clientId);
    const response = await discover(tokens.access_token);

    expect(response.status).toBe(200);
  });

  it("answers 401 invalid_token when a stored credential carries a crafted region", async () => {
    const tokens = await connect(clientId);
    const tokenId = tokenIdOf(tokens);
    const stored = (await store.retrieve(tokenId))!;
    await store.store(tokenId, { ...stored, region: "../eu/victim/staff#" as any });

    const response = await discover(tokens.access_token);

    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain('error="invalid_token"');
  });
});

describe("Tokens are bound to the origin's /mcp resource", () => {
  let clientId: string;

  beforeAll(async () => {
    clientId = await registerClient();
  });

  beforeEach(() => {
    resetFetchMock();
  });

  it("refuses an authorization request for another resource without showing consent", async () => {
    const response = await workerExports.default.fetch(`https://worker.test/authorize?${new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
      code_challenge_method: "S256",
      resource: "https://other.example/mcp",
      state: "state-1",
    })}`, { redirect: "manual" });

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("Location")!);
    expect(location.origin + location.pathname).toBe(REDIRECT_URI);
    expect(location.searchParams.get("error")).toBe("invalid_target");
  });

  it("answers 400, not 500, when the client_id is unknown", async () => {
    const response = await workerExports.default.fetch(`https://worker.test/authorize?${new URLSearchParams({
      response_type: "code",
      client_id: "no-such-client",
      redirect_uri: REDIRECT_URI,
      code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
      code_challenge_method: "S256",
    })}`, { redirect: "manual" });

    expect(response.status).toBe(400);
  });

  it("rejects a token presented on another origin", async () => {
    const tokens = await connect(clientId);
    expect((await discover(tokens.access_token)).status).toBe(200);

    const elsewhere = await workerExports.default.fetch("http://localhost:8787/mcp", {
      method: "POST",
      headers: { ...createMCPHeaders("server/discover"), Authorization: `Bearer ${tokens.access_token}` },
      body: JSON.stringify(createRequest("server/discover")),
    });
    expect(elsewhere.status).toBe(401);
  });
});

describe("Token refresh re-checks the consenting agent", () => {
  let clientId: string;
  const store = new CredentialStore(env.OAUTH_KV, env.CREDENTIAL_ENCRYPTION_KEY);

  beforeAll(async () => {
    clientId = await registerClient();
  });

  beforeEach(() => {
    resetFetchMock();
  });

  function refresh(tokens: Tokens): Promise<Response> {
    return tokenRequest({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: clientId });
  }

  it("issues new tokens while the agent is active", async () => {
    const tokens = await connect(clientId);
    mockHappyFoxGet("/staff/", [staffRecord()]);

    const response = await refresh(tokens);

    expect(response.status).toBe(200);
    const refreshed = await response.json() as Tokens;
    expect((await discover(refreshed.access_token)).status).toBe(200);
  });

  it("refuses the refresh with invalid_grant and cuts off live tokens once the agent is deactivated", async () => {
    const tokens = await connect(clientId);
    mockHappyFoxGet("/staff/", [staffRecord({ active: false })]);

    const response = await refresh(tokens);

    expect(response.status).toBe(400);
    const body = await response.json() as { error: string; error_description: string };
    expect(body.error).toBe("invalid_grant");
    expect(body.error_description).toContain("inactive");
    expect(await store.retrieve(tokenIdOf(tokens))).toBeNull();
    expect((await discover(tokens.access_token)).status).toBe(401);
  });

  it("keeps the connection when HappyFox cannot be reached", async () => {
    const tokens = await connect(clientId);
    mockHappyFoxGet("/staff/", { error: "Service Unavailable" }, 503);

    expect((await refresh(tokens)).status).toBe(200);
  });
});

describe("A HappyFox 401 during a request ends the grant", () => {
  let clientId: string;
  const store = new CredentialStore(env.OAUTH_KV, env.CREDENTIAL_ENCRYPTION_KEY);

  beforeAll(async () => {
    clientId = await registerClient();
  });

  beforeEach(() => {
    resetFetchMock();
  });

  it("answers 401 invalid_token, deletes the credentials and revokes the OAuth grant", async () => {
    const tokens = await connect(clientId);
    const tokenId = tokenIdOf(tokens);
    mockHappyFoxGet("/ticket/7/", { error: "Unauthorized" }, 401);
    const params = { name: "happyfox_get_ticket", arguments: { ticket_id: "7" } };

    const response = await workerExports.default.fetch("https://worker.test/mcp", {
      method: "POST",
      headers: { ...createMCPHeaders("tools/call", params), Authorization: `Bearer ${tokens.access_token}` },
      body: JSON.stringify(createRequest("tools/call", params)),
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain('error="invalid_token"');
    expect(await store.retrieve(tokenId)).toBeNull();

    const helpers = getOAuthApi({
      apiRoute: "/mcp",
      apiHandler: { fetch: async () => new Response(null) },
      defaultHandler: { fetch: async () => new Response(null) },
      authorizeEndpoint: "/authorize",
      tokenEndpoint: "/oauth/token",
      resourceMetadata: { resource: "https://worker.test/mcp" },
    }, env);
    expect((await helpers.listUserGrants(tokenId)).items).toEqual([]);

    const refreshed = await tokenRequest({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: clientId });
    expect(refreshed.status).toBe(400);
    expect((await refreshed.json() as { error: string }).error).toBe("invalid_grant");
    expect(sentHappyFoxRequests().map(r => r.apiPath)).toEqual(["/staff/", "/ticket/7/"]);
  });
});

describe("/api/validate-staff", () => {
  const CSRF_HEADERS = { Cookie: "csrf_token=t0k3n", "X-CSRF-Token": "t0k3n" };

  beforeEach(() => {
    resetFetchMock();
  });

  function validate(body: Record<string, unknown>, headers: Record<string, string> = CSRF_HEADERS): Promise<Response> {
    return workerExports.default.fetch("https://worker.test/api/validate-staff", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({
        accountName: "testaccount",
        apiKey: "test-api-key",
        authCode: "test-auth-code",
        email: STAFF_EMAIL,
        ...body,
      }),
    });
  }

  it.each([
    ["no token", {}],
    ["no cookie", { "X-CSRF-Token": "t0k3n" }],
    ["no header", { Cookie: "csrf_token=t0k3n" }],
    ["a mismatched token", { Cookie: "csrf_token=t0k3n", "X-CSRF-Token": "other" }],
    ["a cookie of another name", { Cookie: "xcsrf_token=t0k3n", "X-CSRF-Token": "t0k3n" }]
  ])("answers 403 with %s and calls no host", async (_label, headers) => {
    const response = await validate({ apiHost: "support.example.com" }, headers);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ valid: false, error: "Reload the consent page and try again." });
    expect(fetchMock.requests()).toHaveLength(0);
  });

  it.each(["us/../eu", "../eu/victim/staff#", "EU"])("rejects the region %j", async (region) => {
    const response = await validate({ region });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ valid: false, error: "Invalid region" });
    expect(sentHappyFoxRequests()).toHaveLength(0);
  });

  it("rejects an invalid custom domain", async () => {
    const response = await validate({ apiHost: "https://support.example.com/" });

    expect(response.status).toBe(400);
    expect(sentHappyFoxRequests()).toHaveLength(0);
  });

  it("warns when a requested scope exposes tools the agent's role cannot use", async () => {
    mockHappyFoxGet("/staff/", [staffRecord({ permissions: ["move_tickets"] })]);

    const response = await validate({ scopes: ["happyfox:read", "happyfox:admin"] });
    const body = await response.json() as { valid: boolean; warnings: string[] };

    expect(body.valid).toBe(true);
    expect(body.warnings).toHaveLength(1);
    expect(body.warnings[0]).toContain("Manage Assets");
  });

  it("does not warn when the role has the permissions", async () => {
    mockHappyFoxGet("/staff/", [staffRecord()]);

    const body = await (await validate({ scopes: ["happyfox:admin"] })).json() as { warnings: string[] };

    expect(body.warnings).toEqual([]);
  });

  it("checks the staff list on the custom domain", async () => {
    fetchMock.get("https://support.example.com")
      .intercept({ path: "/api/1.1/json/staff/", method: "GET" })
      .reply(200, JSON.stringify([staffRecord()]), { headers: { "Content-Type": "application/json" } });

    const body = await (await validate({ apiHost: "support.example.com" })).json() as { valid: boolean };

    expect(body.valid).toBe(true);
    expect(sentHappyFoxRequests()[0].url.origin).toBe("https://support.example.com");
  });

  it("does not echo a custom domain's error body", async () => {
    fetchMock.get("https://target.example.org")
      .intercept({ path: "/api/1.1/json/staff/", method: "GET" })
      .reply(400, "upstream page text", { headers: { "Content-Type": "text/plain" } });

    const response = await validate({ apiHost: "target.example.org" });

    expect(await response.json()).toEqual({
      valid: false,
      error: "The custom domain did not answer like a HappyFox account (HTTP 400).",
      warnings: [],
    });
  });

  it("sends exactly one request when the custom domain fails in transport", async () => {
    fetchMock.get("https://target.example.org")
      .intercept({ path: "/api/1.1/json/staff/", method: "GET" })
      .replyWithError(Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" }));

    const response = await validate({ apiHost: "target.example.org" });

    expect((await response.json() as { error: string }).error).toBe("The custom domain could not be reached.");
    expect(fetchMock.requests()).toHaveLength(1);
  });
});
