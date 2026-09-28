/**
 * Type definitions for HappyFox MCP Adapter
 *
 * MCP revision 2026-07-28 ("modern" era): stateless, no initialize handshake,
 * no sessions, no SSE. This server supports exactly one protocol revision.
 */

import packageJson from '../../package.json';

// ---------------------------------------------------------------------------
// Cloudflare Worker environment
// ---------------------------------------------------------------------------

export interface Env {
  ALLOWED_ORIGINS?: string;
  OAUTH_KV: KVNamespace;              // KV namespace for OAuth credential storage
  CREDENTIAL_ENCRYPTION_KEY: string;  // 32-byte base64 key for AES-256-GCM
}

// ---------------------------------------------------------------------------
// Protocol constants
// ---------------------------------------------------------------------------

/** The one and only protocol revision this server implements. */
export const MCP_PROTOCOL_VERSION = '2026-07-28';

/** Value of DiscoverResult.supportedVersions and of UnsupportedProtocolVersion data.supported. */
export const SUPPORTED_PROTOCOL_VERSIONS: readonly string[] = [MCP_PROTOCOL_VERSION];

/** RPC methods this server implements. Anything else is 404 + METHOD_NOT_FOUND. */
export const SUPPORTED_METHODS = [
  'server/discover',
  'tools/list',
  'tools/call',
  'resources/list',
  'resources/read',
] as const;

type SupportedMethod = (typeof SUPPORTED_METHODS)[number];

export function isSupportedMethod(method: string): method is SupportedMethod {
  return (SUPPORTED_METHODS as readonly string[]).includes(method);
}

/** Methods that carry a required Mcp-Name header (from params.name / params.uri). */
export const METHODS_REQUIRING_MCP_NAME: readonly string[] = ['tools/call', 'resources/read'];

// ---------------------------------------------------------------------------
// Error codes
//
// -32000..-32019 (legacy) MUST NOT be emitted. Of the spec-reserved
// -32020..-32099 range, only the codes below are used.
// ---------------------------------------------------------------------------

export const PARSE_ERROR = -32700;
export const INVALID_REQUEST = -32600;
export const METHOD_NOT_FOUND = -32601;
export const INVALID_PARAMS = -32602;
export const INTERNAL_ERROR = -32603;

// -32021 (MissingRequiredClientCapability) is absent: this server requires no
// client capability, so it can never emit that code.
export const HEADER_MISMATCH = -32020;
export const UNSUPPORTED_PROTOCOL_VERSION = -32022;

// OAuth-layer failures the transport reports as HTTP 401/403 with a
// `WWW-Authenticate` challenge. Deliberately outside the JSON-RPC reserved
// range, and equal to the HTTP status they always accompany, so body and status can never disagree.
export const UNAUTHORIZED = 401;
export const INSUFFICIENT_SCOPE = 403;

// ---------------------------------------------------------------------------
// Reserved `_meta` keys
// ---------------------------------------------------------------------------

export const META_PROTOCOL_VERSION = 'io.modelcontextprotocol/protocolVersion';
export const META_CLIENT_INFO = 'io.modelcontextprotocol/clientInfo';
export const META_CLIENT_CAPABILITIES = 'io.modelcontextprotocol/clientCapabilities';
export const META_SERVER_INFO = 'io.modelcontextprotocol/serverInfo';

// ---------------------------------------------------------------------------
// Cache hints, in milliseconds (ReferenceCache stores seconds - do not mix)
// ---------------------------------------------------------------------------

/** server/discover: identical for every caller. */
export const CACHE_TTL_MS_DISCOVER = 3_600_000;
/** tools/list, resources/list, resources/read: matches the 15-minute reference cache. */
export const CACHE_TTL_MS_STANDARD = 900_000;

// ---------------------------------------------------------------------------
// Server identity
// ---------------------------------------------------------------------------

/** Emitted in every result's `_meta` under META_SERVER_INFO. */
export const SERVER_INFO: Implementation = {
  name: 'happyfox-mcp',
  version: packageJson.version,
};

/** Optional natural-language guidance returned by server/discover. */
export const SERVER_INSTRUCTIONS =
  'HappyFox helpdesk adapter. Call tools/list to see the tools the caller\'s OAuth scopes ' +
  'grant, and resources/list for cached HappyFox reference data (categories, statuses, ' +
  'priorities, staff). This server is stateless: every request must carry its own ' +
  'MCP-Protocol-Version, Mcp-Method and params._meta.';

// ---------------------------------------------------------------------------
// Identity / capability shapes
// ---------------------------------------------------------------------------

interface Implementation {
  name: string;
  version: string;
}

/** This server requires none of these; the object is accepted opaquely. */
type ClientCapabilities = Record<string, unknown>;

interface ServerCapabilities {
  tools?: Record<string, unknown>;
  resources?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Request `_meta` / params
// ---------------------------------------------------------------------------

export interface RequestMetaObject {
  progressToken?: string | number;
  /** REQUIRED. */
  [META_PROTOCOL_VERSION]: string;
  /** Optional - a request without it is legal and MUST be tolerated. */
  [META_CLIENT_INFO]?: Implementation;
  /** REQUIRED (usually `{}`). */
  [META_CLIENT_CAPABILITIES]: ClientCapabilities;
  [key: string]: unknown;
}

/** `params` is structurally REQUIRED on every request in this revision. */
interface RequestParams {
  _meta: RequestMetaObject;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Result `_meta` / result shapes
// ---------------------------------------------------------------------------

export interface ResultMetaObject {
  [META_SERVER_INFO]?: Implementation;
  [key: string]: unknown;
}

/** The core protocol also defines "input_required"; this server never emits it. */
type ResultType = 'complete';

export interface MCPResult {
  resultType: ResultType;
  _meta?: ResultMetaObject;
  [key: string]: unknown;
}

type CacheScope = 'public' | 'private';

export interface CacheableResult extends MCPResult {
  ttlMs: number;
  cacheScope: CacheScope;
}

export interface DiscoverResult extends CacheableResult {
  supportedVersions: string[];
  capabilities: ServerCapabilities;
  instructions?: string;
}

export interface ListToolsResult extends CacheableResult {
  tools: MCPTool[];
  nextCursor?: string;
}

export interface ListResourcesResult extends CacheableResult {
  resources: MCPResource[];
  nextCursor?: string;
}

export interface ReadResourceResult extends CacheableResult {
  contents: MCPResourceContent[];
}

interface TextContent {
  type: 'text';
  text: string;
  _meta?: Record<string, unknown>;
}

/** This server produces text blocks only. */
type ContentBlock = TextContent;

/** NOT a CacheableResult: tools/call results MUST NOT carry ttlMs/cacheScope. */
export interface CallToolResult extends MCPResult {
  content: ContentBlock[];
  structuredContent?: unknown;
  isError?: boolean;
}

// ---------------------------------------------------------------------------
// JSON-RPC envelope
// ---------------------------------------------------------------------------

/** Requests MUST have a string or number id. Unlike base JSON-RPC, null is INVALID. */
export interface MCPRequest {
  jsonrpc: '2.0';
  method: string;
  params: RequestParams;
  id: string | number;
}

/** `id` is omitted (never null) when the request id could not be read. */
export interface MCPResponse {
  jsonrpc: '2.0';
  result?: MCPResult;
  error?: MCPError;
  id?: string | number;
}

export interface MCPError {
  code: number;
  message: string;
  data?: unknown;
}

/** data payload for UNSUPPORTED_PROTOCOL_VERSION: both fields REQUIRED. */
export interface UnsupportedProtocolVersionData {
  supported: string[];
  requested: string;
}

// ---------------------------------------------------------------------------
// HappyFox / OAuth domain types (protocol-neutral, unchanged)
// ---------------------------------------------------------------------------

export interface HappyFoxAuth {
  apiKey: string;
  authCode: string;
  accountName: string;
  region: 'us' | 'eu';
}

export interface AuthContext {
  credentials: HappyFoxAuth;
  staffId: number;
  scopes: string[];
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface MCPResource {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

export interface MCPResourceContent {
  uri: string;
  mimeType: string;
  text: string;
}

// Custom error class for tool-not-found (protocol error)
export class ToolNotFoundError extends Error {
  constructor(toolName: string) {
    super(`Tool not found: ${toolName}`);
    this.name = 'ToolNotFoundError';
  }
}

// Custom error class for tool execution failures (returns isError: true)
export class ToolExecutionError extends Error {
  public statusCode?: number;
  public errorCode?: string;

  constructor(message: string, statusCode?: number, errorCode?: string) {
    super(message);
    this.name = 'ToolExecutionError';
    this.statusCode = statusCode;
    this.errorCode = errorCode;
  }
}

// Custom error class for resource-not-found (protocol error)
export class ResourceNotFoundError extends Error {
  constructor(uri: string) {
    super(`Resource not found: ${uri}`);
    this.name = 'ResourceNotFoundError';
  }
}

/**
 * Granted OAuth scopes do not cover the operation. Not a JSON-RPC outcome: it
 * propagates to the transport, which answers HTTP 403 + WWW-Authenticate.
 */
export class InsufficientScopeError extends Error {
  public requiredScopes: string[];

  constructor(message: string, requiredScopes: string[]) {
    super(message);
    this.name = 'InsufficientScopeError';
    this.requiredScopes = requiredScopes;
  }
}
