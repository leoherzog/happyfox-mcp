# AGENTS.md

This file provides guidance to Claude, Codex, Gemini, etc when working with code in this repository.

## Project Overview

HappyFox MCP Adapter - A serverless Cloudflare Worker that implements the Model Context Protocol (MCP) **2026-07-28** Streamable HTTP transport to bridge MCP-compatible clients with the HappyFox REST API.

The transport is **stateless**: there is no `initialize` handshake, no session, and no SSE stream. Every request is self-describing - it carries its own protocol version, method name and client metadata - and `server/discover` replaces version negotiation. Only `2026-07-28` is supported; there is no backwards compatibility with earlier revisions.

## Development Commands

```bash
# Start development server with hot reload
npx wrangler dev --port 8787 --local

# Deploy to Cloudflare Workers
npx wrangler deploy

# Generate TypeScript types for Workers runtime
npx wrangler types

# Run tests
npm run test:run
```

## Architecture

### Request Flow
```
MCP Client → Workers Cache → Cloudflare Worker → OAuth Validation → Header + _meta Validation → MCP Server → Tool/Resource Registry → HappyFox Client → HappyFox API
                                                       ↓                                                                                     ↓
                                               Cloudflare KV                                                                          Reference Cache
                                              (Encrypted Creds)                                                                          (Cache API)
```

### HTTP Routes

| Path | Methods | Description |
|------|---------|-------------|
| `/` | GET, HEAD | Read-only home page explaining the server and how to connect (405 otherwise) |
| `/mcp` | POST, OPTIONS | MCP Streamable HTTP endpoint (Bearer token required). Every other method is 405 |
| `/authorize` | GET, POST | OAuth consent flow |
| `/oauth/token` | POST | OAuth token exchange (handled entirely by the library) |
| `/api/validate-staff` | POST | Real-time email validation for the consent form |
| `/.well-known/oauth-authorization-server` | GET | OAuth server metadata (RFC 8414) |
| `/.well-known/oauth-protected-resource` | GET | Protected resource metadata (RFC 9728) |

### Core Components

- **Transport** (`src/index.ts`, `McpApiHandler`): Validates Origin, HTTP method, headers and `params._meta`, then dispatches to the MCP server. Exported by name so the validation pipeline can be unit-tested directly (the OAuth provider answers 401 before the handler runs, so integration tests cannot reach it)
- **MCP Server** (`src/mcp/server.ts`): Handles JSON-RPC 2.0 protocol, routes MCP methods to appropriate handlers
- **Header Helpers** (`src/mcp/headers.ts`): `decodeMcpHeaderValue()` for the `=?base64?…?=` sentinel used by `Mcp-Name`
- **OAuth challenges** (`McpApiHandler.bearerChallenge` in `src/index.ts`): builds the RFC 6750 `WWW-Authenticate: Bearer` value for the 401 (`invalid_token`) and 403 (`insufficient_scope`) responses
- **Home Page** (`src/views/home.ts`): Static, read-only landing page rendered at `/` (Pico CSS, no data collected)
- **Tool Registry** (`src/mcp/tools/registry.ts`): Manages 30 tools across Tickets, Contacts, and Assets modules
- **Resource Registry** (`src/mcp/resources/registry.ts`): Provides 7 reference data resources with caching
- **HappyFox Client** (`src/happyfox/client.ts`): HTTP client with exponential backoff for rate limiting (429 responses)
- **Reference Cache** (`src/cache/reference-cache.ts`): Uses Cloudflare Cache API to cache reference data (15 min TTL)
- **CORS Middleware** (`src/middleware/cors.ts`): Handles CORS with MCP-specific headers and origin validation

### Authentication

**OAuth 2.0 (RFC 6749):**

The server uses OAuth 2.0 with PKCE for authentication. HappyFox credentials are collected during the OAuth consent flow and stored encrypted in Cloudflare KV.

**OAuth Flow:**
1. Client redirects to `/authorize` with PKCE challenge
2. User enters HappyFox credentials (subdomain, API key, auth code, staff email)
3. Server validates credentials and resolves `staff_id` from email
4. Credentials are encrypted (AES-256-GCM) and stored in KV
5. Authorization code returned to client
6. Client exchanges code for access/refresh tokens at `/oauth/token`
7. Client uses Bearer token for MCP requests to `/mcp`

**Available Scopes:**
| Scope | Permissions |
|-------|-------------|
| `happyfox:read` | Read tickets, contacts, assets, and resources |
| `happyfox:write` | Create/update tickets, add replies, manage contacts |
| `happyfox:admin` | Delete tickets, move categories, delete assets |

**Staff ID Auto-Resolution:**
During OAuth consent, the server resolves the user's `staff_id` by matching their email against the HappyFox staff list. Tools requiring `staff_id` (like `happyfox_add_staff_reply`) will auto-inject this value if not provided.

**Well-Known Endpoints:**
- `/.well-known/oauth-authorization-server` - OAuth server metadata (RFC 8414)
- `/.well-known/oauth-protected-resource` - Protected resource metadata (RFC 9728)
- `/.well-known/oauth-protected-resource/mcp` - Path-suffixed variant (RFC 9728 §3.1); this is the
  URL the 401 `WWW-Authenticate` challenge points clients at

> **These are answered by `@cloudflare/workers-oauth-provider`, not by this codebase.** The
> library intercepts all three paths before it delegates to `defaultHandler`, so there is
> nothing to route for them here. Both the issuer and the resource identifier are derived from
> the request URL.
>
> This project used to serve them from `src/oauth/handlers/metadata.ts`. That module was
> unreachable for the authorization-server path from the start, and the library took over the
> protected-resource path in v0.4.0 (bringing the path-suffixed variant with it), so it was
> deleted along with its `RESOURCE_IDENTIFIER` env override. Only the `Cache-Control` those
> responses used to carry was worth keeping - `edgeCacheControlFor()` in `src/index.ts` now
> applies it, since the library sets none.

**OAuth Provider Configuration (`@cloudflare/workers-oauth-provider` 0.8.x):**

Non-default options set in `src/index.ts`, each for a reason:

| Option | Value | Why |
|--------|-------|-----|
| `clientIdMetadataDocumentEnabled` | `true` | CIMD became opt-in in v0.3.0. Clients here identify by metadata-document URL, so this is required. Needs the `global_fetch_strictly_public` flag. |
| `allowPlainPKCE` | `false` | `handleAuthorize` already rejects anything but S256; this makes the library enforce it too, and drops `plain` from the advertised metadata. |
| `resourceMatchOriginOnly` | `true` | Resource indicators are compared by origin rather than exact string. One origin, one resource here, so it is equivalent in strength while tolerating `https://host/` vs `https://host/mcp`. |
| `refreshTokenTTL` | 90 days | Library default is 30. |

**Remaining library workaround:**

**Scopes Not Passed to Handler**: The library only passes `ctx.props` to the API handler, not
`ctx.scopes`. Fix: include scopes in `OAuthProps` during authorization and read from
`props.scopes` in the handler (see the `OAuthProps` interface and `buildAuthContext`). Still
required as of 0.8.3.

> The old **trailing slash** workaround is gone. v0.4.0 made audience checks parse the URI and
> treat a bare `/` path as covering the origin, so the `resource` parameter is now passed
> through to `completeAuthorization()` untouched and the `/oauth/token` rewriting wrapper has
> been deleted. Tokens are properly audience-bound again.

### Transport Design

Why this Worker can be fully stateless, and why it has no Durable Objects:

- **Streamable HTTP is a single endpoint.** The response to a client→server message is returned on
  the same POST, so a stateless Worker can handle a request end-to-end without routing responses
  across instances. Workers *can* stream from a POST response via the Streams API - SSE was never
  blocked by the platform - but this server does no server-initiated work and always answers with
  plain `application/json`.
- **No server-initiated work means no coordinator.** There are no subscriptions, no progress
  notifications and no `listChanged` notifications, so there is nothing to push and nothing to keep
  a stream open for. Durable Objects would only become necessary if server-initiated messages or
  long-lived streams were added.
- **Origin validation is a MUST.** If an `Origin` header is present and not allow-listed, the server
  MUST respond 403 (DNS-rebinding defense). Implemented in `src/middleware/cors.ts`; an *absent*
  `Origin` is allowed, since every non-browser client omits it.

### Caching

Two independent layers:

**1. Workers Cache (edge, in front of the Worker)**

Enabled in `wrangler.jsonc`:

```jsonc
"cache": { "enabled": true }
```

On a cache hit Cloudflare serves the response without invoking the Worker at all. Caching is
**opt-in per response**: `withCacheDefaults()` in `src/index.ts` stamps `Cache-Control: no-store`
on every response that does not set its own, so only these are cacheable:

| Response | Cache-Control |
|----------|---------------|
| `GET /` home page | `public, max-age=3600, stale-while-revalidate=86400` (set by the route) |
| `GET /.well-known/oauth-*` metadata | `public, max-age=3600` (set by `edgeCacheControlFor`, since the OAuth library sets none) |
| Everything else (MCP, consent, OAuth, errors) | `no-store` |

The discovery documents are allow-listed by path in `edgeCacheControlFor()` and only when the
response is a successful GET/HEAD. When adding a route, set `Cache-Control` explicitly only if
the response is identical for every user. `cross_version_cache` is intentionally left off, so
each deployment starts with a cold cache.

**2. Reference Cache (Cache API, inside the Worker)**

`src/cache/reference-cache.ts` caches HappyFox reference data (categories, statuses, staff, …) for
15 minutes, keyed by region + account name.

### Rate Limiting Strategy

Exponential backoff implementation in `HappyFoxClient`:
- Base delay: 1 second
- Max delay: 60 seconds
- Max retries: 5
- Jitter added to prevent thundering herd
- Handles both 429 (rate limit) and network errors

## HappyFox API Integration

### Endpoint Format
- US Region: `https://{accountName}.happyfox.com/api/1.1/json`
- EU Region: `https://{accountName}.happyfox.net/api/1.1/json`

### Authentication
Basic HTTP authentication with base64 encoded `{apiKey}:{authCode}`

### Custom Fields
- Ticket custom fields: `t-cf-{id}`
- Contact custom fields: `c-cf-{id}`

## MCP Protocol Implementation (2026-07-28)

### Protocol Version

- **Supported version**: `2026-07-28` only. `SUPPORTED_PROTOCOL_VERSIONS` in `src/types/index.ts`
  is a one-element list and is what `server/discover` reports.
- **No handshake**: there is no `initialize`, no `notifications/initialized`, and no session.
  `server/discover` replaces negotiation - clients MAY call it before anything else to learn the
  supported versions, capabilities and server identity.
- **No backwards compatibility**: a request naming any other revision is rejected with HTTP 400 and
  JSON-RPC error `-32022` (`UnsupportedProtocolVersion`), whose `data` names what is supported.

### HTTP Methods

| Method | Behavior |
|--------|----------|
| POST | Process one MCP message. 200 with a JSON-RPC response, or 202 for a notification |
| OPTIONS | 204 preflight response |
| GET, DELETE, PUT, PATCH, HEAD, … | **405 Method Not Allowed** with `Allow: POST, OPTIONS` |

Reaching the 405 requires a valid Bearer token - `@cloudflare/workers-oauth-provider` answers 401
for unauthenticated requests before `McpApiHandler` runs. Both statuses are conformant, so
integration tests that go through the Worker's default export assert `[401, 405]`, while tests that
drive `McpApiHandler` directly (with a fake `ctx.props`) assert exactly 405.

### Required Headers (all requests)

There is no "post-initialize" phase; **every** POST is validated the same way.

| Header | Required for | Validation |
|--------|--------------|------------|
| `MCP-Protocol-Version` | All requests | Must be present, must equal `params._meta["io.modelcontextprotocol/protocolVersion"]`, and must equal `2026-07-28` |
| `Mcp-Method` | All requests | Must be present and exactly equal `method` in the body |
| `Mcp-Name` | `tools/call`, `resources/read` | Must be present and equal `params.name` / `params.uri` respectively, **after** sentinel decoding |
| `Accept` | All requests | Must include both `application/json` and `text/event-stream` (or `*/*`) |
| `Content-Type` | All requests | Must include `application/json` |
| `Authorization` | All requests | `Bearer <access-token>` (enforced by the OAuth provider, not by this code) |

Header **names** are case-insensitive (`Headers.get` handles that). Header **values** are
case-sensitive and compared with `===` - `Mcp-Method: TOOLS/LIST` for body method `tools/list` is a
mismatch, not a match.

**`Mcp-Name` sentinel encoding.** A client MAY send a header value that contains non-ASCII
characters, control characters or leading/trailing whitespace as `=?base64?{StandardBase64}?=`, and
MUST do so for any plain value that happens to look like the sentinel. `decodeMcpHeaderValue()` in
`src/mcp/headers.ts` decodes it before comparison: the markers are **lowercase and case-sensitive**,
the payload uses the **standard** base64 alphabet (`+` and `/`, padded), and the decoded bytes are
run through `TextDecoder` because `atob` alone yields a binary string and would mis-compare
non-ASCII names. An undecodable payload is a header validation failure (`-32020`). This server's own
names (`happyfox_*`, `happyfox://*`) are plain ASCII, so the encoded form is never *required* - but
the decode path exists because a conforming client may still use it.

> **`Mcp-Session-Id` and `Last-Event-ID` are ignored.** They are never read, never minted and never
> echoed. Sending them is not an error - the request is processed as if they were absent, and no
> session header appears on any response. `Mcp-Param-*` headers are likewise ignored: this server
> annotates no tool parameters, so there is nothing to validate them against.

### Validation Order

Every step short-circuits. CORS headers are attached from step 2 onward except on the 500 and the
403. **Every 400 carries a JSON-RPC error body** - dual-era clients probe for exactly that to decide
whether a server is modern. The `id` member is present only when it was read as a string or number;
otherwise it is **omitted entirely**, never sent as `null`.

| # | Check | On failure |
|---|-------|------------|
| 1 | `CREDENTIAL_ENCRYPTION_KEY` is valid 32-byte base64 | 500, `-32603`, no `id`, no CORS headers |
| 2 | `Origin` absent, or present and allow-listed | 403 `Forbidden: Invalid Origin` (plain text) |
| 3 | `OPTIONS` | returns the 204 preflight |
| 4 | `request.method === 'POST'` | 405, `Allow: POST, OPTIONS` (plain text) |
| 5 | Body parses as JSON | 400, `-32700`, no `id` |
| 6 | Body is not an array (no batching) | 400, `-32600`, no `id` |
| 7 | Body is a non-null object | 400, `-32600`, no `id` |
| 8 | `jsonrpc === "2.0"` | 400, `-32600` |
| 9 | `method` is a non-empty string | 400, `-32600` |
| 10 | `"id" in body` - otherwise it is a notification | **202 Accepted**, empty body. No header validation runs, no work is done |
| 11 | `id` is a string or a number (`null` is invalid) | 400, `-32600`, no `id` |
| 12 | `Accept` includes `application/json` and `text/event-stream` | 400, `-32600` |
| 13 | `Content-Type` includes `application/json` | 400, `-32600` |
| 14 | `Mcp-Method` header present | 400, `-32020` |
| 15 | `Mcp-Method === body.method` | 400, `-32020` |
| 16 | `MCP-Protocol-Version` header present | 400, `-32020` |
| 17 | `params` and `params._meta` are objects, and `_meta` protocolVersion is a string | 400, `-32602` |
| 18 | header protocol version equals the `_meta` one | 400, `-32020` |
| 19 | version equals `2026-07-28` | 400, `-32022` + `data: { supported, requested }` |
| 20 | `_meta` clientCapabilities is an object (**clientInfo is NOT required**) | 400, `-32602` |
| 21 | `Mcp-Name` present on `tools/call` / `resources/read` | 400, `-32020` |
| 22 | `Mcp-Name` sentinel decodes | 400, `-32020` |
| 23 | `params.name` / `params.uri` is a non-empty string | 400, `-32602` (a malformed `CallToolRequest` / `ReadResourceRequest`, not a header mismatch) |
| 24 | decoded `Mcp-Name` equals that body value | 400, `-32020` |
| 25 | `method` is in the supported set | **404**, `-32601` |
| 26 | Stored credentials retrievable for the token | 401, code `401`, `WWW-Authenticate: Bearer error="invalid_token", resource_metadata=…` |
| 27 | Dispatch to `MCPServer.handleRequest` | **200** with the JSON-RPC response - unless it throws `InsufficientScopeError`: **403**, code `403`, `data.requiredScopes`, `WWW-Authenticate: Bearer error="insufficient_scope", scope="…", resource_metadata=…` |

Two deliberate orderings: header presence and consistency (14-16) are checked **before** version
support (19), so a client on the wrong revision receives the actionable `-32022` rather than an
opaque `-32020`; and `Mcp-Name` (21-24) is checked **after** 19 for the same reason.

Everything *returned* by step 27 is HTTP **200**, including application-level `-32602` (unknown tool,
unknown resource, bad cursor). That is what produces the 400-vs-200 split for `-32602` described in
the error table below.

### Scope Failures Are HTTP 403, Not JSON-RPC Results

The authorization spec ("Runtime Insufficient Scope Errors") says a request whose token lacks the
scope for the operation SHOULD get **HTTP 403** with a `WWW-Authenticate: Bearer` challenge carrying
`error="insufficient_scope"`, `scope="<what the operation needs>"` and `resource_metadata`, so the
client can step up its authorization. Both scope checks in this server follow that:

- `tools/call` on a tool the token's scopes do not cover (`ToolRegistry.callToolWithAuth`)
- `resources/read` without `happyfox:read` (`MCPServer.handleResourceRead`)

They throw `InsufficientScopeError` (`src/types/index.ts`), which is the **only** thing
`MCPServer.handleRequest` lets escape. The transport catches it and builds the 403. The JSON-RPC body
uses the application-defined code `403` (`INSUFFICIENT_SCOPE`) with `data.requiredScopes`; the code
sits outside the JSON-RPC reserved range as the spec asks for codes it does not define, and mirrors
the HTTP status so body and status can never disagree. Do **not** report a scope failure as an
`isError` tool result, as `-32602`, or as `-32600` - none of those tell the client which scope to ask for.

`resource_metadata` names the path-suffixed document (`/.well-known/oauth-protected-resource/mcp`),
the same one `@cloudflare/workers-oauth-provider` names on its own 401s. The same helper
(`McpApiHandler.bearerChallenge`) builds the `invalid_token` challenge for step 26. Because
`WWW-Authenticate` is not CORS-safelisted, `src/middleware/cors.ts` exposes it - it is the only
header in `Access-Control-Expose-Headers`, since this server sets no `MCP-*` response headers.

### Supported Methods

| Method | Notes |
|--------|-------|
| `server/discover` | **Mandatory** in this revision. Requires no OAuth scope |
| `tools/list` | Filtered by the caller's granted scopes; sorted by name; paginated |
| `tools/call` | Requires `Mcp-Name` matching `params.name`. A tool outside the token's scopes is HTTP 403 + challenge |
| `resources/list` | Paginated. Filtered by the caller's granted scopes: without `happyfox:read` the list is empty, never an error |
| `resources/read` | Requires `Mcp-Name` matching `params.uri`. Without `happyfox:read` it is HTTP 403 + challenge |

Anything else - `initialize`, `notifications/initialized`, `completion/complete`, `prompts/list`,
`resources/templates/list`, `subscriptions/listen`, `ping`, `logging/setLevel`, `tasks/*` - is
**404 Not Found** with `-32601`. The error message names `2026-07-28` and the supported methods, so
a legacy client that POSTs `initialize` gets a diagnostic it can surface to its user.

`MCPServer` keeps its own `default:` arm throwing `-32601`. It is unreachable over HTTP (the
transport 404s first) and exists as defense in depth for direct callers.

### Message Format (No Batch Support)
- **Single messages only**: the POST body must be one JSON-RPC request or notification
- **Batch rejection**: array payloads return HTTP 400 with `-32600`

### Request Metadata (`params._meta`)

`params` is now **structurally required on every request**, including `server/discover` and
`tools/list`, which have no other parameters. So is `params._meta`. A body missing either is
malformed and is rejected with `-32602` at HTTP 400.

| Key | Type | Required | Notes |
|-----|------|----------|-------|
| `io.modelcontextprotocol/protocolVersion` | `string` | **Yes** | Must equal the `MCP-Protocol-Version` header |
| `io.modelcontextprotocol/clientCapabilities` | object | **Yes** | Usually `{}`. This server requires no client capability, so it never emits `-32021` |
| `io.modelcontextprotocol/clientInfo` | `{ name, version }` | No | Absence is legal and must be tolerated. Self-reported and never used for security decisions |

A minimal valid `params`:

```json
{ "_meta": {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientCapabilities": {} } }
```

### Result Fields

Every **result** (never an error response) carries `resultType` and a server identity in `_meta`.
Results that are cacheable additionally carry `ttlMs` (milliseconds) and `cacheScope`.

| Field | Where | Value here |
|-------|-------|------------|
| `resultType` | Every result | Always the literal `"complete"` - including on `isError: true` tool results, which are successful JSON-RPC results |
| `_meta["io.modelcontextprotocol/serverInfo"]` | Every result | `{ name: "happyfox-mcp", version: <package.json version> }` |
| `ttlMs` / `cacheScope` | `server/discover` | `3600000` / `"public"` - identical bytes for every caller |
| `ttlMs` / `cacheScope` | `tools/list`, `resources/list`, `resources/read` | `900000` / `"private"` - scope-filtered or per-HappyFox-account, so caches must not be shared across authorization contexts |
| `ttlMs` / `cacheScope` | `tools/call` | **Absent.** `CallToolResult` is not cacheable; adding them would be as wrong as omitting them elsewhere |

`cacheScope` is `"private"` on everything but `server/discover` because `tools/list` is filtered by
the caller's OAuth scopes and resources are per-HappyFox-account. Note the unit trap: `ReferenceCache`
stores its TTL in **seconds** (`900`); the protocol wants **milliseconds**, so the constants
`CACHE_TTL_MS_DISCOVER` / `CACHE_TTL_MS_STANDARD` in `src/types/index.ts` are the only source used.

`server/discover` declares exactly `capabilities: { tools: {}, resources: {} }` - bare empty objects.
`listChanged` and `subscribe` are deliberately **not** declared: this server implements no
`subscriptions/listen` stream, which is the only place those notifications could be delivered in
this revision, so advertising them would be a promise it cannot keep. `completions`, `prompts` and
`logging` are not declared either.

### Response Behavior
- **Requests (with id)**: JSON-RPC response with `result` or `error`, HTTP 200 (or one of the
  transport statuses above)
- **Notifications (no id)**: HTTP 202 Accepted, no body, no header validation, no work performed.
  This revision defines no client-to-server notifications over Streamable HTTP
- **Tool execution errors** (HappyFox API failures, bad input): `isError: true` in the result, with
  `_meta.statusCode` and `_meta.errorCode` merged alongside `serverInfo`. Unprefixed `_meta` key
  names are legal - the prefix segment is optional
- **Scope failures**: never a result and never a `-326xx` error - HTTP 403 with a
  `WWW-Authenticate` challenge (see above)
- **Protocol errors**: JSON-RPC `error`, which carries neither `resultType` nor `_meta`

### Error Codes

| Scenario | HTTP Status | JSON-RPC Error |
|----------|-------------|----------------|
| Invalid Origin | 403 | N/A (plain text) |
| Non-POST method on `/mcp` | 405 | N/A (plain text, `Allow: POST, OPTIONS`) |
| Server misconfigured (`CREDENTIAL_ENCRYPTION_KEY`) | 500 | -32603 |
| Credential retrieval failed (re-authorization needed) | 401 + `WWW-Authenticate` `invalid_token` | 401 (application-defined) |
| Token lacks the scope for the tool / resource | **403** + `WWW-Authenticate` `insufficient_scope`, `scope=…` | 403 (application-defined) with `data.requiredScopes` |
| Invalid JSON | 400 | -32700 |
| Batch request, bad envelope, `id: null`, bad `Accept`/`Content-Type` | 400 | -32600 |
| Unknown method | **404** | -32601 |
| Missing/malformed `params`, `_meta`, protocolVersion, clientCapabilities; `Mcp-Name` present but `params.name` / `params.uri` absent | **400** | -32602 |
| Unknown tool, unknown resource (with `data.uri`), invalid cursor | **200** | -32602 |
| Missing or mismatched `MCP-Protocol-Version` / `Mcp-Method` / `Mcp-Name`, undecodable sentinel | 400 | -32020 |
| Unsupported protocol version | 400 | -32022 with `data: { supported, requested }` |

Note the two different obligations attached to `-32602`: a request that is **malformed** at the
protocol layer must be 400, while an application-level "not found" is a normal outcome and is
returned inside a 200.

Error-code allocation rules for anything added later: `-32020` to `-32099` is reserved for the MCP
specification, so implementation-defined codes must not be drawn from it; `-32000` to `-32019` is
the legacy sub-range and new implementations should not use it at all. `-32002` (resource not found,
superseded by `-32602`) and `-32042` (URL elicitation required) MUST NOT be emitted. This codebase
emits only `-32700`, `-32600`, `-32601`, `-32602`, `-32603`, `-32020` and `-32022` from the reserved
range, plus the application-defined `401` and `403` that accompany the OAuth challenges.

### Pagination
- `tools/list` and `resources/list` support cursor-based pagination (50 items per page)
- Pass `cursor` param to get next page; the cursor is a non-negative integer start index
- `cacheScope` is identical across every page of one list; `ttlMs` may differ per page
- `tools/list` sorts by tool name (plain byte comparison, not `localeCompare`) before paginating, so
  the order is deterministic across requests and clients can cache the list reliably

### Available Tool Categories
- **Tickets** (14): create_ticket, create_tickets_bulk, list_tickets, get_ticket, update_ticket_tags, update_ticket_custom_fields, move_ticket_category, add_staff_reply, add_private_note, add_contact_reply, forward_ticket, subscribe_to_ticket, unsubscribe_from_ticket, delete_ticket
- **Contacts & groups** (9): create_contact, list_contacts, get_contact, update_contact, get_contact_group, create_contact_group, update_contact_group, add_contacts_to_group, remove_contacts_from_group
- **Assets** (7): list_assets, get_asset, create_asset, update_asset, delete_asset, list_asset_custom_fields, get_asset_custom_field

### Resources vs Tools Design

This server follows MCP best practices for choosing between Resources and Tools:

| Type | Control | Use When |
|------|---------|----------|
| **Resources** | Application/user-controlled | Static reference data, no query parameters |
| **Tools** | Model-controlled | Dynamic data with filtering/pagination, or actions |

**Design pattern applied:**
- HappyFox endpoints with **no query parameters** → Exposed as **Resources** (cached 15 min)
- HappyFox endpoints with **filtering/pagination** → Exposed as **Tools**
- All **write operations** (create, update, delete) → Exposed as **Tools**

| HappyFox Endpoint | API Params | MCP Type | Rationale |
|-------------------|------------|----------|-----------|
| `GET /categories/` | None | Resource | Static reference data |
| `GET /statuses/` | None | Resource | Static reference data |
| `GET /staff/` | None | Resource | Static reference data |
| `GET /contact_groups/` | None | Resource | Static reference data |
| `GET /asset_types/` | None | Resource | Static reference data |
| `GET /ticket_custom_fields/` | None | Resource | Static reference data |
| `GET /user_custom_fields/` | None | Resource | Static reference data |
| `GET /users/` | `q`, `page`, `size` | Tool | Supports search/pagination |
| `GET /assets/` | `asset_type`, `page`, `size` | Tool | Supports filtering |
| `GET /tickets/` | `q`, `status`, `category`, `page`, `size` | Tool | Supports search/filtering |

### Available Resources

| URI | Description | HappyFox Endpoint |
|-----|-------------|-------------------|
| `happyfox://categories` | Ticket categories | `GET /categories/` |
| `happyfox://statuses` | Ticket statuses | `GET /statuses/` |
| `happyfox://staff` | Staff/agents list | `GET /staff/` |
| `happyfox://contact-groups` | Contact groups | `GET /contact_groups/` |
| `happyfox://asset-types` | Asset type definitions | `GET /asset_types/` |
| `happyfox://ticket-custom-fields` | Ticket custom field metadata | `GET /ticket_custom_fields/` |
| `happyfox://contact-custom-fields` | Contact custom field metadata | `GET /user_custom_fields/` |

### Staff ID Requirements
The following tools require a `staff_id` parameter (HappyFox API requirement):
- `happyfox_add_staff_reply` - Staff ID making the reply
- `happyfox_add_private_note` - Staff ID making the note
- `happyfox_forward_ticket` - Staff ID forwarding the ticket
- `happyfox_delete_ticket` - Staff ID performing the deletion
- `happyfox_move_ticket_category` - Staff ID performing the move
- `happyfox_update_ticket_tags` - Staff ID performing the update
- `happyfox_subscribe_to_ticket` - Staff ID to subscribe
- `happyfox_unsubscribe_from_ticket` - Staff ID to unsubscribe
- `happyfox_create_asset` - Staff ID (as `created_by`)
- `happyfox_update_asset` - Staff ID (as `updated_by`)
- `happyfox_delete_asset` - Staff ID (as `deleted_by`)

**Auto-Injection**: With OAuth authentication, the `staff_id` is automatically resolved during the consent flow (by matching the user's email to the HappyFox staff list). If not provided in tool arguments, the OAuth user's `staff_id` is automatically injected. Users can still explicitly provide a different `staff_id` to act on behalf of another staff member.

### Attachment Support
File attachments are **not supported**. The HappyFox API requires multipart/form-data for attachments, which is not implemented. Attachment parameters have been removed from tool schemas.

### Resource URIs
All resources follow the pattern `happyfox://{resource-name}` and return JSON data from corresponding HappyFox endpoints. Resources are cached for 15 minutes.

## TypeScript Configuration

The project uses Cloudflare Workers' built-in TypeScript support - no build step required. Wrangler compiles TypeScript on-the-fly during development and deployment.

## Toolchain Notes

- **`compatibility_date`**: `2026-07-30`, matching the `workerd` bundled with Wrangler 4.118.
  Bump it together with Wrangler so local dev runs the same runtime as production, and rerun
  `npx wrangler types` afterwards.
- **`@cloudflare/workers-types` vs generated types**: `tsconfig.json` uses the published
  `@cloudflare/workers-types` package; `worker-configuration.d.ts` is generated by
  `wrangler types` and embeds a full copy of the runtime types. Do **not** load both in one
  program - they collide. Wrangler now recommends the generated file; switching is a separate
  change.

## Testing Notes (Vitest 4 / vitest-pool-workers 0.20)

The pool was rearchitected in 0.13; three things differ from older examples found online:

- **Config is a Vite plugin.** `vitest.config.mts` uses `cloudflareTest({...})` from
  `@cloudflare/vitest-pool-workers` inside `plugins`, not `defineWorkersConfig`. The file must be
  `.mts` - the package is ESM-only and the project has no `"type": "module"`.
- **`cloudflare:test` is gone.** Use `import { env, exports } from "cloudflare:workers"`;
  `SELF.fetch(...)` is now `exports.default.fetch(...)`.
- **`fetchMock` was removed.** `test/helpers/fetch-mock.ts` is a local shim over
  `globalThis.fetch` that keeps the slice of undici's MockAgent API the suite uses
  (`get(origin).intercept({path, method}).reply(...)` / `.replyWithError(...)`,
  `assertNoPendingInterceptors()`). It also fills in response reason phrases, which the
  `Response` constructor leaves blank but undici set.
- **Unhandled rejections now fail the run.** When a promise is expected to reject while fake
  timers advance, attach the assertion *before* advancing (see the retry tests in
  `test/unit/happyfox/client.test.ts`).
- Storage isolation is per test file; `isolatedStorage` no longer exists.
- Tests are not covered by `npm run typecheck` (it is `src` only). Check them with
  `npx tsc --noEmit -p test/tsconfig.json`.

## Environment Variables

Set in `wrangler.jsonc` or Cloudflare Dashboard:
- `ALLOWED_ORIGINS` - (Optional) Comma-separated list of allowed CORS origins. Defaults to
  `http://localhost:*` and `https://localhost:*`

**KV Namespace Binding:**
- `OAUTH_KV` - Cloudflare KV namespace for encrypted credential storage

Configure via Cloudflare Dashboard (recommended) or wrangler.jsonc:

**Dashboard Setup:**
1. Create the namespace: `wrangler kv namespace create OAUTH_KV`
2. Go to **Workers & Pages** > **your worker** > **Settings** > **Bindings**
3. Click **Add** under **KV Namespace Bindings**
4. Set variable name to `OAUTH_KV` and select the created namespace

**Required Secrets** (set via `wrangler secret put`):
- `CREDENTIAL_ENCRYPTION_KEY` - AES-256-GCM key for encrypting stored credentials
  - **Format**: 32 bytes, base64 encoded
  - **Generation**: Use `openssl rand -base64 32` to generate
  - **Failure mode**: every request to `/mcp` returns HTTP 500 with error -32603 if it is missing
    or does not decode to exactly 32 bytes

This is the only secret. There are no others.

> **Migration note (2026-07-28):** `MCP_SESSION_SECRET` no longer exists. It signed the session
> tokens of the superseded 2025-11-25 transport, which this server no longer implements, and
> nothing reads it. Deleting it from `wrangler.jsonc` does **not** remove it from a deployed
> Worker - **delete it by hand** in the Cloudflare dashboard (Workers & Pages → your worker →
> Settings → Variables and Secrets), or with `npx wrangler secret delete MCP_SESSION_SECRET`.

## Testing MCP Endpoints (MCP 2026-07-28)

Every call is independent - there is no ordering requirement and no state carried between them.
Obtain a Bearer token by completing the OAuth consent flow at `/authorize`, then:

```bash
TOKEN=<access-token>
HOST=http://localhost:8787
```

```bash
# server/discover - mandatory in this revision; requires no scope
curl -X POST "$HOST/mcp" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "MCP-Protocol-Version: 2026-07-28" \
  -H "Mcp-Method: server/discover" \
  -d '{"jsonrpc":"2.0","id":1,"method":"server/discover","params":{"_meta":{
        "io.modelcontextprotocol/protocolVersion":"2026-07-28",
        "io.modelcontextprotocol/clientInfo":{"name":"curl","version":"8"},
        "io.modelcontextprotocol/clientCapabilities":{}}}}'
```

```bash
# tools/list - filtered by the token's OAuth scopes, sorted by name, 50 per page
curl -X POST "$HOST/mcp" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "MCP-Protocol-Version: 2026-07-28" \
  -H "Mcp-Method: tools/list" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{"cursor":"0","_meta":{
        "io.modelcontextprotocol/protocolVersion":"2026-07-28",
        "io.modelcontextprotocol/clientCapabilities":{}}}}'
```

```bash
# tools/call - Mcp-Name MUST equal params.name. Requires happyfox:read for this tool
curl -X POST "$HOST/mcp" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "MCP-Protocol-Version: 2026-07-28" \
  -H "Mcp-Method: tools/call" \
  -H "Mcp-Name: happyfox_list_tickets" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{
        "name":"happyfox_list_tickets","arguments":{},"_meta":{
        "io.modelcontextprotocol/protocolVersion":"2026-07-28",
        "io.modelcontextprotocol/clientCapabilities":{}}}}'

# A write example (requires happyfox:write). staff_id is auto-injected from the OAuth
# context when omitted:
#   -H "Mcp-Name: happyfox_add_staff_reply"
#   "name":"happyfox_add_staff_reply","arguments":{"ticket_id":"123","text":"Reply message"}
```

```bash
# resources/list - returns only what the caller's scopes permit (empty without happyfox:read)
curl -X POST "$HOST/mcp" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "MCP-Protocol-Version: 2026-07-28" \
  -H "Mcp-Method: resources/list" \
  -d '{"jsonrpc":"2.0","id":4,"method":"resources/list","params":{"_meta":{
        "io.modelcontextprotocol/protocolVersion":"2026-07-28",
        "io.modelcontextprotocol/clientCapabilities":{}}}}'
```

```bash
# resources/read - Mcp-Name MUST equal params.uri. Requires happyfox:read
curl -X POST "$HOST/mcp" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "MCP-Protocol-Version: 2026-07-28" \
  -H "Mcp-Method: resources/read" \
  -H "Mcp-Name: happyfox://categories" \
  -d '{"jsonrpc":"2.0","id":5,"method":"resources/read","params":{
        "uri":"happyfox://categories","_meta":{
        "io.modelcontextprotocol/protocolVersion":"2026-07-28",
        "io.modelcontextprotocol/clientCapabilities":{}}}}'
```

A conforming client MAY send `Mcp-Name` sentinel-encoded instead; the server decodes it before
comparing, so this is equivalent to the plain form above:

```bash
  -H "Mcp-Name: =?base64?aGFwcHlmb3g6Ly9jYXRlZ29yaWVz?="
```

Useful negative checks: dropping `Mcp-Method` gives 400 `-32020`; naming an older revision in both
the header and `_meta` gives 400 `-32022`; `initialize` gives **404** `-32601`; `GET`/`DELETE` on
`/mcp` gives 405 with a valid token (401 without one); calling `happyfox_delete_ticket` with a token
that lacks `happyfox:admin` gives **403** with
`WWW-Authenticate: Bearer realm="OAuth", resource_metadata="…/.well-known/oauth-protected-resource/mcp", error="insufficient_scope", error_description="…", scope="happyfox:admin"`.

## Project Structure

```
src/
├── index.ts                    # Worker entry point: OAuth provider + McpApiHandler validation pipeline
├── types/
│   └── index.ts               # Protocol constants, error codes, _meta keys, result/envelope types
├── views/
│   └── home.ts                # Read-only home page served at /
├── oauth/
│   ├── types.ts               # OAuth type definitions (scopes, credentials)
│   ├── services/
│   │   ├── credential-store.ts    # AES-256-GCM encrypted credential storage
│   │   ├── happyfox-validator.ts  # Credential validation & staff ID resolution
│   │   └── scope-enforcer.ts      # Tool-to-scope mapping and enforcement
│   └── views/
│       └── consent.ts         # OAuth consent page HTML (Pico CSS)
├── cache/
│   └── reference-cache.ts     # Cache API wrapper for reference data
├── mcp/
│   ├── server.ts              # MCP protocol handler (server/discover, tools/*, resources/*)
│   ├── headers.ts             # Mcp-Name =?base64?…?= sentinel decoding
│   ├── tools/
│   │   ├── registry.ts        # Tool registration with scope enforcement
│   │   ├── tickets.ts         # Ticket tools
│   │   ├── contacts.ts        # Contact tools
│   │   └── assets.ts          # Asset tools
│   └── resources/
│       └── registry.ts        # Resource registration and reading
├── happyfox/
│   ├── client.ts              # HTTP client with retry logic
│   └── endpoints/
│       ├── tickets.ts         # Ticket API methods
│       ├── contacts.ts        # Contact API methods
│       └── assets.ts          # Asset API methods
└── middleware/
    └── cors.ts                # CORS handling with MCP headers and Origin validation

test/
├── unit/
│   ├── transport/
│   │   └── mcp-handler.test.ts  # Header/_meta validation pipeline (drives McpApiHandler directly)
│   ├── mcp/
│   │   ├── server.test.ts       # Protocol handlers, result shapes, cache hints
│   │   ├── headers.test.ts      # Sentinel decoding
│   │   ├── tools/registry.test.ts
│   │   └── resources/registry.test.ts
│   ├── views/
│   │   └── home.test.ts         # Home page rendering tests
│   ├── middleware/
│   │   └── cors.test.ts         # CORS middleware tests
│   ├── cache/, happyfox/, oauth/
│   └── types/
│       └── errors.test.ts       # Error handling tests
├── integration/
│   └── worker.test.ts           # OAuth endpoint and unauthenticated /mcp behavior
└── helpers/
    ├── json-rpc.ts              # 2026-07-28 request/header builders (no session helper, ever)
    ├── client-mock.ts           # HappyFoxClient stub
    ├── fetch-mock.ts            # globalThis.fetch mock (replaces cloudflare:test fetchMock)
    └── fetch-mock-helpers.ts    # HappyFox API mocking utilities
```
