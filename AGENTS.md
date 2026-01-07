# AGENTS.md

This file provides guidance to Claude, Codex, Gemini, etc when working with code in this repository.

## Project Overview

HappyFox MCP Adapter - A serverless Cloudflare Worker that implements the Model Context Protocol (MCP) 2025-11-25 Streamable HTTP transport to bridge MCP-compatible clients with the HappyFox REST API.

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
MCP Client → Cloudflare Worker → Session Validation → MCP Server → Tool/Resource Registry → HappyFox Client → HappyFox API
                                                                            ↓
                                                                    Reference Cache (Cache API)
```

### Core Components

- **MCP Server** (`src/mcp/server.ts`): Handles JSON-RPC 2.0 protocol, routes MCP methods to appropriate handlers
- **Session Token Manager** (`src/session/token.ts`): Stateless HMAC-SHA256 signed session tokens (1-hour TTL)
- **Tool Registry** (`src/mcp/tools/registry.ts`): Manages 25+ tools across Tickets, Contacts, Categories, and Staff modules
- **Resource Registry** (`src/mcp/resources/registry.ts`): Provides 8 reference data resources with caching
- **HappyFox Client** (`src/happyfox/client.ts`): HTTP client with exponential backoff for rate limiting (429 responses)
- **Reference Cache** (`src/cache/reference-cache.ts`): Uses Cloudflare Cache API to cache reference data (15 min TTL)
- **CORS Middleware** (`src/middleware/cors.ts`): Handles CORS with MCP-specific headers and origin validation

### Authentication

**HappyFox Credentials (via Headers):**
- `X-HappyFox-ApiKey` - HappyFox API key
- `X-HappyFox-AuthCode` - HappyFox auth code
- `X-HappyFox-Account` - HappyFox account subdomain
- `X-HappyFox-Region` - (Optional) "us" or "eu" (default: "us")

**MCP Session (MCP 2025-11-25):**
- Sessions are initiated via `initialize` request
- Server returns `MCP-Session-Id` header on successful initialize
- Subsequent requests must include `MCP-Session-Id` header
- Sessions are stateless (HMAC-SHA256 signed tokens with 1-hour TTL)
- Invalid/expired sessions return HTTP 404
- **Security**: Signature verification uses constant-time comparison (`crypto.subtle.verify`)
- **Version Binding**: Session tokens are bound to protocol version; tokens created with a different version are rejected

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

## MCP Protocol Implementation (2025-11-25)

### Protocol Version
- **Supported Version**: `2025-11-25` (only version supported)
- **No Backwards Compatibility**: Requests with `protocolVersion: "2024-11-05"` are rejected with error -32602

### HTTP Methods
| Method | Behavior |
|--------|----------|
| POST | Process MCP messages |
| GET | 405 Method Not Allowed (SSE not implemented) |
| DELETE | 202 Accepted (session termination acknowledged) |
| OPTIONS | 204 Preflight response |

### Required Headers (Post-Initialize)

For all requests after `initialize`, the following headers are **strictly validated**:

| Header | Required | Validation |
|--------|----------|------------|
| `MCP-Session-Id` | Yes | Must be valid, unexpired session token |
| `MCP-Protocol-Version` | Yes | Must exactly match `2025-11-25` |
| `Accept` | Yes | Must include `application/json` or `*/*` |
| `Content-Type` | Yes | Must be `application/json` |

**Validation Order**: Headers are validated in this order: MCP-Protocol-Version → Accept → MCP-Session-Id. The first validation failure returns immediately.

### Supported Methods
- `initialize` - Protocol handshake (returns session token in header)
- `initialized` / `notifications/initialized` - Notification (requires session, returns HTTP 204)
- `tools/list`, `tools/call` - Tool discovery and execution (requires session)
- `resources/list`, `resources/read` - Resource discovery and reading (requires session)
- `completion/complete` - Autocomplete (stub, requires session)

### Message Format (No Batch Support)
- **Single Messages Only**: MCP 2025-11-25 does not support batch requests
- **Batch Rejection**: Array payloads return HTTP 400 with error -32600 "Batch requests not supported"

### Response Behavior
- **Requests (with id)**: Return JSON-RPC response with result or error
- **Notifications (no id)**: Return HTTP 204 No Content
- **Tool Errors**: Returns `isError: true` in result with `_meta.statusCode` and `_meta.errorCode`
- **Protocol Errors**: Returns JSON-RPC error (e.g., -32602 for unknown tool/resource)

### Error Codes
| Scenario | HTTP Status | JSON-RPC Error |
|----------|-------------|----------------|
| Server misconfigured (missing secret) | 500 | -32603 |
| Invalid Origin | 403 | N/A |
| Batch request | 400 | -32600 |
| Missing MCP-Protocol-Version header | 400 | -32600 |
| Wrong MCP-Protocol-Version value | 400 | -32602 |
| Missing Accept header | 400 | -32600 |
| Missing session (non-init) | 400 | -32000 |
| Invalid/expired session | 404 | -32001 |
| Unsupported protocol version (init) | 200 | -32602 |
| Invalid JSON | 400 | -32700 |
| Invalid request | 400 | -32600 |
| Method not found | 200 | -32601 |
| Invalid params | 200 | -32602 |

### Pagination
- `tools/list` and `resources/list` support cursor-based pagination (50 items per page)
- Pass `cursor` param to get next page

### Available Tool Categories
- **Tickets**: create, list, get, update, update_tags, update_custom_fields, move_category, staff_reply, private_note, history, forward, delete
- **Contacts**: create, list, get, update, get_tickets
- **Contact Groups**: get, create, update, add_contacts, remove_contacts
- **Assets**: list, get, create, update, delete, list_custom_fields, get_custom_field

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

**Important**: HappyFox API keys are account-wide credentials, not tied to specific staff members. There is no `/me` or `/current_user` endpoint to identify the authenticated user. Clients must determine their `staff_id` by:
1. Calling `happyfox_list_staff` and filtering by their known email address, or
2. Configuring the `staff_id` manually in their MCP client setup

### Attachment Support
File attachments are **not supported**. The HappyFox API requires multipart/form-data for attachments, which is not implemented. Attachment parameters have been removed from tool schemas.

### Resource URIs
All resources follow the pattern `happyfox://{resource-name}` and return JSON data from corresponding HappyFox endpoints. Resources are cached for 15 minutes.

## TypeScript Configuration

The project uses Cloudflare Workers' built-in TypeScript support - no build step required. Wrangler compiles TypeScript on-the-fly during development and deployment.

## Environment Variables

Set in `wrangler.toml` or Cloudflare Dashboard:
- `ALLOWED_ORIGINS` - (Optional) Comma-separated list of allowed CORS origins

**Required Secret** (set via `wrangler secret put`):
- `MCP_SESSION_SECRET` - Secret key for signing session tokens
  - **Minimum length**: 32 characters (validated at startup)
  - **Failure mode**: Returns HTTP 500 with error -32603 if missing or too short
  - **Generation**: Use `openssl rand -base64 32` or similar to generate a secure secret

## Testing MCP Endpoints (MCP 2025-11-25)

The request flow follows a session-based pattern:

```bash
# 1. Initialize (get session ID)
curl -X POST "http://localhost:8787" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "X-HappyFox-ApiKey: KEY" \
  -H "X-HappyFox-AuthCode: CODE" \
  -H "X-HappyFox-Account: ACCOUNT" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2025-11-25"},"id":1}'
# Response includes MCP-Session-Id header - save this for subsequent requests

# 2. Send initialized notification (returns HTTP 204, no body)
curl -X POST "http://localhost:8787" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "MCP-Session-Id: <session-id-from-step-1>" \
  -H "MCP-Protocol-Version: 2025-11-25" \
  -H "X-HappyFox-ApiKey: KEY" \
  -H "X-HappyFox-AuthCode: CODE" \
  -H "X-HappyFox-Account: ACCOUNT" \
  -d '{"jsonrpc":"2.0","method":"notifications/initialized"}'

# 3. List tools (with pagination)
curl -X POST "http://localhost:8787" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "MCP-Session-Id: <session-id>" \
  -H "MCP-Protocol-Version: 2025-11-25" \
  -H "X-HappyFox-ApiKey: KEY" \
  -H "X-HappyFox-AuthCode: CODE" \
  -H "X-HappyFox-Account: ACCOUNT" \
  -d '{"jsonrpc":"2.0","method":"tools/list","params":{"cursor":"0"},"id":2}'

# 4. Call a tool (list categories)
curl -X POST "http://localhost:8787" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "MCP-Session-Id: <session-id>" \
  -H "MCP-Protocol-Version: 2025-11-25" \
  -H "X-HappyFox-ApiKey: KEY" \
  -H "X-HappyFox-AuthCode: CODE" \
  -H "X-HappyFox-Account: ACCOUNT" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"happyfox_list_categories","arguments":{}},"id":3}'

# 5. Call a tool with staff_id (add staff reply)
curl -X POST "http://localhost:8787" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "MCP-Session-Id: <session-id>" \
  -H "MCP-Protocol-Version: 2025-11-25" \
  -H "X-HappyFox-ApiKey: KEY" \
  -H "X-HappyFox-AuthCode: CODE" \
  -H "X-HappyFox-Account: ACCOUNT" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"happyfox_add_staff_reply","arguments":{"ticket_id":"123","staff_id":"1","text":"Reply message"}},"id":4}'

# 6. Read a resource
curl -X POST "http://localhost:8787" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "MCP-Session-Id: <session-id>" \
  -H "MCP-Protocol-Version: 2025-11-25" \
  -H "X-HappyFox-ApiKey: KEY" \
  -H "X-HappyFox-AuthCode: CODE" \
  -H "X-HappyFox-Account: ACCOUNT" \
  -d '{"jsonrpc":"2.0","method":"resources/read","params":{"uri":"happyfox://categories"},"id":5}'

# 7. Terminate session (optional)
curl -X DELETE "http://localhost:8787" \
  -H "MCP-Session-Id: <session-id>"
# Returns HTTP 202 Accepted
```

## Project Structure

```
src/
├── index.ts                    # Cloudflare Worker entry point & transport layer
├── types/
│   └── index.ts               # TypeScript type definitions (incl. session types)
├── session/
│   └── token.ts               # Stateless HMAC-SHA256 session token manager
├── cache/
│   └── reference-cache.ts     # Cache API wrapper for reference data
├── mcp/
│   ├── server.ts              # MCP protocol handler
│   ├── tools/
│   │   ├── registry.ts        # Tool registration and dispatch
│   │   ├── tickets.ts         # Ticket tools
│   │   ├── contacts.ts        # Contact tools
│   │   ├── categories.ts      # Category/metadata tools
│   │   ├── staff.ts           # Staff tools
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
    └── cors.ts                # CORS handling with MCP headers

test/
├── unit/
│   ├── session/
│   │   └── token.test.ts      # Session token tests
│   ├── middleware/
│   │   └── cors.test.ts       # CORS middleware tests
│   └── types/
│       └── errors.test.ts     # Error handling tests
├── integration/
│   ├── worker.test.ts         # Transport layer tests (MCP 2025-11-25)
│   ├── json-rpc.test.ts       # JSON-RPC protocol tests
│   ├── mcp-protocol.test.ts   # MCP protocol compliance tests
│   ├── tools/                 # Tool integration tests
│   └── resources/             # Resource integration tests
├── fixtures/
│   └── auth.ts                # Test authentication helpers
└── helpers/
    ├── json-rpc.ts            # JSON-RPC request builders
    └── fetch-mock-helpers.ts  # HappyFox API mocking utilities
```
