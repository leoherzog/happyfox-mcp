/**
 * Type definitions for HappyFox MCP Adapter
 */

// Cloudflare Worker environment variables
export interface Env {
  ALLOWED_ORIGINS?: string;
  MCP_SESSION_SECRET: string;  // Required for session token signing (HMAC-SHA256)
}

// MCP Protocol version (2025-11-25 Streamable HTTP - no backwards compat)
export const MCP_PROTOCOL_VERSION = '2025-11-25';

// Session token payload structure (stateless signed token)
export interface MCPSessionPayload {
  v: string;    // Negotiated protocol version
  iat: number;  // Issued at timestamp (seconds since epoch)
  exp: number;  // Expiration timestamp (seconds since epoch)
  caps: string; // Capability hash (e.g., "resources,tools")
}

// Session validation result
export interface SessionValidationResult {
  valid: boolean;
  payload?: MCPSessionPayload;
  error?: 'missing' | 'invalid' | 'expired' | 'malformed';
}

// HappyFox authentication credentials (from URL params)
export interface HappyFoxAuth {
  apiKey: string;
  authCode: string;
  accountName: string;
  region: 'us' | 'eu';
}

// JSON-RPC 2.0 request structure (requests MUST have an id, which can be null per spec)
export interface MCPRequest {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, any>;
  id: string | number | null;
}

// JSON-RPC 2.0 notification structure (notifications do NOT have an id)
export interface MCPNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, any>;
}

// Union type for incoming messages
export type MCPMessage = MCPRequest | MCPNotification;

// JSON-RPC 2.0 response structure
export interface MCPResponse {
  jsonrpc: '2.0';
  result?: any;
  error?: MCPError;
  id: string | number | null;
}

// JSON-RPC error format
export interface MCPError {
  code: number;
  message: string;
  data?: any;
}

// MCP Tool definition
export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
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

// MCP Resource definition
export interface MCPResource {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

// MCP Resource content
export interface MCPResourceContent {
  uri: string;
  mimeType: string;
  text: string;
}

