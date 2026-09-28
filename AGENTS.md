# AGENTS.md

This file provides guidance to Claude, Codex, Gemini, etc when working with code in this repository.

## Project Overview

HappyFox MCP Adapter - A serverless Cloudflare Worker that implements the Model Context Protocol (MCP) **2026-07-28** Streamable HTTP transport to bridge MCP-compatible clients with the HappyFox REST API.

The transport is **stateless**: there is no `initialize` handshake, no session, and no SSE stream. Every request is self-describing - it carries its own protocol version, method name and client metadata - and `server/discover` replaces version negotiation. Only `2026-07-28` is supported; there is no backwards compatibility with earlier revisions.

## Development Commands

```bash
npx wrangler dev --port 8787 --local   # dev server with hot reload
npx wrangler deploy                    # deploy to Cloudflare Workers
npx wrangler types                     # regenerate Workers runtime types
npm run test:run                       # also: test:unit, test:integration, test:watch, test:coverage
npm run typecheck                      # src only - tests need their own tsconfig (see Testing Notes)
```

`wrangler.jsonc` declares no `env` blocks, so there is one deployment target: `wrangler deploy --env <name>` does not resolve.

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
| `/` | GET, HEAD | Read-only home page explaining the server and how to connect (405 with `Allow: GET, HEAD` otherwise) |
| `/mcp` | POST, OPTIONS | MCP Streamable HTTP endpoint (Bearer token required). Every other method is 405 |
| `/authorize` | GET, POST | OAuth consent flow (405 otherwise) |
| `/oauth/token` | POST | OAuth token exchange (handled entirely by the library) |
| `/api/validate-staff` | POST | Real-time email validation for the consent form; any other method falls through to 404 |
| `/.well-known/oauth-authorization-server` | GET | OAuth server metadata (RFC 8414) |
| `/.well-known/oauth-protected-resource`, `/.well-known/oauth-protected-resource/mcp` | GET | Protected resource metadata (RFC 9728, and the path-suffixed variant of §3.1 that the 401 challenge points at) |

### Core Components

- **Transport** (`src/index.ts`, `McpApiHandler`): Validates Origin, HTTP method, headers and `params._meta`, then dispatches to the MCP server. Exported by name so the validation pipeline can be unit-tested directly (the OAuth provider answers 401 before the handler runs, so integration tests cannot reach it)
- **MCP Server** (`src/mcp/server.ts`): Handles JSON-RPC 2.0 protocol, routes MCP methods to appropriate handlers, paginates lists and builds result envelopes
- **Header Helpers** (`src/mcp/headers.ts`): `decodeMcpHeaderValue()` for the `=?base64?…?=` sentinel used by `Mcp-Name`
- **OAuth challenges** (`McpApiHandler.bearerChallenge` in `src/index.ts`): builds the RFC 6750 `WWW-Authenticate: Bearer` value for the 401 (`invalid_token`) and 403 (`insufficient_scope`) responses
- **Home Page** (`src/views/home.ts`): Static, read-only landing page rendered at `/` (Pico CSS, no data collected)
- **HTML escaping** (`src/views/escape-html.ts`): single `escapeHtml()` used by both the home page and the OAuth consent page for every interpolated value
- **Tool Registry** (`src/mcp/tools/registry.ts`): Manages 30 tools across Tickets, Contacts, and Assets modules; enforces scopes and injects `staff_id`
- **Resource Registry** (`src/mcp/resources/registry.ts`): Provides 7 reference data resources with caching
- **HappyFox Client** (`src/happyfox/client.ts`): HTTP client with exponential backoff (see Rate Limiting)
- **Phone formatting** (`src/happyfox/endpoints/phones.ts`): `formatPhones()` maps the tool schemas' phone type words to the API's short codes. Shared by the contact and asset endpoints; only `ContactEndpoints.updateContact` passes `includeId = true`, because the create paths must not send phone ids
- **Reference Cache** (`src/cache/reference-cache.ts`): Uses Cloudflare Cache API to cache reference data (15 min TTL)
- **CORS Middleware** (`src/middleware/cors.ts`): Handles CORS with MCP-specific headers and origin validation

### Authentication

OAuth 2.0 (RFC 6749) with PKCE. HappyFox credentials are collected during the consent flow and stored encrypted in Cloudflare KV:

1. Client redirects to `/authorize` with an S256 PKCE challenge
2. User enters HappyFox credentials (subdomain, API key, auth code, staff email)
3. Server validates them and resolves `staff_id` from the email
4. Credentials are encrypted (AES-256-GCM) and stored in KV under a random `tokenId`, with a 90-day TTL (`CREDENTIAL_TTL_SECONDS`)
5. Authorization code goes back to the client, which exchanges it at `/oauth/token` and then sends the Bearer token to `/mcp`

The `/.well-known/*` discovery documents in the routes table are answered by `@cloudflare/workers-oauth-provider` itself - it intercepts those paths before delegating to `defaultHandler`, deriving both the issuer and the resource identifier from the request URL, so there is nothing to route for them here.

**Available Scopes:**
| Scope | Permissions |
|-------|-------------|
| `happyfox:read` | Read tickets, contacts, assets, and resources |
| `happyfox:write` | Create/update tickets, add replies, manage contacts |
| `happyfox:admin` | Delete tickets, move categories, delete assets |

A client that requests no scope is granted `DEFAULT_SCOPES` (`happyfox:read`); a client that requests only unrecognized scopes gets an error page.

**Staff ID Auto-Resolution:** During OAuth consent, the server resolves the user's `staff_id` by matching their email against the HappyFox staff list.

**OAuth Provider Configuration (`@cloudflare/workers-oauth-provider` 0.8.x):**

Non-default options set in `src/index.ts`, each for a reason:

| Option | Value | Why |
|--------|-------|-----|
| `clientIdMetadataDocumentEnabled` | `true` | CIMD is opt-in. Clients here identify by metadata-document URL, so this is required. Needs the `global_fetch_strictly_public` flag. |
| `allowPlainPKCE` | `false` | `handleAuthorize` already rejects anything but S256; this makes the library enforce it too, and drops `plain` from the advertised metadata. |
| `resourceMatchOriginOnly` | `true` | Resource indicators are compared by origin rather than exact string. One origin, one resource here, so it is equivalent in strength while tolerating `https://host/` vs `https://host/mcp`. |
| `refreshTokenTTL` | 90 days | Library default is 30. |

**Scopes are not passed to the API handler.** The library hands the handler `ctx.props` only, never `ctx.scopes`, so the granted scopes are stored in `OAuthProps` at authorization time and read back from `props.scopes` in `buildAuthContext`. Still required as of 0.8.3. The `resource` parameter, by contrast, is passed to `completeAuthorization()` untouched: the library's audience check parses the URI and treats a bare `/` path as covering the origin, so tokens stay properly audience-bound.

### Transport Design

Why this Worker can be fully stateless, and why it has no Durable Objects:

- **Streamable HTTP is a single endpoint.** The response to a client→server message is returned on the same POST, so a stateless Worker handles a request end-to-end without routing responses across instances. Workers *can* stream from a POST via the Streams API, but this server does no server-initiated work and always answers with plain `application/json`.
- **No server-initiated work means no coordinator.** No subscriptions, no progress notifications, no `listChanged` - nothing to push and nothing to keep a stream open for. Durable Objects would only become necessary if server-initiated messages or long-lived streams were added.
- **Origin validation is a MUST.** If an `Origin` header is present and not allow-listed, the server MUST respond 403 (DNS-rebinding defense). Implemented in `src/middleware/cors.ts`; an *absent* `Origin` is allowed, since every non-browser client omits it.

### Caching

Two independent layers.

**1. Workers Cache (edge, in front of the Worker)** - enabled by `"cache": { "enabled": true }` in `wrangler.jsonc`. On a hit Cloudflare serves the response without invoking the Worker at all, so caching is **opt-in per response**: `withCacheDefaults()` in `src/index.ts` stamps `Cache-Control: no-store` on every response that does not set its own, leaving only these cacheable:

| Response | Cache-Control |
|----------|---------------|
| `GET /` home page | `public, max-age=3600, stale-while-revalidate=86400` (set by the route) |
| `GET /.well-known/oauth-*` metadata | `public, max-age=3600` (set by `edgeCacheControlFor`, since the OAuth library sets none) |
| Everything else (MCP, consent, OAuth, errors) | `no-store` |

The discovery documents are allow-listed by path in `edgeCacheControlFor()` and only when the response is a successful GET/HEAD. When adding a route, set `Cache-Control` explicitly only if the response is identical for every user. `cross_version_cache` is left off, so each deployment starts with a cold cache.

**2. Reference Cache (Cache API, inside the Worker)** - `src/cache/reference-cache.ts` caches HappyFox reference data (categories, statuses, staff, …) for 15 minutes under `https://cache.happyfox.local/{region}/{accountName}/{resource}`, so US and EU data can never cross-pollute. Read and write failures are both swallowed; a miss just refetches.

### Rate Limiting Strategy

`HappyFoxClient.makeRequest` retries in exactly two situations, up to `maxRetries` (5):

- **HTTP 429.** Exponential backoff from a 1 s base, capped at 60 s, plus up to 1 s of jitter to spread out concurrent callers. Exhausting the retries throws `RATE_LIMIT_EXCEEDED`.
- **Transport failures**, per `isRetryableError`: a `TypeError` from `fetch()` whose message mentions `fetch`, or an error carrying a Node-style `.code` of `ECONNRESET`, `ETIMEDOUT`, `ENOTFOUND` or `ECONNREFUSED`. Same backoff curve, no jitter.

Every other non-OK response - 4xx **and 5xx alike** - is turned into a `HappyFoxAPIError` on the first try and never retried.

## HappyFox API Integration

### Endpoint Format
- US Region: `https://{accountName}.happyfox.com/api/1.1/json`
- EU Region: `https://{accountName}.happyfox.net/api/1.1/json`

### Authentication
Basic HTTP authentication with base64 encoded `{apiKey}:{authCode}`

### Custom Fields
- Ticket custom fields: `t-cf-{id}`
- Contact custom fields: `c-cf-{id}`

`DOCUMENTATION.md` is a transcription of HappyFox's public API docs and is the reference for request/response shapes.

## MCP Protocol Implementation (2026-07-28)

### Protocol Version

- **Supported version**: `2026-07-28` only. `SUPPORTED_PROTOCOL_VERSIONS` in `src/types/index.ts` is a one-element list and is what `server/discover` reports.
- **No handshake**: no `initialize`, no `notifications/initialized`, no session. `server/discover` replaces negotiation - clients MAY call it first to learn the supported versions, capabilities and server identity.
- **No backwards compatibility**: a request naming any other revision is rejected with HTTP 400 and `-32022` (`UnsupportedProtocolVersion`), whose `data` names what is supported.

### HTTP Methods

| Method | Behavior |
|--------|----------|
| POST | Process one MCP message. 200 with a JSON-RPC response, or 202 for a notification |
| OPTIONS | 204 preflight response |
| GET, DELETE, PUT, PATCH, HEAD, … | **405 Method Not Allowed** with `Allow: POST, OPTIONS` |

Reaching the 405 requires a valid Bearer token - `@cloudflare/workers-oauth-provider` answers 401 for unauthenticated requests before `McpApiHandler` runs. Both are conformant, so integration tests going through the Worker's default export assert `[401, 405]`, while tests driving `McpApiHandler` directly (with a fake `ctx.props`) assert exactly 405.

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

Header **names** are case-insensitive (`Headers.get` handles that). Header **values** are case-sensitive and compared with `===` - `Mcp-Method: TOOLS/LIST` for body method `tools/list` is a mismatch, not a match.

**`Mcp-Name` sentinel encoding.** A client MAY send a header value containing non-ASCII characters, control characters or leading/trailing whitespace as `=?base64?{StandardBase64}?=`, and MUST do so for any plain value that happens to look like the sentinel. `decodeMcpHeaderValue()` in `src/mcp/headers.ts` decodes it before comparison: the markers are **lowercase and case-sensitive**, the payload uses the **standard** base64 alphabet (`+` and `/`, padded), and the decoded bytes go through `TextDecoder` because `atob` alone yields a binary string and would mis-compare non-ASCII names. An undecodable payload is a header validation failure (`-32020`). This server's own names (`happyfox_*`, `happyfox://*`) are plain ASCII, so the encoded form is never *required*, but a conforming client may still use it.

**`Mcp-Session-Id` and `Last-Event-ID` are ignored** - never read, never minted, never echoed. Sending them is not an error: the request is processed as if they were absent, and no session header appears on any response. `Mcp-Param-*` headers are likewise ignored, since this server annotates no tool parameters.

### Validation Order

Every step short-circuits. CORS headers are attached from step 2 onward except on the 500 and the 403. **Every 400 carries a JSON-RPC error body** - dual-era clients probe for exactly that to decide whether a server is modern. The `id` member is present only when it was read as a string or number; otherwise it is **omitted entirely**, never sent as `null`.

| # | Check | On failure |
|---|-------|------------|
| 1 | `CREDENTIAL_ENCRYPTION_KEY` decodes to 32 bytes | 500, `-32603`, no `id`, no CORS headers |
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

Two deliberate orderings: header presence and consistency (14-16) are checked **before** version support (19), so a client on the wrong revision receives the actionable `-32022` rather than an opaque `-32020`; and `Mcp-Name` (21-24) is checked **after** 19 for the same reason.

Everything *returned* by step 27 is HTTP **200**, including application-level `-32602` (unknown tool, unknown resource, bad cursor). That is what produces the 400-vs-200 split for `-32602` described in the error table below.

### Scope Failures Are HTTP 403, Not JSON-RPC Results

A request whose token lacks the scope for the operation gets **HTTP 403** with a `WWW-Authenticate: Bearer` challenge carrying `error="insufficient_scope"`, `scope="<what the operation needs>"` and `resource_metadata`, so the client can step up its authorization. Both scope checks follow that: `tools/call` on a tool the token's scopes do not cover (`ToolRegistry.callToolWithAuth`, which denies unknown tools by default) and `resources/read` without `happyfox:read` (`MCPServer.handleResourceRead`). They throw `InsufficientScopeError` (`src/types/index.ts`), the **only** thing `MCPServer.handleRequest` lets escape; the transport catches it and builds the 403. The body uses the application-defined code `403` (`INSUFFICIENT_SCOPE`) with `data.requiredScopes` - outside the JSON-RPC reserved range, and equal to the HTTP status so the two can never disagree. Do **not** report a scope failure as an `isError` tool result, as `-32602`, or as `-32600`.

`resource_metadata` names the path-suffixed document (`/.well-known/oauth-protected-resource/mcp`), the same one `@cloudflare/workers-oauth-provider` names on its own 401s; `McpApiHandler.bearerChallenge` also builds the `invalid_token` challenge for step 26. Because `WWW-Authenticate` is not CORS-safelisted, `src/middleware/cors.ts` exposes it - the only entry in `Access-Control-Expose-Headers`, since this server sets no `MCP-*` response headers.

### Supported Methods

| Method | Notes |
|--------|-------|
| `server/discover` | **Mandatory** in this revision. Requires no OAuth scope |
| `tools/list` | Filtered by the caller's granted scopes; sorted by name; paginated |
| `tools/call` | Requires `Mcp-Name` matching `params.name`. A tool outside the token's scopes is HTTP 403 + challenge |
| `resources/list` | Paginated. Filtered by the caller's granted scopes: without `happyfox:read` the list is empty, never an error |
| `resources/read` | Requires `Mcp-Name` matching `params.uri`. Without `happyfox:read` it is HTTP 403 + challenge |

Anything else - `initialize`, `notifications/initialized`, `completion/complete`, `prompts/list`, `resources/templates/list`, `subscriptions/listen`, `ping`, `logging/setLevel`, `tasks/*` - is **404 Not Found** with `-32601`. The error message names `2026-07-28` and the supported methods, so a legacy client that POSTs `initialize` gets a diagnostic it can surface to its user. `MCPServer` keeps its own `default:` arm throwing `-32601`; it is unreachable over HTTP (the transport 404s first) and exists as defense in depth for direct callers.

### Message Format and Request Metadata (`params._meta`)

The POST body must be exactly one JSON-RPC request or notification; an array payload is HTTP 400 with `-32600`. `params` is **structurally required on every request**, including `server/discover` and `tools/list`, which have no other parameters. So is `params._meta`. A body missing either is malformed and is rejected with `-32602` at HTTP 400.

| Key | Type | Required | Notes |
|-----|------|----------|-------|
| `io.modelcontextprotocol/protocolVersion` | `string` | **Yes** | Must equal the `MCP-Protocol-Version` header |
| `io.modelcontextprotocol/clientCapabilities` | object | **Yes** | Usually `{}`. This server requires no client capability, so it never emits `-32021` |
| `io.modelcontextprotocol/clientInfo` | `{ name, version }` | No | Absence is legal and must be tolerated. Self-reported and never used for security decisions |

### Result Fields

Every **result** (never an error response) carries `resultType` and a server identity in `_meta`. Results that are cacheable additionally carry `ttlMs` (milliseconds) and `cacheScope`.

| Field | Where | Value here |
|-------|-------|------------|
| `resultType` | Every result | Always the literal `"complete"` - including on `isError: true` tool results, which are successful JSON-RPC results |
| `_meta["io.modelcontextprotocol/serverInfo"]` | Every result | `{ name: "happyfox-mcp", version: <package.json version> }` |
| `ttlMs` / `cacheScope` | `server/discover` | `3600000` / `"public"` - identical bytes for every caller |
| `ttlMs` / `cacheScope` | `tools/list`, `resources/list`, `resources/read` | `900000` / `"private"` - scope-filtered or per-HappyFox-account, so caches must not be shared across authorization contexts |
| `ttlMs` / `cacheScope` | `tools/call` | **Absent.** `CallToolResult` is not cacheable; adding them would be as wrong as omitting them elsewhere |

Note the unit trap: `ReferenceCache` stores its TTL in **seconds** (`900`); the protocol wants **milliseconds**, so `CACHE_TTL_MS_DISCOVER` / `CACHE_TTL_MS_STANDARD` in `src/types/index.ts` are the only source used.

`server/discover` declares exactly `capabilities: { tools: {}, resources: {} }` - bare empty objects. `listChanged` and `subscribe` are deliberately **not** declared: this server implements no `subscriptions/listen` stream, the only place those notifications could be delivered in this revision, so advertising them would be a promise it cannot keep. `completions`, `prompts` and `logging` are not declared either.

### Response Behavior
- **Requests (with id)**: JSON-RPC response with `result` or `error`, HTTP 200 (or a transport status from the validation table)
- **Notifications (no id)**: HTTP 202 Accepted, no body, no header validation, no work performed. This revision defines no client-to-server notifications over Streamable HTTP
- **Tool execution errors** (HappyFox API failures, bad input): `isError: true` in the result, with `_meta.statusCode` and `_meta.errorCode` merged alongside `serverInfo`. Unprefixed `_meta` key names are legal - the prefix segment is optional
- **Scope failures**: never a result and never a `-326xx` error - HTTP 403 with a challenge
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

Note the two obligations attached to `-32602`: a request **malformed** at the protocol layer must be 400, while an application-level "not found" is a normal outcome returned inside a 200.

Allocation rules for anything added later: `-32020` to `-32099` is reserved for the MCP specification, so implementation-defined codes must not be drawn from it, and `-32000` to `-32019` is a legacy sub-range new implementations should not use at all. `-32002` (resource not found, superseded by `-32602`) and `-32042` (URL elicitation required) MUST NOT be emitted. This codebase emits only `-32700`, `-32600`, `-32601`, `-32602`, `-32603`, `-32020` and `-32022` from the reserved range, plus the application-defined `401` and `403` that accompany the OAuth challenges.

### Pagination
- `tools/list` and `resources/list` support cursor-based pagination (50 items per page)
- Pass `cursor` param to get next page; the cursor is a non-negative integer start index
- `cacheScope` is identical across every page of one list; `ttlMs` may differ per page
- `tools/list` sorts by tool name (plain byte comparison, not `localeCompare`) before paginating, so the order is deterministic across requests and clients can cache the list reliably

## Tools and Resources

### Available Tool Categories
- **Tickets** (14): create_ticket, create_tickets_bulk, list_tickets, get_ticket, update_ticket_tags, update_ticket_custom_fields, move_ticket_category, add_staff_reply, add_private_note, add_contact_reply, forward_ticket, subscribe_to_ticket, unsubscribe_from_ticket, delete_ticket
- **Contacts & groups** (9): create_contact, list_contacts, get_contact, update_contact, get_contact_group, create_contact_group, update_contact_group, add_contacts_to_group, remove_contacts_from_group
- **Assets** (7): list_assets, get_asset, create_asset, update_asset, delete_asset, list_asset_custom_fields, get_asset_custom_field

All 30 are registered with the `happyfox_` prefix and must appear in `TOOL_SCOPE_MAP` (`src/oauth/services/scope-enforcer.ts`) - a tool missing from that map is denied to every caller and never appears in `tools/list`.

### Resources vs Tools

A HappyFox endpoint that takes **no query parameters** is exposed as a **Resource** (application- or user-controlled, cached 15 minutes). An endpoint with filtering or pagination, and every write operation, is exposed as a **Tool** (model-controlled). The three read endpoints that are tools rather than resources are the counterexamples that make the rule concrete: `GET /users/` (`q`, `page`, `size`), `GET /assets/` (`asset_type`, `page`, `size`) and `GET /tickets/` (`q`, `status`, `category`, `page`, `size`).

| URI | Description | HappyFox Endpoint |
|-----|-------------|-------------------|
| `happyfox://categories` | Ticket categories | `GET /categories/` |
| `happyfox://statuses` | Ticket statuses | `GET /statuses/` |
| `happyfox://ticket-custom-fields` | Ticket custom field metadata | `GET /ticket_custom_fields/` |
| `happyfox://contact-custom-fields` | Contact custom field metadata | `GET /user_custom_fields/` |
| `happyfox://staff` | Staff/agents list | `GET /staff/` |
| `happyfox://contact-groups` | Contact groups | `GET /contact_groups/` |
| `happyfox://asset-types` | Asset type definitions | `GET /asset_types/` |

Every resource URI follows `happyfox://{resource-name}` and returns the endpoint's JSON as `application/json` text.

### Staff ID

`TOOLS_REQUIRING_STAFF_ID` in `src/oauth/services/scope-enforcer.ts` is the list of tools that need an acting staff member, mapped to the parameter that carries it (`staff_id` for the ticket tools, `created_by` / `updated_by` / `deleted_by` for the asset ones).

**Auto-Injection**: `injectStaffId()` fills that parameter with the `staff_id` resolved during the OAuth consent flow whenever the caller left it `undefined` or `null`. A caller may still pass a different `staff_id` explicitly to act on behalf of another staff member.

### Attachment Support
File attachments are **not supported**. The HappyFox API requires multipart/form-data for attachments, which is not implemented. Attachment parameters are absent from every tool schema.

## TypeScript Configuration

The project uses Cloudflare Workers' built-in TypeScript support - no build step required. Wrangler compiles TypeScript on-the-fly during development and deployment.

## Toolchain Notes

- **`compatibility_date`**: `2026-07-30`, matching the `workerd` bundled with Wrangler 4.118. Bump it together with Wrangler so local dev runs the same runtime as production, and rerun `npx wrangler types` afterwards.
- **`@cloudflare/workers-types` vs generated types**: `tsconfig.json` uses the published `@cloudflare/workers-types` package; `worker-configuration.d.ts` is generated by `wrangler types` and embeds a full copy of the runtime types. Do **not** load both in one program - they collide. Wrangler now recommends the generated file; switching is a separate change.

## Testing Notes (Vitest 4 / vitest-pool-workers 0.20)

- **Config is a Vite plugin.** `vitest.config.mts` uses `cloudflareTest({...})` from `@cloudflare/vitest-pool-workers` inside `plugins`, not `defineWorkersConfig`. The file must be `.mts` - the package is ESM-only and the project has no `"type": "module"`.
- **There is no `cloudflare:test` module.** Use `import { env, exports } from "cloudflare:workers"`; the entry point is `exports.default.fetch(...)`, not `SELF.fetch(...)`. `test/env.d.ts` declares `Cloudflare.GlobalProps.mainModule` so `exports.default` is typed.
- **There is no `fetchMock`.** `test/helpers/fetch-mock.ts` is a local shim over `globalThis.fetch` that keeps the slice of undici's MockAgent API the suite uses (`get(origin).intercept({path, method}).reply(...)` / `.replyWithError(...)`, `assertNoPendingInterceptors()`). It also fills in response reason phrases, which the `Response` constructor leaves blank but undici set.
- **Unhandled rejections fail the run.** When a promise is expected to reject while fake timers advance, attach the assertion *before* advancing (see the retry tests in `test/unit/happyfox/client.test.ts`).
- Storage isolation is per test file.
- Use `globalThis`, not `global`: `global` is Node-only and undeclared under `@cloudflare/workers-types`.
- Tests are not covered by `npm run typecheck` (it is `src` only). Check them with `npx tsc --noEmit -p test/tsconfig.json`. That config sets `"exclude": []` to undo the root config's `exclude: ["test"]`; without it the program is empty and typechecks nothing.

## Environment Variables

Set in `wrangler.jsonc` or the Cloudflare Dashboard:
- `ALLOWED_ORIGINS` - (Optional) Comma-separated list of allowed CORS origins. Defaults to `http://localhost:*` and `https://localhost:*`

**KV Namespace Binding:** `OAUTH_KV`, for encrypted credential storage. Create it with `wrangler kv namespace create OAUTH_KV`, then bind it either in `wrangler.jsonc` or under **Workers & Pages** > your worker > **Settings** > **Bindings** > **KV Namespace Bindings**.

**Required secret** (`wrangler secret put`), and the only one:
- `CREDENTIAL_ENCRYPTION_KEY` - AES-256-GCM key for encrypting stored credentials
  - **Format**: 32 bytes, base64 encoded. Generate with `openssl rand -base64 32`
  - **Failure mode**: every request to `/mcp` returns HTTP 500 with error -32603 if it is missing or does not decode to exactly 32 bytes

## Testing MCP Endpoints (MCP 2026-07-28)

Every call is independent - there is no ordering requirement and no state carried between them. Obtain a Bearer token by completing the OAuth consent flow at `/authorize`, then set `TOKEN=<access-token>` and `HOST=http://localhost:8787`.

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
```

The other four methods are the same call with three things changed - the `Mcp-Method` header, the `method` in the body (they must match), and the params:

| Method | `Mcp-Name` | Body `params` beyond `_meta` |
|--------|-----------|------------------------------|
| `server/discover` | not sent | none. Requires no scope |
| `tools/list` | not sent | optional `"cursor":"0"`. Filtered by the token's scopes, sorted by name, 50 per page |
| `resources/list` | not sent | optional `"cursor":"0"`. Empty without `happyfox:read`, never an error |
| `resources/read` | `happyfox://categories` | `"uri":"happyfox://categories"`. Requires `happyfox:read` |
| `tools/call` (write) | `happyfox_add_staff_reply` | `"name":"happyfox_add_staff_reply","arguments":{"ticket_id":"123","text":"Reply message"}`. Requires `happyfox:write`; `staff_id` is auto-injected when omitted |

A conforming client MAY send `Mcp-Name` sentinel-encoded instead; the server decodes it before comparing, so this is equivalent to the plain form above:

```bash
  -H "Mcp-Name: =?base64?aGFwcHlmb3g6Ly9jYXRlZ29yaWVz?="
```

Useful negative checks: dropping `Mcp-Method` gives 400 `-32020`; naming an older revision in both the header and `_meta` gives 400 `-32022`; `initialize` gives **404** `-32601`; `GET`/`DELETE` on `/mcp` gives 405 with a valid token (401 without one); calling `happyfox_delete_ticket` with a token that lacks `happyfox:admin` gives **403** with `WWW-Authenticate: Bearer realm="OAuth", resource_metadata="…/.well-known/oauth-protected-resource/mcp", error="insufficient_scope", error_description="…", scope="happyfox:admin"`.

## Project Structure

```
src/
├── index.ts                    # Worker entry point: OAuth provider + McpApiHandler validation pipeline
├── types/
│   └── index.ts               # Protocol constants, error codes, _meta keys, result/envelope types
├── views/
│   ├── home.ts                # Read-only home page served at /
│   └── escape-html.ts         # escapeHtml() shared by the home and consent pages
├── oauth/
│   ├── types.ts               # OAuth type definitions (scopes, credentials, credential TTL)
│   ├── services/
│   │   ├── credential-store.ts    # AES-256-GCM encrypted credential storage + decodeEncryptionKey
│   │   ├── happyfox-validator.ts  # Credential validation & staff ID resolution
│   │   └── scope-enforcer.ts      # TOOL_SCOPE_MAP, TOOLS_REQUIRING_STAFF_ID, staff_id injection
│   └── views/
│       └── consent.ts         # OAuth consent page HTML (Pico CSS)
├── cache/
│   └── reference-cache.ts     # Cache API wrapper for reference data
├── mcp/
│   ├── server.ts              # MCP protocol handler (server/discover, tools/*, resources/*)
│   ├── headers.ts             # Mcp-Name =?base64?…?= sentinel decoding
│   ├── tools/
│   │   ├── registry.ts        # Tool registration, scope enforcement, staff_id injection
│   │   └── tickets.ts, contacts.ts, assets.ts   # Tool definitions + handlers
│   └── resources/
│       └── registry.ts        # Resource registration and reading
├── happyfox/
│   ├── client.ts              # HTTP client with retry logic
│   └── endpoints/
│       ├── tickets.ts, contacts.ts, assets.ts   # API methods per module
│       └── phones.ts          # formatPhones() shared by contacts and assets
└── middleware/
    └── cors.ts                # CORS handling with MCP headers and Origin validation

test/
├── env.d.ts                     # Cloudflare.GlobalProps so exports.default is typed
├── tsconfig.json                # Extends the root config with "exclude": []
├── unit/
│   ├── transport/mcp-handler.test.ts   # Header/_meta pipeline (drives McpApiHandler directly)
│   ├── mcp/                            # server, headers, tools/registry, resources/registry
│   ├── happyfox/                       # client (retry/backoff) + endpoints/{tickets,contacts,assets}
│   ├── oauth/                          # services/{credential-store,happyfox-validator}, views/consent
│   ├── cache/reference-cache.test.ts
│   ├── views/home.test.ts
│   ├── middleware/cors.test.ts
│   └── types/errors.test.ts
├── integration/worker.test.ts   # OAuth endpoints and unauthenticated /mcp behavior
└── helpers/
    ├── json-rpc.ts              # 2026-07-28 request/header builders
    ├── client-mock.ts           # HappyFoxClient stub
    ├── fetch-mock.ts            # globalThis.fetch mock
    └── fetch-mock-helpers.ts    # HappyFox API mocking utilities
```
