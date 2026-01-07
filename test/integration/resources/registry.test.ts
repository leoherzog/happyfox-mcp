import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { SELF, fetchMock } from "cloudflare:test";
import { resourceReadRequest } from "../../helpers/json-rpc";
import { getSessionToken, createSessionAuthHeaders } from "../../fixtures/auth";
import { mockHappyFoxGet, resetFetchMock } from "../../helpers/fetch-mock-helpers";

describe("Resource Registry", () => {
  let sessionId: string;

  beforeAll(async () => {
    resetFetchMock();
    sessionId = await getSessionToken();
  });

  beforeEach(() => {
    resetFetchMock();
  });

  afterEach(() => {
    // Don't assert pending interceptors - some tests may fail before API is called
  });

  describe("happyfox://categories", () => {
    it("reads categories resource", async () => {
      mockHappyFoxGet("/categories/", [
        { id: 1, name: "Support" },
        { id: 2, name: "Sales" }
      ]);

      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: createSessionAuthHeaders(sessionId),
        body: JSON.stringify(resourceReadRequest("happyfox://categories"))
      });

      const body = await response.json() as Record<string, unknown>;
      const result = body.result as Record<string, unknown>;
      const contents = result.contents as Array<Record<string, unknown>>;

      expect(contents).toHaveLength(1);
      expect(contents[0].uri).toBe("happyfox://categories");
      expect(contents[0].mimeType).toBe("application/json");

      const data = JSON.parse(contents[0].text as string);
      expect(data).toHaveLength(2);
    });
  });

  describe("happyfox://statuses", () => {
    it("reads statuses resource", async () => {
      mockHappyFoxGet("/statuses/", [
        { id: 1, name: "Open", behavior: "pending" },
        { id: 2, name: "Closed", behavior: "closed" }
      ]);

      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: createSessionAuthHeaders(sessionId),
        body: JSON.stringify(resourceReadRequest("happyfox://statuses"))
      });

      const body = await response.json() as Record<string, unknown>;
      const result = body.result as Record<string, unknown>;
      const contents = result.contents as Array<Record<string, unknown>>;

      expect(contents[0].uri).toBe("happyfox://statuses");

      const data = JSON.parse(contents[0].text as string);
      expect(data).toHaveLength(2);
    });
  });

  describe("happyfox://ticket-custom-fields", () => {
    it("reads ticket custom fields resource", async () => {
      mockHappyFoxGet("/ticket_custom_fields/", [
        { id: 1, name: "Product", type: "dropdown" },
        { id: 2, name: "Version", type: "text" }
      ]);

      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: createSessionAuthHeaders(sessionId),
        body: JSON.stringify(resourceReadRequest("happyfox://ticket-custom-fields"))
      });

      const body = await response.json() as Record<string, unknown>;
      const result = body.result as Record<string, unknown>;
      const contents = result.contents as Array<Record<string, unknown>>;

      expect(contents[0].uri).toBe("happyfox://ticket-custom-fields");
    });
  });

  describe("happyfox://contact-custom-fields", () => {
    it("reads contact custom fields resource", async () => {
      mockHappyFoxGet("/user_custom_fields/", [
        { id: 1, name: "Company", type: "text" }
      ]);

      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: createSessionAuthHeaders(sessionId),
        body: JSON.stringify(resourceReadRequest("happyfox://contact-custom-fields"))
      });

      const body = await response.json() as Record<string, unknown>;
      const result = body.result as Record<string, unknown>;
      const contents = result.contents as Array<Record<string, unknown>>;

      expect(contents[0].uri).toBe("happyfox://contact-custom-fields");
    });
  });

  describe("happyfox://staff", () => {
    it("reads staff resource", async () => {
      mockHappyFoxGet("/staff/", {
        data: [
          { id: 1, name: "Agent One", email: "agent1@company.com" },
          { id: 2, name: "Agent Two", email: "agent2@company.com" }
        ]
      });

      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: createSessionAuthHeaders(sessionId),
        body: JSON.stringify(resourceReadRequest("happyfox://staff"))
      });

      const body = await response.json() as Record<string, unknown>;
      const result = body.result as Record<string, unknown>;
      const contents = result.contents as Array<Record<string, unknown>>;

      expect(contents[0].uri).toBe("happyfox://staff");
    });
  });

  describe("happyfox://contact-groups", () => {
    it("reads contact groups resource", async () => {
      mockHappyFoxGet("/contact_groups/", {
        data: [
          { id: 1, name: "VIP Customers" },
          { id: 2, name: "Partners" }
        ]
      });

      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: createSessionAuthHeaders(sessionId),
        body: JSON.stringify(resourceReadRequest("happyfox://contact-groups"))
      });

      const body = await response.json() as Record<string, unknown>;
      const result = body.result as Record<string, unknown>;
      const contents = result.contents as Array<Record<string, unknown>>;

      expect(contents[0].uri).toBe("happyfox://contact-groups");
    });
  });

  describe("happyfox://asset-types", () => {
    it("reads asset types resource", async () => {
      mockHappyFoxGet("/asset_types/", [
        { id: 1, name: "Laptop" },
        { id: 2, name: "Monitor" }
      ]);

      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: createSessionAuthHeaders(sessionId),
        body: JSON.stringify(resourceReadRequest("happyfox://asset-types"))
      });

      const body = await response.json() as Record<string, unknown>;
      const result = body.result as Record<string, unknown>;
      const contents = result.contents as Array<Record<string, unknown>>;

      expect(contents[0].uri).toBe("happyfox://asset-types");
    });
  });

  describe("Error Handling", () => {
    it("returns error for unknown resource", async () => {
      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: createSessionAuthHeaders(sessionId),
        body: JSON.stringify(resourceReadRequest("happyfox://unknown-resource"))
      });

      const body = await response.json() as Record<string, unknown>;
      const error = body.error as Record<string, unknown>;

      expect(error.code).toBe(-32602);
      expect(error.message).toContain("Resource not found");
    });

    it("handles API errors gracefully", async () => {
      mockHappyFoxGet("/categories/", { error: "Unauthorized" }, 401);

      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: createSessionAuthHeaders(sessionId),
        body: JSON.stringify(resourceReadRequest("happyfox://categories"))
      });

      // Resource reading errors should still return a JSON-RPC error
      const body = await response.json() as Record<string, unknown>;
      expect(body.error).toBeDefined();
    });
  });
});
