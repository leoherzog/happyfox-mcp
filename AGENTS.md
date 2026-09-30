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
uv run Docs/sync.py                    # refresh the HappyFox API reference; review with git diff Docs/
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
| `/oauth/token` | POST | OAuth token exchange (handled by the library, plus the refresh-time revalidation below) |
| `/api/validate-staff` | POST | Live credential check for the consent form (see below); any other method falls through to 404 |
| `/.well-known/oauth-authorization-server` | GET | OAuth server metadata (RFC 8414) |
| `/.well-known/oauth-protected-resource/mcp` | GET | Protected resource metadata (RFC 9728 §3.1) for the resource `<origin>/mcp`. The bare `/.well-known/oauth-protected-resource` is 404 |

`/api/validate-staff` takes JSON `{accountName, apiKey, authCode, email, region?, apiHost?, scopes?}` and answers `{valid, staffName, error, warnings}`. It first requires the consent page's CSRF token in an `X-CSRF-Token` header equal to the `csrf_token` cookie, which `GET /authorize` sets with `Path=/`, and answers 403 otherwise. A cross-origin page can neither read the token nor send the header, which needs a preflight this route never grants. It answers 400 for a missing field, an invalid account name, a region other than `us` or `eu`, or an invalid `apiHost`. `warnings` lists tools the requested scopes expose that the agent's role cannot use: `move_ticket_category` needs `move_tickets` or `move_ticket_to_any_category`, and `delete_asset` needs `manage_assets`. Warnings never block consent.

### Core Components

- **Transport** (`src/index.ts`, `McpApiHandler`): Validates Origin, HTTP method, headers and `params._meta`, then dispatches to the MCP server. Exported by name so the validation pipeline can be unit-tested directly (the OAuth provider answers 401 before the handler runs, so integration tests cannot reach it)
- **MCP Server** (`src/mcp/server.ts`): Handles JSON-RPC 2.0 protocol, routes MCP methods to appropriate handlers, paginates lists and builds result envelopes
- **Header Helpers** (`src/mcp/headers.ts`): `decodeMcpHeaderValue()` for the `=?base64?…?=` sentinel used by `Mcp-Name`
- **OAuth challenges** (`McpApiHandler.bearerChallenge` in `src/index.ts`): builds the RFC 6750 `WWW-Authenticate: Bearer` value for the 401 (`invalid_token`) and 403 (`insufficient_scope`) responses
- **Home Page** (`src/views/home.ts`): Static, read-only landing page rendered at `/` (Pico CSS, no data collected)
- **HTML escaping** (`src/views/escape-html.ts`): single `escapeHtml()` used by both the home page and the OAuth consent page for every interpolated value
- **Tool Registry** (`src/mcp/tools/registry.ts`): Registers 43 tools from six modules (tickets, contacts, assets, reports, knowledge base, ticket field choices); enforces scopes, injects the acting staff id, and turns a HappyFox 401 into `CredentialsRejectedError`
- **Resource Registry** (`src/mcp/resources/registry.ts`): Serves 12 resources, one `SOURCES` entry each; checks the documented response shape before caching
- **HappyFox Client** (`src/happyfox/client.ts`): Sends JSON with Basic auth to `https://{apiHostFor(auth)}/api/1.1/json`, never follows redirects, and turns every failure into a `HappyFoxAPIError` (see HappyFox Error Handling and Rate Limiting). `new HappyFoxClient(auth, { maxRetries })` throws `INVALID_ACCOUNT` (400) for an invalid region, account name or custom host. Query values may be arrays, sent as repeated `key=value` pairs; `undefined` and `null` are skipped, and no `?` is appended when nothing remains
- **Errors** (`src/happyfox/errors.ts`): `HappyFoxAPIError` (re-exported from `client.ts`), `reportsError()`, which decides whether an `error` value reports a failure, and `formatErrorBody()`, which renders every documented error body as `field: message` joined by `; `, with nested keys dotted (`custom_fields.1`) and bulk failures prefixed `item N:` (1-based) unless the caller passes its own label, as the bulk endpoints do
- **Path ids** (`src/happyfox/paths.ts`): `idSegment()`, `contactSegment()` and `assertSafePath()` (see Path Ids)
- **Hosts** (`src/happyfox/host.ts`): `REGIONS`, `isRegion()`, `ACCOUNT_NAME_PATTERN`, `parseApiHost()`, `isValidAccount()` and `apiHostFor()`. Use `apiHostFor()` wherever an account's host or a per-account key is needed
- **Custom fields** (`src/happyfox/endpoints/custom-fields.ts`): `customFieldEntries()` validates a `custom_fields` argument before its entries are merged as top-level payload keys; `customFieldsSchema()` builds the matching JSON Schema. See Custom Fields
- **Phone formatting** (`src/happyfox/endpoints/phones.ts`): `formatPhones(phones, includeId = false, param = 'phones')`, shared by the contact and asset endpoints. `number` is a required string. `type` is optional and omitted when absent (HappyFox then uses other); it accepts the words mobile/work/main/home/other or the codes mo/w/m/h/o, case-insensitively. `is_primary` is sent only when set, and at most one phone may be true. Only `ContactEndpoints.updateContact` passes `includeId = true`. With `false`, a phone `id` is refused, naming the field and pointing to `happyfox_update_contact`: those paths add every phone, and dropping the id would turn an edit into a new phone. A phone sent with an `id` must also give `type`, so an edit never falls back to other. Any violation is `INVALID_ARGUMENT` naming the field
- **Reference Cache** (`src/cache/reference-cache.ts`): Cloudflare Cache API copy of the resources, per host and credentials (see Caching)
- **Grant revalidation** (`src/oauth/services/grant-revalidation.ts`): `revalidateOnRefresh`, the token-exchange callback that re-checks the stored key and consenting agent on every refresh
- **CORS Middleware** (`src/middleware/cors.ts`): Handles CORS with MCP-specific headers and origin validation

### Authentication

OAuth 2.0 (RFC 6749) with PKCE. HappyFox credentials are collected during the consent flow and stored encrypted in Cloudflare KV:

1. Client redirects to `/authorize` with an S256 PKCE challenge
2. User enters the account subdomain, region, optional custom domain (`api_host`), API key, auth code and staff email. The region must be exactly `us` or `eu`; an absent one means `us`, and any other value is a consent error, never a default. `parseApiHost()` accepts only a bare public host name, lowercased: no scheme, port, path, userinfo, IP literal, trailing dot or special-use name such as `localhost`, `.local`, `.internal`, `.test`, `.example` or `.arpa`
3. Server fetches `GET /staff/` once, with no transport retries, and matches the email case-insensitively. The record must have `active !== false`, the documented field (Docs/360 §2); when an email repeats, an active record wins. The record's `permissions` drive the consent page's advisory warnings. A custom domain can be any public host, so its failures other than 401, 403, 404 and 429 are reported as `The custom domain did not answer like a HappyFox account (HTTP <status>).` or `The custom domain could not be reached.`, never with the upstream text. A consent error re-renders the form with the same CSRF token
4. Credentials, including `apiHost` when entered, are encrypted (AES-256-GCM) and stored in KV under a random `tokenId`, with a 90-day TTL (`CREDENTIAL_TTL_SECONDS`). Records without `apiHost` use the subdomain host
5. Authorization code goes back to the client, which exchanges it at `/oauth/token` and then sends the Bearer token to `/mcp`

`buildAuthContext` reads the record back through `storedAuth()` (`src/oauth/services/credential-store.ts`), which throws for a region, account or host that consent would reject, including an `apiHost` that is present but not a string. That throw is the step-26 401, so a crafted record never reaches a request URL or a cache key.

The `/.well-known/*` discovery documents in the routes table are answered by `@cloudflare/workers-oauth-provider` itself - it intercepts those paths before delegating to `defaultHandler`, so there is nothing to route for them here. The issuer comes from the request URL and the resource from the provider's `resourceMetadata` (see below).

**Available Scopes** (must match `SCOPE_DESCRIPTIONS` in `src/oauth/types.ts` and `TOOL_SCOPE_MAP`):

| Scope | Permissions |
|-------|-------------|
| `happyfox:read` | Read tickets, contacts, contact groups, assets, reports and the knowledge base, plus reference data such as categories, statuses and staff (every resource) |
| `happyfox:write` | Create and update tickets, contacts, contact groups and assets; reply to, forward and add private notes to tickets |
| `happyfox:admin` | Delete tickets and assets, move tickets to another category, and replace the choices of ticket custom fields account-wide |

A client that requests no scope is granted `DEFAULT_SCOPES` (`happyfox:read`); a client that requests only unrecognized scopes gets an error page. When a scope gains a new kind of object, update `SCOPE_DESCRIPTIONS` with it.

**Staff ID Auto-Resolution:** During OAuth consent, the server resolves the user's `staff_id` by matching their email against the HappyFox staff list. HappyFox has no endpoint that names the agent owning an API key, which is why consent asks for the email.

**OAuth Provider Configuration (`@cloudflare/workers-oauth-provider` 1.2.x):**

The library binds every token to one canonical resource. `providerFor()` in `src/index.ts` builds one provider per request origin, with resource `<origin>/mcp`, so workers.dev, a custom domain and `wrangler dev` on `http://localhost:8787` each work without configuration. Cloudflare routes only this Worker's own hosts to it, so the origin is trusted. A token works only on the origin that issued it, and an authorization request naming any other resource is refused with `invalid_target`. The cache holds at most 16 providers, for wildcard routes.

Options set explicitly in `createProvider()`, each for a reason:

| Option | Value | Why |
|--------|-------|-----|
| `clientIdMetadataDocumentEnabled` | `true` | CIMD is opt-in. Clients here identify by metadata-document URL, so this is required. Needs the `global_fetch_strictly_public` flag. |
| `resourceMetadata.resource` | `<origin>/mcp` | Required since 1.0. The `/mcp` form matches `bearerChallenge` and the `resource` conformant MCP clients send; `https://host/` would be refused. |
| `requiredScopes` | `AVAILABLE_SCOPES` | Published as `scopes_supported` in the protected-resource metadata and as `scope=` on the library's 401, so a client requests every scope and consent can offer them. Without it the metadata lists none and clients fall back to `DEFAULT_SCOPES`. |
| `refreshTokenTTL` | 90 days | Library default is 30. |
| `accessTokenTTL` | 3600 s | The library default, pinned because it bounds how long a deactivated agent or a disabled key keeps working. |
| `tokenExchangeCallback` | `revalidateOnRefresh` | Re-checks the grant on every refresh (see Re-Authorization), with `options.env`. |

**Scopes come from the access token.** The library hands the handler `ctx.auth`, whose `scope` is what the token carries, which can be narrower than the grant. `buildAuthContext` uses it and falls back to `props.scopes`, the scopes consent granted, stored in `OAuthProps`. `handleAuthorize` turns the library's `AuthorizationError` into its ready-made redirect back to the client, or a 400 page when no redirect is safe, and a `CimdFetchError` into a 400 page.

### Re-Authorization

A grant stops working, and the client must go back through consent, in three ways:

- **Refresh.** On every `refresh_token` grant, `revalidateOnRefresh` makes one `GET /staff/` call with no transport retries and matches the stored `staffId`. An inactive or deleted agent, a HappyFox 401 or 403, or a missing or invalid stored record gets OAuth `invalid_grant`. The KV record is deleted, and the library revokes the grant with its live access tokens. When HappyFox cannot be reached, the refresh proceeds.
- **HappyFox 401 on a request.** During `tools/call` or `resources/read`, a HappyFox 401 is HTTP 401 with code `401` and `WWW-Authenticate: Bearer ... error="invalid_token", error_description="HappyFox rejected the stored API key and auth code"`. `McpApiHandler.endGrant` first deletes the KV credentials, then revokes the grant through `env.OAUTH_PROVIDER.listUserGrants(tokenId)` and `revokeGrant`; consent sets `userId = tokenId`, so only the grant that made the request is revoked. A HappyFox 403 can be the agent's role, which re-consent would not fix, so it stays an `isError` result on `tools/call` and a `-32603` error on `resources/read`.
- **Missing credentials.** A token whose KV record is gone or fails `storedAuth()` gets the step-26 401.

Tool handlers must not catch and swallow a HappyFox 401, or the grant is never ended. Whether a disabled key answers 401 is unverified until tested against a live account.

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

**2. Reference Cache (Cache API, inside the Worker)** - `src/cache/reference-cache.ts` caches resource data under `https://cache.happyfox.local/{apiHost}/{hex SHA-256 of apiKey:authCode}/{resource}`. `apiHost` comes from `apiHostFor(auth)`, the host the client called, so data from different regions or custom domains can never share a slot, and an entry is served only to the credentials that filled it. `get(auth, resource)`, `set(auth, resource, data, ttlSeconds?)` and `invalidate(auth, resource)` take the resource URI without `happyfox://`, which must match `[a-z0-9-]+`; an invalid account or resource touches no entry.

The stored body is `{expiresAt, data}`, so a hit reports its remaining lifetime. The TTL is `REFERENCE_TTL_SECONDS` (900) by default and 60 s for `ticket-custom-fields`, because Docs/1247 lets an external source replace choices at any time. A write that changes a resource calls `invalidate`: `create_contact_group` and `update_contact_group` drop `contact-groups`, and `update_ticket_custom_field_choices` drops `ticket-custom-fields`. All three do so whether or not the call succeeds, since a lost response can follow an applied change. The Cache API is per data center, so `set` and `invalidate` reach only the local copy. All three methods swallow failures; a miss just refetches.

### Rate Limiting Strategy

Docs/1148: past 500 GET or 300 POST requests a minute, HappyFox answers 429 for the next 10 minutes, and these limits take precedence over per-key throttles. No backoff can outlast that, so `HappyFoxClient.makeRequest` retries a 429 at most once:

- **HTTP 429.** The unread body is released. A `Retry-After` of up to 10 s (`MAX_RETRY_AFTER_MS`, delta-seconds or HTTP-date) is honoured once; without one, the retry comes after 1 s plus up to 1 s of jitter. A longer `Retry-After` or a second 429 throws `RATE_LIMIT_EXCEEDED`, whose message states the documented limits and lockout.
- **Transport failures**, up to `maxRetries` (default 5), with delays doubling from 1 s and no jitter. A GET retries on a `TypeError` from `fetch()` whose message mentions `fetch`, or a Node-style `.code` of `ECONNRESET`, `ETIMEDOUT`, `ENOTFOUND` or `ECONNREFUSED`. A POST, PUT or DELETE retries only on `ENOTFOUND` or `ECONNREFUSED`, which fail before any connection. Any other write failure throws `NETWORK_ERROR` saying HappyFox may still have applied the write: a repeat could duplicate a ticket or reply, report a completed delete as failed, or recreate new choices under new ids.

Every other non-OK response - 4xx **and 5xx alike** - throws on the first try. `update_ticket_custom_field_choices` adds to a `NETWORK_ERROR` that the caller should re-read `happyfox://ticket-custom-fields` before repeating the call.

### HappyFox Error Handling

`HappyFoxClient.readResponse` classifies every response before any caller sees it:

- **3xx** throws `REDIRECT` carrying the 3xx status. Redirects are never followed (`redirect: 'manual'`), because a POST that became a GET would report a write that never happened; the message names the `Location` host and hints at the region or a custom domain.
- **Non-OK** throws `API_ERROR` with `formatErrorBody()` of the JSON body, the first 500 characters of a text body, or the status line for an HTML page.
- **2xx with a non-JSON body** throws `INVALID_RESPONSE`, reporting the status and content type but never the body. An empty 2xx is `{}` for DELETE, since DELETE `/asset/<id>/` is the only DELETE and documents no body (Docs/1201 §5). It is `INVALID_RESPONSE` for every other method, including the writes the docs show no success body for (Docs/1039 §9-11, Docs/1092 §7 and §11). On a write, the message says HappyFox may still have applied it.
- **2xx whose only key is `error`** throws `API_ERROR` with the real 2xx status when `reportsError()` counts the value as a failure: `true`, text, or a non-empty list or object (Docs/1039 §8 gives a failure body without its status). `false`, numbers, blank text, `[]` and `{}` are returned as data.

Codes carried by `HappyFoxAPIError.code`, which surface as `_meta.errorCode` on `isError` tool results and as `data.errorCode` on a `resources/read` failure:

| Code | `statusCode` | Raised for |
|------|--------------|------------|
| `API_ERROR` | HappyFox's; 400 when every bulk item failed | Non-OK response, error-only 2xx, or a bulk request where every item failed |
| `RATE_LIMIT_EXCEEDED` | 429 | See Rate Limiting |
| `NETWORK_ERROR` | 0 | Transport failure after retries |
| `REDIRECT` | 3xx | Any redirect |
| `INVALID_RESPONSE` | 2xx | Non-JSON body, empty body on anything but DELETE, or a resource or contact body not in its documented shape |
| `INVALID_ID` | 400 | Any id argument, in a path, body or query, rejected by `idSegment` / `contactSegment` |
| `INVALID_PATH` | 400 | The `assertSafePath` backstop |
| `INVALID_ARGUMENT` | 400 | An argument an endpoint rejects before sending |
| `INVALID_ACCOUNT` | 400 | A client built for an invalid region, account name or custom host |

## HappyFox API Integration

### API Reference

`Docs/` holds HappyFox's public API articles as Markdown, one `<id>-<slug>.md` per article, and is the authoritative reference for request and response shapes. The files are converted from HTML, so backslash escapes such as `\<` are artifacts. Refresh them with `uv run Docs/sync.py`, then review upstream changes with `git diff Docs/`. Code cites them as `Docs/<id> §<section>`.

| Article | Covers |
|---------|--------|
| `Docs/360` | Overview, EU host, categories, staff, statuses, custom field metadata, knowledge base export |
| `Docs/476` | Creating and disabling API keys |
| `Docs/1039` | Tickets, including the search syntax (§2 Filter fields and §2.1) and sort values ("Sorting list of tickets") |
| `Docs/1088` | Reports |
| `Docs/1092` | Contacts and contact groups |
| `Docs/1148` | Rate limiting |
| `Docs/1201` | Assets, asset custom fields and asset types |
| `Docs/1247` | Replacing ticket custom field choices |

### Endpoint Format
- US Region: `https://{accountName}.happyfox.com/api/1.1/json`
- EU Region: `https://{accountName}.happyfox.net/api/1.1/json`
- Custom domain: `https://{apiHost}/api/1.1/json`. An account on a custom domain must use that domain only (Docs/1039 note 1, repeated in Docs/1088, 1092 and 1201)

`apiHostFor()` returns `apiHost` when set, else the account subdomain on the region's domain. `REGIONS` (`us`, `eu`) is the allow-list; nothing defaults an unknown region.

### Authentication
Basic HTTP authentication with base64 encoded `{apiKey}:{authCode}`. Keys are created for the account under Apps > Goodies > API and name no agent (Docs/476).

### Path Ids

`/ticket/<n>/` takes the ticket number, the ticket's `id`, never its display id such as `#DC00000003` (Docs/1039 §3). Every caller value interpolated into a path goes through `idSegment()` (a positive integer as a number or digit string, returned in canonical decimal), `contactSegment()` (an id or an email address, percent-encoded with `@` literal. The local part may hold `?`, `#` and `%`, which are encoded; `/`, `\`, whitespace, control characters, `..`, `? # %` in the domain and a lone UTF-16 surrogate are rejected), or `ticketNumber()` in the ticket endpoints, which wraps `idSegment()` and tells the model how to look up a display id. `makeRequest` also runs `assertSafePath()` on every path, which refuses a raw `?`, `#`, `\` or whitespace and any segment that decodes to `.`, `..` or holds `/` or `\`. This must print nothing:

```bash
grep -rnE '`/[^`]*\$\{' src | grep -vE '\$\{(idSegment|contactSegment|ticketNumber)\('
```

Endpoints validate the path id before their other arguments, so an injection always reports `INVALID_ID`. Handlers pass the tool arguments through and each endpoint copies only documented keys into the body, so extra arguments never reach HappyFox.

### Custom Fields

| Where | Keys | Source of ids |
|-------|------|---------------|
| Ticket create, single and bulk (Docs/1039 §4) | `t-cf-<id>`, `c-cf-<id>` | `happyfox://ticket-custom-fields`, `happyfox://contact-custom-fields` |
| `update_ticket_custom_fields` (Docs/1039 §11) | `t-cf-<id>` only | `happyfox://ticket-custom-fields` |
| `staff_update`, `staff_pvtnote` (Docs/1039 §8-9) | `t-cf-<id>`, `ccf-<id>` | both custom field resources |
| Contacts (Docs/1092 §4) | `c-cf-<id>` | `happyfox://contact-custom-fields` |
| Assets (Docs/1201 §3) | nested `custom_fields` object keyed by bare id, e.g. `{"45": "GCJ1353"}` | `happyfox_list_asset_custom_fields` |

Ticket and contact fields are top-level payload keys. `customFieldEntries()` accepts only `<prefix><positive id>` keys; bare ids and any other key, such as `email` or `staff`, are rejected with `INVALID_ARGUMENT` before sending, so `custom_fields` cannot overwrite a core field. Values: text a string; number an integer or a float with at most 2 decimals; dropdown one choice id; multiple choice a list of choice ids; date `yyyy-mm-dd`. Asset number fields take integers only.

The `ccf-` prefix follows both field tables of Docs/1039 §8-9; the §8 example payload shows `c-cf-`. Unverified until tested against a live account. `POST /users/` resets every contact custom field the payload leaves out (Docs/1092 §4).

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
| 26 | Stored credentials retrievable for the token and accepted by `storedAuth()` | 401, code `401`, `WWW-Authenticate: Bearer error="invalid_token", resource_metadata=…` |
| 27 | Dispatch to `MCPServer.handleRequest` | **200** with the JSON-RPC response - unless it throws `InsufficientScopeError`: **403**, code `403`, `data.requiredScopes`, `WWW-Authenticate: Bearer error="insufficient_scope", scope="…", resource_metadata=…`; or `CredentialsRejectedError` (HappyFox 401): the grant is ended, then **401**, code `401`, `WWW-Authenticate: Bearer error="invalid_token", …` |

Two deliberate orderings: header presence and consistency (14-16) are checked **before** version support (19), so a client on the wrong revision receives the actionable `-32022` rather than an opaque `-32020`; and `Mcp-Name` (21-24) is checked **after** 19 for the same reason.

Everything *returned* by step 27 is HTTP **200**, including application-level `-32602` (unknown tool, unknown resource, bad cursor). That is what produces the 400-vs-200 split for `-32602` described in the error table below.

### Scope Failures Are HTTP 403, Not JSON-RPC Results

A request whose token lacks the scope for the operation gets **HTTP 403** with a `WWW-Authenticate: Bearer` challenge carrying `error="insufficient_scope"`, `scope="<what the operation needs>"` and `resource_metadata`, so the client can step up its authorization. Both scope checks follow that: `tools/call` on a tool the token's scopes do not cover (`ToolRegistry.callToolWithAuth`, which denies a registered tool missing from `TOOL_SCOPE_MAP` to every caller) and `resources/read` without `happyfox:read` (`MCPServer.handleResourceRead`). They throw `InsufficientScopeError` (`src/types/index.ts`), one of the two errors `MCPServer.handleRequest` lets escape; the other is `CredentialsRejectedError` (see Re-Authorization). The transport catches both and builds the challenge. The body uses the application-defined code `403` (`INSUFFICIENT_SCOPE`) with `data.requiredScopes` - outside the JSON-RPC reserved range, and equal to the HTTP status so the two can never disagree. Do **not** report a scope failure as an `isError` tool result, as `-32602`, or as `-32600`.

`resource_metadata` names the path-suffixed document (`/.well-known/oauth-protected-resource/mcp`), the same one `@cloudflare/workers-oauth-provider` names on its own 401s; `McpApiHandler.bearerChallenge` also builds the `invalid_token` challenges. Because `WWW-Authenticate` is not CORS-safelisted, `src/middleware/cors.ts` exposes it, since this server sets no `MCP-*` response headers. The library keeps the handler's CORS headers and appends `Retry-After` to `Access-Control-Expose-Headers` and `Origin` to `Vary`. On a response without `Access-Control-Allow-Origin`, such as the step-2 403, it reflects the request's `Origin`, which exposes only that error.

### Supported Methods

| Method | Notes |
|--------|-------|
| `server/discover` | **Mandatory** in this revision. Requires no OAuth scope |
| `tools/list` | Filtered by the caller's granted scopes; sorted by name; paginated |
| `tools/call` | Requires `Mcp-Name` matching `params.name`. A tool outside the token's scopes is HTTP 403 + challenge |
| `resources/list` | Paginated. Filtered by the caller's granted scopes: without `happyfox:read` the list is empty, never an error |
| `resources/read` | Requires `Mcp-Name` matching `params.uri`. Without `happyfox:read` it is HTTP 403 + challenge |

Anything else - `initialize`, `notifications/initialized`, `completion/complete`, `prompts/list`, `resources/templates/list`, `subscriptions/listen`, `ping`, `logging/setLevel`, `tasks/*` - is **404 Not Found** with `-32601`. The error message names `2026-07-28` and the supported methods, so a legacy client that POSTs `initialize` gets a diagnostic it can surface to its user. `MCPServer` keeps its own `default:` arm throwing `-32601`; it is unreachable over HTTP (the transport 404s first) and exists as defense in depth for direct callers.

`SERVER_INSTRUCTIONS` (`src/types/index.ts`, returned by `server/discover`) names every resource URI and every tool family, plus the age bounds: 1 minute for ticket custom fields, 15 minutes for the rest. `server.test.ts` and `resources/registry.test.ts` fail when a resource URI is missing from it.

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
| `ttlMs` / `cacheScope` | `tools/list`, `resources/list` | `900000` / `"private"` - scope-filtered, so caches must not be shared across authorization contexts |
| `ttlMs` / `cacheScope` | `resources/read` | The remaining lifetime of the reference-cache entry served, at most `900000` (`60000` for `ticket-custom-fields`) / `"private"` - per-HappyFox-account data |
| `ttlMs` / `cacheScope` | `tools/call` | **Absent.** `CallToolResult` is not cacheable; adding them would be as wrong as omitting them elsewhere |

Note the unit trap: `ReferenceCache.set` takes **seconds** (`REFERENCE_TTL_SECONDS` is `900`, and each resource's `ttlSeconds`), while `referenceCache.get()` and `ResourceRegistry.readResource()` return `ttlMs` in **milliseconds**. `CACHE_TTL_MS_DISCOVER` and `CACHE_TTL_MS_STANDARD` in `src/types/index.ts` are the only fixed millisecond values; `CACHE_TTL_MS_STANDARD` serves `tools/list` and `resources/list` only.

`server/discover` declares exactly `capabilities: { tools: {}, resources: {} }` - bare empty objects. `listChanged` and `subscribe` are deliberately **not** declared: this server implements no `subscriptions/listen` stream, the only place those notifications could be delivered in this revision, so advertising them would be a promise it cannot keep. `completions`, `prompts` and `logging` are not declared either.

### Response Behavior
- **Requests (with id)**: JSON-RPC response with `result` or `error`, HTTP 200 (or a transport status from the validation table)
- **Notifications (no id)**: HTTP 202 Accepted, no body, no header validation, no work performed. This revision defines no client-to-server notifications over Streamable HTTP
- **Tool execution errors**: HappyFox failures other than 401, and arguments an endpoint rejects before sending (`INVALID_ID`, `INVALID_ARGUMENT`). They are `isError: true` results with `_meta.statusCode` and `_meta.errorCode` merged alongside `serverInfo`. Unprefixed `_meta` key names are legal - the prefix segment is optional
- **Scope failures**: never a result and never a `-326xx` error - HTTP 403 with a challenge
- **HappyFox 401**: never a result - HTTP 401 with an `invalid_token` challenge, after the grant is ended
- **Protocol errors**: JSON-RPC `error`, which carries neither `resultType` nor `_meta`. `MCPServer` passes a thrown value through as a JSON-RPC error only when it is a non-`Error` object with a numeric `code` and a string `message` (`isMCPError`); anything else becomes `-32603`

### Error Codes

| Scenario | HTTP Status | JSON-RPC Error |
|----------|-------------|----------------|
| Invalid Origin | 403 | N/A (plain text) |
| Non-POST method on `/mcp` | 405 | N/A (plain text, `Allow: POST, OPTIONS`) |
| Server misconfigured (`CREDENTIAL_ENCRYPTION_KEY`) | 500 | -32603 |
| Credential retrieval failed (re-authorization needed) | 401 + `WWW-Authenticate` `invalid_token` | 401 (application-defined) |
| HappyFox rejected the stored key (HappyFox 401 on `tools/call` or `resources/read`) | 401 + `WWW-Authenticate` `invalid_token`; grant ended | 401 (application-defined) |
| Token lacks the scope for the tool / resource | **403** + `WWW-Authenticate` `insufficient_scope`, `scope=…` | 403 (application-defined) with `data.requiredScopes` |
| Invalid JSON | 400 | -32700 |
| Batch request, bad envelope, `id: null`, bad `Accept`/`Content-Type` | 400 | -32600 |
| Unknown method | **404** | -32601 |
| Missing/malformed `params`, `_meta`, protocolVersion, clientCapabilities; `Mcp-Name` present but `params.name` / `params.uri` absent | **400** | -32602 |
| Unknown tool, unknown resource (with `data.uri`), invalid cursor | **200** | -32602 |
| HappyFox failure on `resources/read` (429, 403, 5xx, redirect, non-JSON or wrong-shape 2xx, network) | **200** | -32603 with `data: { uri, statusCode, errorCode }` |
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
- **Tickets** (15): create_ticket, create_tickets_bulk, list_tickets, get_ticket, update_ticket_tags, update_ticket_custom_fields, update_ticket_properties, move_ticket_category, add_staff_reply, add_private_note, add_contact_reply, forward_ticket, subscribe_to_ticket, unsubscribe_from_ticket, delete_ticket
- **Contacts & groups** (10): create_contact, upsert_contacts_bulk, list_contacts, get_contact, update_contact, get_contact_group, create_contact_group, update_contact_group, add_contacts_to_group, remove_contacts_from_group
- **Assets** (8): list_assets, get_asset, create_asset, update_asset, delete_asset, list_asset_custom_fields, get_asset_custom_field, get_asset_type
- **Reports** (7): get_report_summary, get_report_tabular_data, get_report_response_stats, get_report_staff_performance, get_report_staff_activity, get_report_contact_activity, get_report_sla_performance
- **Knowledge base** (2): get_kb_article, get_kb_section
- **Ticket field choices** (1): update_ticket_custom_field_choices

All 43 are registered with the `happyfox_` prefix and must appear in `TOOL_SCOPE_MAP` (`src/oauth/services/scope-enforcer.ts`) with the smallest scope that fits the scope table - a tool missing from that map is denied to every caller and never appears in `tools/list`. `test/unit/mcp/tools/registry.test.ts` enforces that every registered tool has an entry, that a tool with a `staff_id` property maps to `staff_id` in `TOOLS_REQUIRING_STAFF_ID`, and that every mapped parameter exists in the tool's schema. Name any new tool family in `SERVER_INSTRUCTIONS`.

Tool descriptions and schemas are all the model sees, so they state documented formats exactly: a ticket, group, asset or custom field id is a positive integer as a number or digit string, and a contact id may also be an email address.

### Tool Behaviour Worth Knowing

- **Paged lists** (`list_tickets`, `list_contacts`, `list_assets`, `list_asset_custom_fields` and the paged report views): `page` and `size` must be positive integers, as numbers or digit strings, or the call fails with `INVALID_ARGUMENT` before sending. `pageQuery()` and `positiveInteger()` in `src/happyfox/endpoints/pagination.ts` check them
- **list_tickets**: a query without `status` sends `status=_all`, the documented search form. `category` is a list sent as repeated `category=` keys; `sort_by` must be one of the 22 documented values. The query goes out as given, so spaces become `+` (HappyFox's encoded space) and a literal `+` becomes `%2B`; write terms space-separated, as in `assignee:none status:"In Progress"`. The search syntax is Docs/1039 §2 (Filter fields) and §2.1, the sort values are under "Sorting list of tickets", and `QUERY_DESCRIPTION` in `src/mcp/tools/tickets.ts` is the model-facing summary. Time filters take `yyyy/mm/dd`; the one custom date field example uses `mm/dd/yyyy`
- **create_ticket**: the schema requires `category` and `subject`; the endpoint also requires `text` or `html`, and either `client` (an existing contact id) or `name` and `email`, refusing `client` together with either. Optional fields are checked, not dropped: `text` and `html` must be strings, `tags`, `cc` and `bcc` are lists of non-empty strings, `due_date` is `yyyy-mm-dd` or `dd/mm/yyyy`, `visible_only_staff` is a boolean, and `phone` and `created_at` are strings
- **Bulk and group lists** (`create_tickets_bulk`, `upsert_contacts_bulk`, `add_contacts_to_group`, `remove_contacts_from_group`): the first three take at most 100 items. HappyFox's per-item list is returned as is when any item succeeded; when every item failed the result is `isError` with `API_ERROR` and text naming each item's error, e.g. `No tickets were created. tickets[1]: category: This field is required.` Items are named by their 0-based index in the list argument (`tickets`, `contacts` or `contact_ids`), as the endpoint's own validation errors name them
- **add_staff_reply**: exactly one of `html` or `plaintext`. The contact is emailed only when `update_customer` is `true` (HappyFox's default is false). `time_spent` is required in categories with `time_spent_mandatory`
- **update_ticket_properties**: the property-only `staff_update` of Docs/1039 §8.1 - status, priority, assignee (`null` unassigns), time_spent, due_date, tags and `t-cf-`/`ccf-` custom fields, with no message and no notification
- **Concurrent staff updates**: Docs/1039 §8 does not support concurrent `staff_update` calls on one ticket. Both staff_update tools say so; the adapter does not serialize them
- **create_contact**: an upsert. `POST /users/` edits the contact that already has the email and resets every custom field not sent. It needs `name` plus `email` or `phones`, and sends `email: null` for a phone-only contact. `is_login_enabled` goes out as the strings `"TRUE"` / `"FALSE"` (Docs/1092 §7). No contact tool takes `contact_groups`, and a call that sends it anyway, as older schemas offered, is refused with `INVALID_ARGUMENT` pointing to `add_contacts_to_group`; membership changes only through `add_contacts_to_group` and `remove_contacts_from_group`. A phone `id` is refused here and in `upsert_contacts_bulk`: those tools only add phones, and `update_contact` edits them
- **update_contact**: a phone with an `id` edits that phone and needs its `type`. Both documented phone edits send the contact's email (Docs/1092 §4 Example 2, §14), so when `email` is not given the endpoint sends the email `contact_id` names, or reads the contact first and sends its current email, `null` for a phone-only contact
- **Per-item lists**: `create_tickets_bulk`, `upsert_contacts_bulk` and `add_contacts_to_group` do not promise input order, since Docs/1039 §5 and Docs/1092 §5 and §12 state none. A failed ticket entry names no ticket, so the bulk ticket description says to check with `list_tickets` that a ticket was not created before resending it. The contact descriptions say to match bulk results by email or id, and to read the group with `get_contact_group` when an add fails
- **list_contacts**: `query` is space-separated `field:value` terms over name, email, phone, created_since and updated_since. A `+` right after `phone:` is stripped, as Docs/1092 §2 requires
- **update_contact_group**: sends only `description` and `tagged_domains`, the fields Docs/1092 §11 lists. The group cannot be renamed, so a `name` argument is refused with `INVALID_ARGUMENT` rather than dropped. `tagged_domains` is sent comma-separated, and `[]` sends `""` to remove every domain
- **add_contacts_to_group**: POSTs a top-level array `[{contact, access_tickets?}]` (Docs/1092 §12)
- **create_asset**: requires `asset_type_id`, `name` (at most 200 characters) and `display_id`, so an asset never lands in HappyFox's "first asset type" fallback. `list_assets` and `list_asset_custom_fields` default `size` to 50, the documented maximum. New contacts on an asset take `name` plus `email` or `phones`; the phone key is assumed (see Unverified Behaviour)
- **Report tools**: the summary takes no period filter (Docs/1088 §9 lists none for it). Every other view takes `period_type` (cr, as, str, cur, prs, srp, cl) together with `period_date_range_type` (sr, tod, l7d, mtd, ytd, pm). `period_start` and `period_end` are `yyyy-mm-dd`, imply `sr` when the range type is omitted, are both required for `sr`, are refused with any other range, and must satisfy start ≤ end. The tabular, staff performance, staff activity and contact activity views send `size` (at most 50, default 50) and `page` (default 1); the tabular view takes `sort_key` (ticket, status, created, duedate, assigned) and `sort_dir` (a, d), and the staff and contact views send `sort_key=name` with `sort_dir`
- **KB tools**: `GET /kb/article/<id>` and `/kb/section/<id>` go out without a trailing slash, as Docs/360 §6 writes them; on a `REDIRECT` the endpoint retries once with the slash. Only external articles can be fetched singly
- **update_ticket_custom_field_choices**: `PUT /ticket_custom_field/<id>/` with `{choices: [{id | null, text, dependant_fields}]}` (Docs/1247). The list is the field's complete new set: HappyFox deletes every choice left out, so an empty list and repeated ids are refused. Every choice must carry the `id` key, `null` for a new one; a choice without it is refused, since sending it as new would delete the existing choice and re-add it under a new id. An existing choice must carry its `dependant_fields`; a new one defaults to `[]`. Its schema accepts any `dependant_fields` item, since Docs/1247 shows only empty lists, but still declares `items`, which OpenAI function calling requires of every array

### Resources vs Tools

An endpoint that takes **no parameters at all** - no query parameter and no path id - is exposed as a **Resource** (application- or user-controlled, cached). An endpoint with a path id, filtering or pagination, and every write operation, is exposed as a **Tool** (model-controlled). The read endpoints that are tools make the rule concrete: `GET /tickets/` (`q`, `status`, `category`, `sort`, `minify_response`, `fields`, `page`, `size`), `GET /users/` (`q`, `page`, `size`), `GET /assets/` (`asset_type`, `page`, `size`), `GET /asset_custom_fields/` (`asset_type`, `page`, `size`), and every single-item read such as `GET /asset_type/<id>/`, `GET /asset_custom_field/<id>/`, `GET /kb/article/<id>` and the seven `GET /report/<id>/...` views.

`/asset_types/` and `/reports/` document no parameters yet answer in pages, so their resources merge every page into one array.

| URI | Description | HappyFox Endpoint |
|-----|-------------|-------------------|
| `happyfox://categories` | Ticket categories | `GET /categories/` |
| `happyfox://statuses` | Ticket statuses | `GET /statuses/` |
| `happyfox://priorities` | Ticket priorities | `GET /priorities/` |
| `happyfox://ticket-custom-fields` | Ticket custom field metadata (cached 1 minute) | `GET /ticket_custom_fields/` |
| `happyfox://contact-custom-fields` | Contact custom field metadata | `GET /user_custom_fields/` |
| `happyfox://staff` | Staff/agents list | `GET /staff/` |
| `happyfox://contact-groups` | Contact groups | `GET /contact_groups/` |
| `happyfox://asset-types` | Asset type definitions, every page merged | `GET /asset_types/` |
| `happyfox://reports` | Saved reports, every page merged | `GET /reports/` |
| `happyfox://kb-articles` | External knowledge base articles export | `GET /kb/articles/` |
| `happyfox://kb-internal-articles` | Internal knowledge base articles export | `GET /kb/internal-articles/` |
| `happyfox://kb-sections` | Knowledge base sections export | `GET /kb/sections/` |

Every resource URI is a flat `happyfox://{name}`, because `{name}` is the reference-cache key and must match `[a-z0-9-]+`; that is why the URI is `kb-articles`, not `kb/articles`. Each returns `application/json` text:

- The first seven return a bare JSON array (`listOf(path)` in the registry). Six are documented that way; `/priorities/` has no documented response and is assumed to match.
- `asset-types` and `reports` return one array merging `data` (or `rows`) from every page, not the page envelope. Later pages are requested as `?page=2` … `page_count` with `page` alone; a `page_count` over 50 is refused, and so is a page that repeats listed ids, as it would if HappyFox ignored `page`.
- The three KB exports return any JSON object or array as HappyFox sends it, since Docs/360 §6 shows no body; a bare value is refused.

A body of any other shape, and any HappyFox error, is neither returned nor cached. Every resource description states its shape and its age bound, and every URI appears in `SERVER_INSTRUCTIONS` and in the home page's resource list.

### Staff ID

`TOOLS_REQUIRING_STAFF_ID` in `src/oauth/services/scope-enforcer.ts` maps each tool that needs an acting agent to the parameter that carries it. Every ticket tool's parameter is `staff_id`; on the wire it becomes `staff` for `staff_update` (`add_staff_reply`, `update_ticket_properties`), `staff_pvtnote` and `update_custom_fields`, and stays `staff_id` for `update_tags`, `move`, `forward`, `delete`, `subscribe` and `unsubscribe`. The asset tools use `created_by` (create) and `updated_by` (update) in the JSON body, and `deleted_by` (delete) in the query string (Docs/1201 §3-5). Tools whose endpoints document no acting agent, such as `add_contact_reply` (its `user` is the contact), the contact tools, reports, the knowledge base and `update_ticket_custom_field_choices` (Docs/1247), are not in the map.

**Auto-Injection**: `injectStaffId()` fills that parameter with the `staff_id` resolved during the OAuth consent flow whenever the caller left it `undefined` or `null`.

The consenting agent's id is a default attribution, not a permission boundary: the key is account-wide, and a caller may name another agent, whose role HappyFox then applies. Role requirements the docs name: moving a ticket needs a move permission (Docs/1039 §16, shown only as an image), deleting an asset needs an active agent with Manage Assets (Docs/1201 §5), and creating contacts through an asset needs Manage all Contacts (Docs/1201 §3-4). `ROLE_REQUIREMENTS` in `src/oauth/services/happyfox-validator.ts`, keyed by tool name with the scope taken from `TOOL_SCOPE_MAP`, turns the first two into consent warnings; no documented permission code is confirmed to match Manage all Contacts.

### Attachments and Other Limits

- File attachments are **not supported**. The HappyFox API requires multipart/form-data for attachments, which is not implemented, so no tool takes an attachment or file parameter: not ticket creation, replies, notes, inline attachments (Docs/1039 §6) or the forward's `ticket_attachments`. Attachment URLs inside `get_ticket` results expire after 5 minutes (Docs/1039 §7).
- Docs/1092 documents no endpoint that deletes a contact or a contact group.
- Bulk ticket creation, bulk contact upserts and group additions take at most 100 items per request.

### Unverified Behaviour

Each of these is unverified until tested against a live account:

- The status HappyFox returns for a disabled key (401 is assumed, and it ends the grant).
- `ccf-` versus `c-cf-` for contact fields in `staff_update` and `staff_pvtnote`.
- Phone edits: `update_contact` posts to `/user/<id>/` as Docs/1092 §14 does, while Docs/1092 §4 says to use `/users/`. Whether HappyFox needs the `email` both documented payloads carry, and whether a phone edit without `type` resets it to other. Whether `POST /user/<id>/` resets custom fields it leaves out.
- The `GET /priorities/` response shape, and the date format a custom date field search takes.
- The order of per-item results from `POST /tickets/` and `POST /users/` lists and `update_contacts`.
- Whether `staff_update` `tags` replace the ticket's tags or add to them, and whether asset `contact_ids` / `contact_group_ids` on update replace or extend the current links. The descriptions say so.
- Whether `/reports/` and `/asset_types/` honour `page`, whether the staff and contact report views honour `size` and `page`, and the KB export shapes.
- `assignee:none` and `assignee:any`, which read Docs/1039's `--` as a bullet.
- Whether `unresponded`, `breached` and `duedate` are `q` terms or bare URL parameters. Docs/1039 §2 marks only `has_attachments` as a search parameter, and `QUERY_DESCRIPTION` teaches all four as `q` terms.
- The phone key of a new asset contact: `create_asset` and `update_asset` send the Docs/1092 §4 `phones` list, and `email: null` for a phone-only contact, since Docs/1201 §3-4 names neither.
- The success bodies of `staff_pvtnote`, `user_reply` and `update_custom_fields` (Docs/1039 §9-11), the login toggle and the contact group edit (Docs/1092 §7, §11), which the docs do not show. An empty one is reported as `INVALID_RESPONSE`.

## TypeScript Configuration

The project uses Cloudflare Workers' built-in TypeScript support - no build step required. Wrangler compiles TypeScript on-the-fly during development and deployment.

## Toolchain Notes

- **`compatibility_date`**: `2026-09-26`, matching the `workerd` bundled with Wrangler 4.143. Bump it together with Wrangler and `@cloudflare/vitest-plugin`, which pins its own Wrangler, so local dev, tests and production run one runtime. Rerun `npx wrangler types` afterwards.
- **Node.js compatibility**: any date from 2026-08-04 enables `nodejs_compat` and `nodejs_compat_v2`, so `process`, `Buffer` and Node timers exist at runtime. Do not list either flag; workerd rejects a flag its date already enables. `src` uses no Node APIs, and `wrangler types`' advice to install `@types/node` does not apply.
- **`@cloudflare/workers-types` vs generated types**: `tsconfig.json` uses the published `@cloudflare/workers-types` package; `worker-configuration.d.ts` is generated by `wrangler types` and embeds a full copy of the runtime types. Do **not** load both in one program - they collide. Wrangler now recommends the generated file; switching is a separate change.

## Testing Notes (Vitest 4 / vitest-plugin 1.3)

- **Config is a Vite plugin.** `vitest.config.mts` uses `cloudflareTest({...})` from `@cloudflare/vitest-plugin` (the renamed `@cloudflare/vitest-pool-workers`) inside `plugins`, not `defineWorkersConfig`. The file must be `.mts` - the package is ESM-only and the project has no `"type": "module"`.
- **Use `cloudflare:workers`, not `cloudflare:test`**, whose `env` and `SELF` are deprecated: `import { env, exports } from "cloudflare:workers"`; the entry point is `exports.default.fetch(...)`, not `SELF.fetch(...)`. `test/env.d.ts` declares `Cloudflare.GlobalProps.mainModule` so `exports.default` is typed.
- **`exports.default.fetch` follows redirects** like a service binding, so pass `redirect: "manual"` to observe the consent 302. Integration tests register an OAuth client in the test KV with `getOAuthApi({..., resourceMetadata: { resource: "https://worker.test/mcp" } }, env).createClient({ tokenEndpointAuthMethod: "none", redirectUris: [...] })`, then drive consent, code exchange, refresh and `/api/validate-staff`, whose requests send a matching `csrf_token` cookie and `X-CSRF-Token` header. The token id is the first `:`-separated segment of an access token.
- **There is no `fetchMock`.** `test/helpers/fetch-mock.ts` is a local shim over `globalThis.fetch` that keeps the slice of undici's MockAgent API the suite uses (`get(origin).intercept({path, method}).reply(...)` / `.replyWithError(...)`, `assertNoPendingInterceptors()`). It also fills in response reason phrases, which the `Response` constructor leaves blank but undici set. It records every request, matched or not, through `fetchMock.requests()` / `lastRequest()` (method, url, path, query, headers, body, `json()`, redirect), and never follows a redirect.
- **HappyFox mocks** (`test/helpers/fetch-mock-helpers.ts`) match the API path exactly: a path without `?` matches any query, a path with `?` must match exactly. `mockHappyFoxRaw(method, path, status, body, headers)` serves redirects, HTML and empty bodies; `mockRateLimitResponse(path, method, region, headers)` serves a 429 with `Retry-After`; `sentHappyFoxRequests()` / `lastHappyFoxRequest()` add `apiPath`. Assert the wire shape with `lastHappyFoxRequest().json()`, `.query` and `.headers`.
- **Endpoint tests** use `createMockClient()`; injection cases draw on `INJECTION_IDS` / `MALFORMED_IDS` from `test/helpers/invalid-ids.ts` and assert the client was `not.toHaveBeenCalled()`. Every behaviour change needs a test asserting the documented request shape (path, method, query, body).
- **Success fixtures copy the documented response shapes** from `Docs/`, so a test never locks in a shape HappyFox does not send. `/priorities/` documents no response, so its fixture follows the assumed bare array.
- **Resource registry tests** clear the Cache API with `referenceCache.invalidate(auth, key)`, not raw URLs, because the key includes a credential hash.
- **Unhandled rejections fail the run.** When a promise is expected to reject while fake timers advance, attach the assertion *before* advancing (see the retry tests in `test/unit/happyfox/client.test.ts`).
- Storage isolation is per test file.
- **Vitest 5 is not supported** by any `@cloudflare/vitest-plugin` release yet (every one peers `vitest ^4.1.0`), so Vitest and `@vitest/coverage-istanbul` stay on 4.x.
- Use `globalThis`, not `global`.
- Tests are not covered by `npm run typecheck` (it is `src` only). Check them with `npx tsc --noEmit -p test/tsconfig.json`. That config sets `"exclude": []` to undo the root config's `exclude: ["test"]`; without it the program is empty and typechecks nothing.

## Environment Variables

Set under `vars` in `wrangler.jsonc`. Every deploy replaces the Worker's plain-text variables with that block, so a variable added only in the dashboard is removed by the next deploy:
- `ALLOWED_ORIGINS` - Comma-separated browser origins allowed to call `/mcp`; `*` matches any port. Set to `http://localhost:*,https://localhost:*`, which is also the code's default when the variable is absent. A request without an `Origin` header is always allowed

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
        "name":"happyfox_list_tickets","arguments":{"query":"assignee:none status:\"In Progress\""},"_meta":{
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
| `tools/call` (write) | `happyfox_add_staff_reply` | `"name":"happyfox_add_staff_reply","arguments":{"ticket_id":123,"plaintext":"Reply message","update_customer":true}`. Requires `happyfox:write`; `staff_id` is auto-injected when omitted. `ticket_id` is the ticket number, not the display id, and the contact is emailed only with `update_customer` true |

A conforming client MAY send `Mcp-Name` sentinel-encoded instead; the server decodes it before comparing, so this is equivalent to the plain form above:

```bash
  -H "Mcp-Name: =?base64?aGFwcHlmb3g6Ly9jYXRlZ29yaWVz?="
```

Useful negative checks: dropping `Mcp-Method` gives 400 `-32020`; naming an older revision in both the header and `_meta` gives 400 `-32022`; `initialize` gives **404** `-32601`; `GET`/`DELETE` on `/mcp` gives 405 with a valid token (401 without one); calling `happyfox_delete_ticket` with a token that lacks `happyfox:admin` gives **403** with `WWW-Authenticate: Bearer realm="OAuth", resource_metadata="…/.well-known/oauth-protected-resource/mcp", error="insufficient_scope", error_description="…", scope="happyfox:admin"`; `happyfox_get_ticket` with `"ticket_id":"#DC00000003"` gives an `isError` result with `_meta.errorCode` `INVALID_ID` and no HappyFox call.

## Project Structure

```
Docs/
├── <id>-<slug>.md              # HappyFox's API articles as Markdown: the API reference
└── sync.py                     # uv run Docs/sync.py refreshes them from the HappyFox knowledge base
src/
├── index.ts                    # Worker entry point: OAuth provider, consent flow, McpApiHandler validation pipeline
├── types/
│   └── index.ts               # Protocol constants, error codes, _meta keys, SERVER_INSTRUCTIONS, result/envelope types
├── views/
│   ├── home.ts                # Read-only home page served at /
│   └── escape-html.ts         # escapeHtml() shared by the home and consent pages
├── oauth/
│   ├── types.ts               # OAuthProps, StoredCredentials, scopes and SCOPE_DESCRIPTIONS, credential TTL
│   ├── services/
│   │   ├── credential-store.ts    # AES-256-GCM credential storage, decodeEncryptionKey, storedAuth
│   │   ├── grant-revalidation.ts  # revalidateOnRefresh: re-checks key and agent on every refresh
│   │   ├── happyfox-validator.ts  # Staff resolution, checkStaffStatus, permissionWarnings (ROLE_REQUIREMENTS)
│   │   └── scope-enforcer.ts      # TOOL_SCOPE_MAP, TOOLS_REQUIRING_STAFF_ID, staff_id injection
│   └── views/
│       └── consent.ts         # OAuth consent page HTML (Pico CSS)
├── cache/
│   └── reference-cache.ts     # Cache API copy of the resources, keyed by host and credentials
├── mcp/
│   ├── server.ts              # MCP protocol handler (server/discover, tools/*, resources/*)
│   ├── headers.ts             # Mcp-Name =?base64?…?= sentinel decoding
│   ├── tools/
│   │   ├── registry.ts        # Tool registration, scope enforcement, staff_id injection, HappyFox 401 handling
│   │   └── tickets.ts, contacts.ts, assets.ts, reports.ts, knowledge-base.ts, ticket-field-choices.ts
│   └── resources/
│       └── registry.ts        # Resource SOURCES, shape checks, page merging, caching
├── happyfox/
│   ├── client.ts              # HTTP client: redirects, response checks, retries
│   ├── errors.ts              # HappyFoxAPIError, formatErrorBody
│   ├── host.ts                # REGIONS, ACCOUNT_NAME_PATTERN, parseApiHost, isValidAccount, apiHostFor
│   ├── paths.ts               # idSegment, contactSegment, assertSafePath
│   └── endpoints/
│       ├── tickets.ts, contacts.ts, assets.ts, reports.ts, knowledge-base.ts, ticket-field-choices.ts
│       ├── custom-fields.ts   # customFieldEntries, customFieldsSchema, value formats
│       ├── pagination.ts      # positiveInteger, pageQuery for page and size
│       └── phones.ts          # formatPhones() shared by contacts and assets
└── middleware/
    └── cors.ts                # CORS handling with MCP headers and Origin validation

test/
├── env.d.ts                     # Cloudflare.GlobalProps so exports.default is typed
├── tsconfig.json                # Extends the root config with "exclude": []
├── unit/
│   ├── transport/mcp-handler.test.ts   # Header/_meta pipeline (drives McpApiHandler directly)
│   ├── mcp/                            # server, headers, tools/registry, resources/registry
│   ├── happyfox/                       # client (retry/backoff), errors, host, paths
│   │   └── endpoints/                  # tickets, contacts, assets, custom-fields, reports, knowledge-base, ticket-field-choices
│   ├── oauth/                          # services/{credential-store,grant-revalidation,happyfox-validator}, views/consent
│   ├── cache/reference-cache.test.ts
│   ├── views/home.test.ts
│   ├── middleware/cors.test.ts
│   └── types/errors.test.ts
├── integration/worker.test.ts   # OAuth endpoints, consent, code exchange, refresh, validate-staff, unauthenticated /mcp
└── helpers/
    ├── json-rpc.ts              # 2026-07-28 request/header builders
    ├── client-mock.ts           # HappyFoxClient stub
    ├── fetch-mock.ts            # globalThis.fetch mock that records every request
    ├── fetch-mock-helpers.ts    # HappyFox API mocking utilities
    └── invalid-ids.ts           # INJECTION_IDS, MALFORMED_IDS
```
