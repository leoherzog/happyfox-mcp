/**
 * MCP 2026-07-28 request builders.
 *
 * The modern transport is stateless but strict: every POST carries the
 * `MCP-Protocol-Version` and `Mcp-Method` headers, `tools/call` and
 * `resources/read` additionally carry `Mcp-Name`, and the body must include a
 * `params._meta` block with the protocol version and the client capabilities.
 * These builders emit all of it so tests cannot drift from the wire contract by
 * accident.
 *
 * There is no session helper here, and there never should be again:
 * `Mcp-Session-Id` and `Last-Event-ID` are ignored by this server.
 */

import {
  MCP_PROTOCOL_VERSION,
  META_PROTOCOL_VERSION,
  META_CLIENT_INFO,
  META_CLIENT_CAPABILITIES,
  METHODS_REQUIRING_MCP_NAME,
  type MCPRequest,
  type RequestMetaObject,
} from "../../src/types";

export { MCP_PROTOCOL_VERSION };

const TEST_CLIENT_INFO = { name: "vitest", version: "0.0.0" };

export interface RequestOptions {
  /** JSON-RPC id. Pass `undefined` explicitly via createNotification for id-less bodies. */
  id?: string | number;
  /** Override the protocol version carried in `params._meta` (for mismatch tests). */
  metaProtocolVersion?: string;
  /** Omit `io.modelcontextprotocol/clientInfo` - its absence is legal. */
  omitClientInfo?: boolean;
  /** Omit `io.modelcontextprotocol/clientCapabilities` - its absence is NOT legal. */
  omitClientCapabilities?: boolean;
}

function createMeta(options: RequestOptions = {}): RequestMetaObject {
  const meta: Record<string, unknown> = {
    [META_PROTOCOL_VERSION]: options.metaProtocolVersion ?? MCP_PROTOCOL_VERSION,
  };
  if (!options.omitClientInfo) {
    meta[META_CLIENT_INFO] = TEST_CLIENT_INFO;
  }
  if (!options.omitClientCapabilities) {
    meta[META_CLIENT_CAPABILITIES] = {};
  }
  return meta as RequestMetaObject;
}

/** A complete, valid 2026-07-28 JSON-RPC request body. */
export function createRequest(
  method: string,
  params: Record<string, unknown> = {},
  options: RequestOptions = {}
): MCPRequest {
  return {
    jsonrpc: "2.0",
    method,
    id: options.id ?? 1,
    params: {
      ...params,
      _meta: createMeta(options),
    },
  };
}

/** An id-less body. This revision defines no client-to-server notifications; the server 202s it. */
export function createNotification(
  method: string,
  params: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    method,
    params: { ...params, _meta: createMeta() },
  };
}

export interface HeaderOptions {
  /** Override the MCP-Protocol-Version header (for header/body mismatch tests). */
  protocolVersion?: string;
  /** Override the Mcp-Method header value (for mismatch tests). */
  mcpMethod?: string;
  /** Override the Mcp-Name header value (e.g. with the =?base64?...?= sentinel). */
  mcpName?: string;
  /** Extra headers merged last. */
  extra?: Record<string, string>;
}

/**
 * The standard header set for a request. `Mcp-Name` is derived from
 * `params.name` / `params.uri` for the two methods that require it.
 */
export function createMCPHeaders(
  method: string,
  params: Record<string, unknown> = {},
  options: HeaderOptions = {}
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": options.protocolVersion ?? MCP_PROTOCOL_VERSION,
    "Mcp-Method": options.mcpMethod ?? method,
  };

  if (METHODS_REQUIRING_MCP_NAME.includes(method)) {
    const derived = method === "tools/call" ? params.name : params.uri;
    const name = options.mcpName ?? (typeof derived === "string" ? derived : undefined);
    if (name !== undefined) {
      headers["Mcp-Name"] = name;
    }
  } else if (options.mcpName !== undefined) {
    headers["Mcp-Name"] = options.mcpName;
  }

  return { ...headers, ...(options.extra ?? {}) };
}

/** Encode a value in the `=?base64?...?=` sentinel form a conforming client may use. */
export function base64Sentinel(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `=?base64?${btoa(binary)}?=`;
}
