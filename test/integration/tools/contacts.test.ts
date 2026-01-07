import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { SELF, fetchMock } from "cloudflare:test";
import { toolCallRequest } from "../../helpers/json-rpc";
import { getSessionToken, createSessionAuthHeaders } from "../../fixtures/auth";
import { mockHappyFoxGet, mockHappyFoxPost, resetFetchMock } from "../../helpers/fetch-mock-helpers";

describe("Contact Tools", () => {
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

  describe("happyfox_list_contacts", () => {
    it("returns contacts list", async () => {
      mockHappyFoxGet("/users/", {
        data: [
          { id: 1, name: "John Doe", email: "john@example.com" },
          { id: 2, name: "Jane Doe", email: "jane@example.com" }
        ],
        page_info: { count: 2, page: 1, pages: 1 }
      });

      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: createSessionAuthHeaders(sessionId),
        body: JSON.stringify(toolCallRequest("happyfox_list_contacts", {}))
      });

      const body = await response.json() as Record<string, unknown>;
      const result = body.result as Record<string, unknown>;

      expect(result.isError).toBeUndefined();

      const content = result.content as Array<Record<string, unknown>>;
      const data = JSON.parse(content[0].text as string);
      expect(data.data).toHaveLength(2);
    });

    it("supports search query parameter", async () => {
      mockHappyFoxGet("/users/", {
        data: [{ id: 1, name: "John Doe", email: "john@example.com" }],
        page_info: { count: 1 }
      });

      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: createSessionAuthHeaders(sessionId),
        body: JSON.stringify(toolCallRequest("happyfox_list_contacts", {
          q: "john"
        }))
      });

      expect(response.status).toBe(200);
    });
  });

  describe("happyfox_get_contact", () => {
    it("returns contact details", async () => {
      mockHappyFoxGet("/user/1/", {
        id: 1,
        name: "John Doe",
        email: "john@example.com",
        phone_numbers: [{ type: "work", number: "555-0100" }]
      });

      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: createSessionAuthHeaders(sessionId),
        body: JSON.stringify(toolCallRequest("happyfox_get_contact", { contact_id: "1" }))
      });

      const body = await response.json() as Record<string, unknown>;
      const result = body.result as Record<string, unknown>;

      expect(result.isError).toBeUndefined();

      const content = result.content as Array<Record<string, unknown>>;
      const data = JSON.parse(content[0].text as string);
      expect(data.id).toBe(1);
      expect(data.name).toBe("John Doe");
    });
  });

  describe("happyfox_create_contact", () => {
    it("creates a new contact", async () => {
      mockHappyFoxPost("/users/", {
        id: 100,
        name: "New Contact",
        email: "new@example.com"
      });

      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: createSessionAuthHeaders(sessionId),
        body: JSON.stringify(toolCallRequest("happyfox_create_contact", {
          name: "New Contact",
          email: "new@example.com"
        }))
      });

      const body = await response.json() as Record<string, unknown>;
      const result = body.result as Record<string, unknown>;

      expect(result.isError).toBeUndefined();
    });

    it("creates contact with phone numbers", async () => {
      mockHappyFoxPost("/users/", {
        id: 101,
        name: "Contact With Phone",
        email: "phone@example.com",
        phone_numbers: [{ type: "w", number: "555-0123" }]
      });

      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: createSessionAuthHeaders(sessionId),
        body: JSON.stringify(toolCallRequest("happyfox_create_contact", {
          name: "Contact With Phone",
          email: "phone@example.com",
          phones: [{ type: "work", number: "555-0123" }]
        }))
      });

      const body = await response.json() as Record<string, unknown>;
      const result = body.result as Record<string, unknown>;

      expect(result.isError).toBeUndefined();
    });
  });

  describe("happyfox_update_contact", () => {
    it("updates contact details", async () => {
      // HappyFox API uses POST for updates
      mockHappyFoxPost("/user/1/", {
        id: 1,
        name: "Updated Name",
        email: "john@example.com"
      });

      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: createSessionAuthHeaders(sessionId),
        body: JSON.stringify(toolCallRequest("happyfox_update_contact", {
          contact_id: "1",
          name: "Updated Name"
        }))
      });

      const body = await response.json() as Record<string, unknown>;
      const result = body.result as Record<string, unknown>;

      expect(result.isError).toBeUndefined();
    });
  });

  describe("Contact Groups", () => {
    describe("happyfox_create_contact_group", () => {
      it("creates a new contact group", async () => {
        mockHappyFoxPost("/contact_groups/", {
          id: 10,
          name: "New Group",
          description: "A new group"
        });

        const response = await SELF.fetch("https://worker.test/", {
          method: "POST",
          headers: createSessionAuthHeaders(sessionId),
          body: JSON.stringify(toolCallRequest("happyfox_create_contact_group", {
            name: "New Group",
            description: "A new group"
          }))
        });

        const body = await response.json() as Record<string, unknown>;
        const result = body.result as Record<string, unknown>;

        expect(result.isError).toBeUndefined();
      });
    });
  });
});
