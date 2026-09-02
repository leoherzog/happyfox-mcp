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
