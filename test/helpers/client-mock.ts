import { vi } from "vitest";
import { HappyFoxClient } from "../../src/happyfox/client";

export function createMockClient() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    makeRequest: vi.fn()
  } as unknown as HappyFoxClient;
}

export function mockClientResponse<T>(
  client: HappyFoxClient,
  method: "get" | "post" | "put" | "delete",
  response: T
) {
  (client[method] as any).mockResolvedValue(response);
}

export function mockClientError(
  client: HappyFoxClient,
  method: "get" | "post" | "put" | "delete",
  error: Error
) {
  (client[method] as any).mockRejectedValue(error);
}
