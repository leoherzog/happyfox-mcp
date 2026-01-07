import { SELF } from "cloudflare:test";
import type { HappyFoxAuth } from "../../src/types";
import { MCP_PROTOCOL_VERSION } from "../helpers/json-rpc";

export const mockAuth: HappyFoxAuth = {
  apiKey: "test-api-key",
  authCode: "test-auth-code",
  accountName: "testaccount",
  region: "us"
};

export const mockAuthEU: HappyFoxAuth = {
  apiKey: "test-api-key",
  authCode: "test-auth-code",
  accountName: "testaccount",
  region: "eu"
};

export const emptyAuth: HappyFoxAuth = {
  apiKey: "",
  authCode: "",
  accountName: "",
  region: "us"
};

export function createAuthHeaders(auth: HappyFoxAuth = mockAuth): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-HappyFox-ApiKey": auth.apiKey,
    "X-HappyFox-AuthCode": auth.authCode,
    "X-HappyFox-Account": auth.accountName,
    "X-HappyFox-Region": auth.region,
  };
}

/**
 * Get a session token for authenticated requests (MCP 2025-11-25)
 * Call this once per test file/describe block to get a valid session
 */
export async function getSessionToken(auth: HappyFoxAuth = mockAuth): Promise<string> {
  const response = await SELF.fetch("https://worker.test/", {
    method: "POST",
    headers: createAuthHeaders(auth),
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "initialize",
      params: { protocolVersion: MCP_PROTOCOL_VERSION },
      id: 1
    })
  });

  const sessionId = response.headers.get("MCP-Session-Id");
  if (!sessionId) {
    throw new Error("Failed to get session token from initialize response");
  }
  return sessionId;
}

/**
 * Create headers with session token for authenticated requests
 */
export function createSessionAuthHeaders(sessionId: string, auth: HappyFoxAuth = mockAuth): Record<string, string> {
  return {
    ...createAuthHeaders(auth),
    "MCP-Session-Id": sessionId,
    "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
    "Accept": "application/json, text/event-stream"
  };
}
