import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { SELF, fetchMock } from "cloudflare:test";
import { toolCallRequest } from "../../helpers/json-rpc";
import { getSessionToken, createSessionAuthHeaders } from "../../fixtures/auth";
import { mockHappyFoxGet, mockHappyFoxPost, resetFetchMock } from "../../helpers/fetch-mock-helpers";

describe("Ticket Tools", () => {
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

  describe("happyfox_list_tickets", () => {
    it("returns tickets with default pagination", async () => {
      mockHappyFoxGet("/tickets/", {
        data: [
          { id: 1, subject: "Test Ticket 1", status: { name: "Open" } },
          { id: 2, subject: "Test Ticket 2", status: { name: "Closed" } }
        ],
        page_info: { count: 2, page: 1, pages: 1 }
      });

      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: createSessionAuthHeaders(sessionId),
        body: JSON.stringify(toolCallRequest("happyfox_list_tickets", {}))
      });

      const body = await response.json() as Record<string, unknown>;
      const result = body.result as Record<string, unknown>;
      const content = result.content as Array<Record<string, unknown>>;

      expect(result.isError).toBeUndefined();
      expect(content[0].type).toBe("text");

      const data = JSON.parse(content[0].text as string);
      expect(data.data).toHaveLength(2);
    });

    it("passes filter parameters", async () => {
      mockHappyFoxGet("/tickets/", { data: [], page_info: { count: 0 } });

      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: createSessionAuthHeaders(sessionId),
        body: JSON.stringify(toolCallRequest("happyfox_list_tickets", {
          category: "1",
          status: "2",
          page: 1,
          size: 25
        }))
      });

      expect(response.status).toBe(200);
    });
  });

  describe("happyfox_get_ticket", () => {
    it("returns ticket details", async () => {
      mockHappyFoxGet("/ticket/123/", {
        id: 123,
        subject: "Test Ticket",
        status: { id: 1, name: "Open" },
        priority: { id: 2, name: "Medium" },
        category: { id: 1, name: "Support" }
      });

      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: createSessionAuthHeaders(sessionId),
        body: JSON.stringify(toolCallRequest("happyfox_get_ticket", { ticket_id: "123" }))
      });

      const body = await response.json() as Record<string, unknown>;
      const result = body.result as Record<string, unknown>;

      expect(result.isError).toBeUndefined();

      const content = result.content as Array<Record<string, unknown>>;
      const data = JSON.parse(content[0].text as string);
      expect(data.id).toBe(123);
      expect(data.subject).toBe("Test Ticket");
    });
  });

  describe("happyfox_create_ticket", () => {
    it("creates a new ticket", async () => {
      mockHappyFoxPost("/tickets/", {
        id: 999,
        subject: "New Ticket",
        status: { id: 1, name: "Open" }
      });

      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: createSessionAuthHeaders(sessionId),
        body: JSON.stringify(toolCallRequest("happyfox_create_ticket", {
          category: "1",
          subject: "New Ticket",
          text: "Ticket description",
          email: "customer@example.com",
          name: "Customer Name"
        }))
      });

      const body = await response.json() as Record<string, unknown>;
      const result = body.result as Record<string, unknown>;

      expect(result.isError).toBeUndefined();
    });
  });

  describe("happyfox_add_staff_reply", () => {
    it("adds a staff reply to ticket", async () => {
      mockHappyFoxPost("/ticket/123/staff_update/", {
        id: 456,
        text: "Staff reply message",
        staff: { id: 1, name: "Agent" }
      });

      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: createSessionAuthHeaders(sessionId),
        body: JSON.stringify(toolCallRequest("happyfox_add_staff_reply", {
          ticket_id: "123",
          staff_id: "1",
          text: "Staff reply message"
        }))
      });

      const body = await response.json() as Record<string, unknown>;
      const result = body.result as Record<string, unknown>;

      expect(result.isError).toBeUndefined();
    });
  });

  describe("happyfox_add_private_note", () => {
    it("adds a private note to ticket", async () => {
      mockHappyFoxPost("/ticket/123/staff_pvtnote/", {
        id: 789,
        text: "Private note content",
        staff: { id: 1, name: "Agent" }
      });

      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: createSessionAuthHeaders(sessionId),
        body: JSON.stringify(toolCallRequest("happyfox_add_private_note", {
          ticket_id: "123",
          staff_id: "1",
          text: "Private note content"
        }))
      });

      const body = await response.json() as Record<string, unknown>;
      const result = body.result as Record<string, unknown>;

      expect(result.isError).toBeUndefined();
    });
  });

  describe("Tool Execution Errors", () => {
    it("returns isError: true for 404 API errors", async () => {
      mockHappyFoxGet("/ticket/999/", { error: "Ticket not found" }, 404);

      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: createSessionAuthHeaders(sessionId),
        body: JSON.stringify(toolCallRequest("happyfox_get_ticket", { ticket_id: "999" }))
      });

      const body = await response.json() as Record<string, unknown>;
      const result = body.result as Record<string, unknown>;

      expect(result.isError).toBe(true);
      const content = result.content as Array<Record<string, unknown>>;
      expect((content[0].text as string)).toContain("Error:");
    });

    it("returns isError: true for 401 unauthorized", async () => {
      mockHappyFoxGet("/tickets/", { error: "Unauthorized" }, 401);

      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: createSessionAuthHeaders(sessionId),
        body: JSON.stringify(toolCallRequest("happyfox_list_tickets", {}))
      });

      const body = await response.json() as Record<string, unknown>;
      const result = body.result as Record<string, unknown>;

      expect(result.isError).toBe(true);
    });

    it("returns isError: true for 400 bad request", async () => {
      mockHappyFoxPost("/tickets/", { error: "Invalid parameters" }, 400);

      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: createSessionAuthHeaders(sessionId),
        body: JSON.stringify(toolCallRequest("happyfox_create_ticket", {
          category: "invalid",
          subject: "Test",
          text: "Test"
        }))
      });

      const body = await response.json() as Record<string, unknown>;
      const result = body.result as Record<string, unknown>;

      expect(result.isError).toBe(true);
    });
  });
});
