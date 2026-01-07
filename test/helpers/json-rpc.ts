import type { MCPRequest, MCPNotification } from "../../src/types";

export function createRequest(
  method: string,
  params?: Record<string, unknown>,
  id: string | number | null = 1
): MCPRequest {
  const request: MCPRequest = {
    jsonrpc: "2.0",
    method,
    id
  };
  if (params !== undefined) {
    request.params = params;
  }
  return request;
}

export function createNotification(
  method: string,
  params?: Record<string, unknown>
): MCPNotification {
  const notification: MCPNotification = {
    jsonrpc: "2.0",
    method,
  };
  if (params !== undefined) {
    notification.params = params;
  }
  return notification;
}

export function createBatchRequest(requests: (MCPRequest | MCPNotification)[]) {
  return requests;
}

// MCP 2025-11-25 Protocol Version
export const MCP_PROTOCOL_VERSION = "2025-11-25";

// Common MCP requests
export const initializeRequest = (protocolVersion = MCP_PROTOCOL_VERSION, id: string | number | null = 1) =>
  createRequest("initialize", { protocolVersion }, id);

// Helper for creating session headers (MCP 2025-11-25)
export function createSessionHeaders(sessionId: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "Accept": "application/json, text/event-stream",
    "MCP-Session-Id": sessionId,
    "MCP-Protocol-Version": MCP_PROTOCOL_VERSION
  };
}

// Helper for creating MCP headers without session (for testing session validation)
export function createMCPHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "Accept": "application/json, text/event-stream",
    "MCP-Protocol-Version": MCP_PROTOCOL_VERSION
  };
}

export const toolsListRequest = (cursor?: string, id: string | number | null = 1) =>
  createRequest("tools/list", cursor ? { cursor } : {}, id);

export const toolCallRequest = (name: string, args: Record<string, unknown>, id: string | number | null = 1) =>
  createRequest("tools/call", { name, arguments: args }, id);

export const resourcesListRequest = (id: string | number | null = 1) =>
  createRequest("resources/list", {}, id);

export const resourceReadRequest = (uri: string, id: string | number | null = 1) =>
  createRequest("resources/read", { uri }, id);
