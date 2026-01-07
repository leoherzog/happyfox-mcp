# Streamable HTTP Migration Plan

## Goal
Move from MCP 2024-11-05 (HTTP+SSE era) to the current MCP spec that uses Streamable HTTP (protocol revision 2025-11-25), while keeping the Worker stateless and compatible with existing MCP clients.

This project only supports request/response tools/resources and does not use server-initiated notifications. That means we can remain stateless and still be spec-compliant for the features we advertise.

---

## Why Streamable HTTP Works on Cloudflare Workers
Streamable HTTP is a **single endpoint** transport that uses HTTP POST for client->server messages and optional Server-Sent Events (SSE) for streaming responses or server-initiated messages. Critically:

- **Responses can be returned on the same POST** (either normal JSON or streaming SSE in the POST response). This means a stateless Worker can handle a request end-to-end without needing to route responses across instances.
- **GET is optional** and only needed if the server wants to push server-initiated messages outside a request/response flow.
- Workers support streaming responses via the Streams API, so returning SSE or chunked streaming from a POST is feasible.

**Implication for this project:** As long as we are not implementing server-initiated notifications (like subscriptions), we do **not** need Durable Objects. If we later add push-style notifications, Durable Objects (or another stateful coordinator) becomes the right solution.

---

## Spec Changes We Must Follow (2025-11-25)
The key changes from 2024-11-05 that affect our implementation:

1. **Transport**
   - Single MCP endpoint supporting **POST and GET**.
   - POST request body must be a single JSON-RPC request/notification/response (not a batch).
   - Client POST must include `Accept: application/json, text/event-stream`.
   - GET is optional; used for SSE streams and server-initiated messages.

2. **Session Management**
   - Server may return `MCP-Session-Id` in initialize response.
   - Client must include `MCP-Session-Id` on subsequent requests.
   - Optional: server can allow DELETE to end a session.

3. **Protocol Version Header**
   - HTTP clients must include `MCP-Protocol-Version` on all requests after initialization.
   - If missing, server should assume 2025-03-26 (per spec).

4. **Lifecycle Enforcement**
   - `initialize` must be the first interaction.
   - Client must send `notifications/initialized` after initialize.
   - Server should not send requests before that (we do not send any server-initiated requests today).

5. **Security**
   - Server must validate `Origin` when present and reject invalid origins with 403.

---

## Recommended Session Management (Stateless)
**Recommendation:** Use a signed, stateless session token in `MCP-Session-Id`.

### Why this works here
- We only need session *continuity* (to know initialization happened and what version was negotiated), not server-initiated push.
- Stateless tokens avoid Durable Objects and keep the Worker simple.

### Suggested token contents
- `v`: negotiated protocol version
- `iat` / `exp`: issued-at and expiration timestamps
- `caps`: server capability hash (or a fixed marker)
- Optional: a hash of clientInfo (for debugging)

### Signing & storage
- Use HMAC (SHA-256) with a secret from `env.MCP_SESSION_SECRET`.
- No server-side storage required.

### Enforcement behavior
- On `initialize`, mint the token and return it in `MCP-Session-Id` header.
- For other requests:
  - If `MCP-Session-Id` missing and we require sessions, return HTTP 400.
  - If invalid/expired, return HTTP 401 or 404 (if we treat it as “terminated”).

### `notifications/initialized`
We can accept and ignore this notification (as today) because we do not send server-initiated requests. If we later add server-initiated messages, we will need stricter tracking (see “Durable Objects” below).

---

## When Durable Objects Become Necessary
Durable Objects are needed if we add any of the following:

- **Server-initiated notifications or requests** (e.g., `resources/subscribe`, `tools/listChanged`).
- **Long-lived GET SSE streams** with messages that arrive later from POSTs or background jobs.
- **Strict enforcement** of “initialized” before other operations, without relying on stateless tokens.

If we add these features, we should put the MCP endpoint behind a DO that:
- accepts the GET SSE stream,
- receives forwarded POSTs,
- and routes responses or notifications back to the right open stream.

---

## Code Changes Required

### 1) Transport handling (`src/index.ts`)
- **Allow GET** at the MCP endpoint.
- **Honor Accept headers** for POST; respond with JSON (initially) and consider streaming when requested.
- **Handle DELETE** (optional) to terminate sessions (can respond 405 if we skip). 
- **Enforce `MCP-Protocol-Version` header** on all non-initialize requests.
- **Enforce `MCP-Session-Id`** if we decide sessions are required.
- **Origin validation**: if `Origin` is present and not in allowlist, return 403 per spec.

### 2) Protocol version and lifecycle (`src/mcp/server.ts`)
- Update `SUPPORTED_PROTOCOL_VERSION` to `2025-11-25`.
- Enforce that `initialize` is the first request on a session.
- Decide how to handle batch input:
  - Spec says Streamable HTTP POST is a single message, so we should reject arrays in strict mode.
  - For compatibility, we can allow batches behind a flag or keep current behavior.

### 3) Types & headers (`src/types/index.ts`, `src/middleware/cors.ts`)
- Update types/comments to match the 2025-11-25 constraints (request IDs should be non-null).
- CORS allowlist should include headers:
  - `MCP-Session-Id`, `MCP-Protocol-Version`, `Accept`, `Last-Event-ID`
  - Existing HappyFox auth headers

### 4) Docs & examples
- Update `AGENTS.md` and curl examples to:
  - use the new protocol version,
  - include `MCP-Protocol-Version` and `MCP-Session-Id`.

---

## Migration Plan (Phased)

### Phase 1: Dual-stack (compat mode)
- Keep current POST behavior (JSON, no GET) but add:
  - `MCP-Protocol-Version` header handling,
  - session token support,
  - updated initialize response.
- Continue to accept batch payloads for backwards compatibility.

### Phase 2: Streamable HTTP compliance
- Enforce `Accept` header and single-message POST.
- Add GET handler for SSE (even if it only streams responses to the same request in the short term).
- Add DELETE (optional) for session termination.

### Phase 3: Deprecate 2024-11-05
- Remove legacy HTTP+SSE assumptions in docs.
- Optionally reject older protocol versions unless explicitly enabled.

---

## Summary Recommendation
- **Adopt MCP 2025-11-25 Streamable HTTP now.**
- **Use stateless, signed `MCP-Session-Id`** tokens to keep the Worker simple.
- **Skip Durable Objects** until we add server-initiated features or long-lived GET SSE streams.

---

## References
- MCP 2025-11-25 Streamable HTTP transport: https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
- MCP 2025-11-25 lifecycle requirements: https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle
- Cloudflare Workers Streams API: https://developers.cloudflare.com/workers/runtime-apis/streams/
- Cloudflare Durable Objects best practices: https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/
