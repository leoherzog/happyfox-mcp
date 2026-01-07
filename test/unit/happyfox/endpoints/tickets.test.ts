import { describe, it, expect, vi, beforeEach } from "vitest";
import { TicketEndpoints } from "../../../../src/happyfox/endpoints/tickets";
import { createMockClient } from "../../../helpers/client-mock";

describe("TicketEndpoints", () => {
  let mockClient: ReturnType<typeof createMockClient>;
  let endpoints: TicketEndpoints;

  beforeEach(() => {
    mockClient = createMockClient();
    endpoints = new TicketEndpoints(mockClient as any);
  });

  describe("createTicket", () => {
    it("sends required fields", async () => {
      (mockClient.post as any).mockResolvedValue({ id: 1 });

      await endpoints.createTicket({
        category: "1",
        subject: "Test Subject",
        text: "Test content",
        email: "test@example.com",
        name: "Test User"
      });

      expect(mockClient.post).toHaveBeenCalledWith("/tickets/", {
        category: "1",
        subject: "Test Subject",
        text: "Test content",
        email: "test@example.com",
        name: "Test User"
      });
    });

    it("joins tags array with comma", async () => {
      (mockClient.post as any).mockResolvedValue({ id: 1 });

      await endpoints.createTicket({
        category: "1",
        subject: "Test",
        text: "Content",
        email: "test@example.com",
        name: "User",
        tags: ["urgent", "billing", "support"]
      });

      expect(mockClient.post).toHaveBeenCalledWith("/tickets/", expect.objectContaining({
        tags: "urgent,billing,support"
      }));
    });

    it("joins cc array with comma", async () => {
      (mockClient.post as any).mockResolvedValue({ id: 1 });

      await endpoints.createTicket({
        category: "1",
        subject: "Test",
        text: "Content",
        email: "test@example.com",
        name: "User",
        cc: ["cc1@example.com", "cc2@example.com"]
      });

      expect(mockClient.post).toHaveBeenCalledWith("/tickets/", expect.objectContaining({
        cc: "cc1@example.com,cc2@example.com"
      }));
    });

    it("joins bcc array with comma", async () => {
      (mockClient.post as any).mockResolvedValue({ id: 1 });

      await endpoints.createTicket({
        category: "1",
        subject: "Test",
        text: "Content",
        email: "test@example.com",
        name: "User",
        bcc: ["bcc1@example.com", "bcc2@example.com"]
      });

      expect(mockClient.post).toHaveBeenCalledWith("/tickets/", expect.objectContaining({
        bcc: "bcc1@example.com,bcc2@example.com"
      }));
    });

    it("spreads custom_fields into formData", async () => {
      (mockClient.post as any).mockResolvedValue({ id: 1 });

      await endpoints.createTicket({
        category: "1",
        subject: "Test",
        text: "Content",
        email: "test@example.com",
        name: "User",
        custom_fields: {
          "t-cf-1": "value1",
          "t-cf-2": "value2"
        }
      });

      expect(mockClient.post).toHaveBeenCalledWith("/tickets/", expect.objectContaining({
        "t-cf-1": "value1",
        "t-cf-2": "value2"
      }));
    });

    it("omits optional fields when not provided", async () => {
      (mockClient.post as any).mockResolvedValue({ id: 1 });

      await endpoints.createTicket({
        category: "1",
        subject: "Test",
        text: "Content",
        email: "test@example.com",
        name: "User"
      });

      const calledWith = (mockClient.post as any).mock.calls[0][1];
      expect(calledWith).not.toHaveProperty("phone");
      expect(calledWith).not.toHaveProperty("priority");
      expect(calledWith).not.toHaveProperty("assignee");
      expect(calledWith).not.toHaveProperty("tags");
      expect(calledWith).not.toHaveProperty("cc");
      expect(calledWith).not.toHaveProperty("bcc");
    });

    it("includes optional fields when provided", async () => {
      (mockClient.post as any).mockResolvedValue({ id: 1 });

      await endpoints.createTicket({
        category: "1",
        subject: "Test",
        text: "Content",
        email: "test@example.com",
        name: "User",
        phone: "555-1234",
        priority: "2",
        assignee: "5"
      });

      expect(mockClient.post).toHaveBeenCalledWith("/tickets/", expect.objectContaining({
        phone: "555-1234",
        priority: "2",
        assignee: "5"
      }));
    });
  });

  describe("listTickets", () => {
    it("sets default pagination (page=1, size=50)", async () => {
      (mockClient.get as any).mockResolvedValue({ data: [] });

      await endpoints.listTickets();

      expect(mockClient.get).toHaveBeenCalledWith("/tickets/", {
        page: 1,
        size: 50
      });
    });

    it("caps size at 50", async () => {
      (mockClient.get as any).mockResolvedValue({ data: [] });

      await endpoints.listTickets({ size: 100 });

      expect(mockClient.get).toHaveBeenCalledWith("/tickets/", expect.objectContaining({
        size: 50
      }));
    });

    it("allows size less than 50", async () => {
      (mockClient.get as any).mockResolvedValue({ data: [] });

      await endpoints.listTickets({ size: 10 });

      expect(mockClient.get).toHaveBeenCalledWith("/tickets/", expect.objectContaining({
        size: 10
      }));
    });

    it("maps query to 'q' parameter", async () => {
      (mockClient.get as any).mockResolvedValue({ data: [] });

      await endpoints.listTickets({ query: "search term" });

      expect(mockClient.get).toHaveBeenCalledWith("/tickets/", expect.objectContaining({
        q: "search term"
      }));
    });

    it("maps sort_by to 'sort' parameter", async () => {
      (mockClient.get as any).mockResolvedValue({ data: [] });

      await endpoints.listTickets({ sort_by: "created_at" });

      expect(mockClient.get).toHaveBeenCalledWith("/tickets/", expect.objectContaining({
        sort: "created_at"
      }));
    });

    it("joins fields array with comma", async () => {
      (mockClient.get as any).mockResolvedValue({ data: [] });

      await endpoints.listTickets({ fields: ["id", "subject", "status"] });

      expect(mockClient.get).toHaveBeenCalledWith("/tickets/", expect.objectContaining({
        fields: "id,subject,status"
      }));
    });

    it("includes all filter parameters", async () => {
      (mockClient.get as any).mockResolvedValue({ data: [] });

      await endpoints.listTickets({
        page: 2,
        size: 25,
        category: "1",
        status: "1",
        minify_response: true
      });

      expect(mockClient.get).toHaveBeenCalledWith("/tickets/", {
        page: 2,
        size: 25,
        category: "1",
        status: "1",
        minify_response: true
      });
    });
  });

  describe("getTicket", () => {
    it("fetches ticket by ID", async () => {
      (mockClient.get as any).mockResolvedValue({ id: 123 });

      await endpoints.getTicket("123");

      expect(mockClient.get).toHaveBeenCalledWith("/ticket/123/", undefined);
    });

    it("includes show_cf_changes when provided", async () => {
      (mockClient.get as any).mockResolvedValue({ id: 123 });

      await endpoints.getTicket("123", { show_cf_changes: true });

      expect(mockClient.get).toHaveBeenCalledWith("/ticket/123/", { show_cf_changes: true });
    });

    it("omits queryParams when empty", async () => {
      (mockClient.get as any).mockResolvedValue({ id: 123 });

      await endpoints.getTicket("123", {});

      expect(mockClient.get).toHaveBeenCalledWith("/ticket/123/", undefined);
    });
  });

  describe("updateTags", () => {
    it("joins add tags with comma", async () => {
      (mockClient.post as any).mockResolvedValue({ success: true });

      await endpoints.updateTags("123", { add: ["tag1", "tag2"] });

      expect(mockClient.post).toHaveBeenCalledWith("/ticket/123/update_tags/", {
        add: "tag1,tag2"
      });
    });

    it("joins remove tags with comma", async () => {
      (mockClient.post as any).mockResolvedValue({ success: true });

      await endpoints.updateTags("123", { remove: ["old1", "old2"] });

      expect(mockClient.post).toHaveBeenCalledWith("/ticket/123/update_tags/", {
        remove: "old1,old2"
      });
    });

    it("handles both add and remove", async () => {
      (mockClient.post as any).mockResolvedValue({ success: true });

      await endpoints.updateTags("123", {
        add: ["new"],
        remove: ["old"]
      });

      expect(mockClient.post).toHaveBeenCalledWith("/ticket/123/update_tags/", {
        add: "new",
        remove: "old"
      });
    });
  });

  describe("updateCustomFields", () => {
    it("passes fields directly", async () => {
      (mockClient.post as any).mockResolvedValue({ success: true });

      const fields = { "t-cf-1": "value1", "t-cf-2": 123 };
      await endpoints.updateCustomFields("123", fields);

      expect(mockClient.post).toHaveBeenCalledWith("/ticket/123/update_custom_fields/", fields);
    });
  });

  describe("moveCategory", () => {
    it("sends staff_id and target_category_id", async () => {
      (mockClient.post as any).mockResolvedValue({ success: true });

      await endpoints.moveCategory("123", 5, "2");

      expect(mockClient.post).toHaveBeenCalledWith("/ticket/123/move/", {
        staff_id: 5,
        target_category_id: "2"
      });
    });
  });

  describe("addStaffReply", () => {
    it("maps text to html field", async () => {
      (mockClient.post as any).mockResolvedValue({ id: 1 });

      await endpoints.addStaffReply("123", {
        text: "<p>Reply content</p>",
        staff_id: 5
      });

      expect(mockClient.post).toHaveBeenCalledWith("/ticket/123/staff_update/", {
        staff: 5,
        html: "<p>Reply content</p>"
      });
    });

    it("joins cc and bcc with comma", async () => {
      (mockClient.post as any).mockResolvedValue({ id: 1 });

      await endpoints.addStaffReply("123", {
        text: "Reply",
        staff_id: 5,
        cc: ["cc@example.com"],
        bcc: ["bcc@example.com"]
      });

      expect(mockClient.post).toHaveBeenCalledWith("/ticket/123/staff_update/", expect.objectContaining({
        cc: "cc@example.com",
        bcc: "bcc@example.com"
      }));
    });

    it("includes status and priority when provided", async () => {
      (mockClient.post as any).mockResolvedValue({ id: 1 });

      await endpoints.addStaffReply("123", {
        text: "Reply",
        staff_id: 5,
        status: "2",
        priority: "3"
      });

      expect(mockClient.post).toHaveBeenCalledWith("/ticket/123/staff_update/", expect.objectContaining({
        status: "2",
        priority: "3"
      }));
    });
  });

  describe("addPrivateNote", () => {
    it("maps text to html field", async () => {
      (mockClient.post as any).mockResolvedValue({ id: 1 });

      await endpoints.addPrivateNote("123", {
        text: "Private note content",
        staff_id: 5
      });

      expect(mockClient.post).toHaveBeenCalledWith("/ticket/123/staff_pvtnote/", {
        staff: 5,
        html: "Private note content"
      });
    });
  });

  describe("forwardTicket", () => {
    it("joins 'to' array with comma", async () => {
      (mockClient.post as any).mockResolvedValue({ success: true });

      await endpoints.forwardTicket("123", {
        to: ["email1@example.com", "email2@example.com"],
        subject: "FW: Ticket",
        staff_id: 5
      });

      expect(mockClient.post).toHaveBeenCalledWith("/ticket/123/forward/", {
        to: "email1@example.com,email2@example.com",
        subject: "FW: Ticket",
        staff_id: 5
      });
    });

    it("maps message to html field when provided", async () => {
      (mockClient.post as any).mockResolvedValue({ success: true });

      await endpoints.forwardTicket("123", {
        to: ["email@example.com"],
        subject: "FW: Ticket",
        staff_id: 5,
        message: "Please review"
      });

      expect(mockClient.post).toHaveBeenCalledWith("/ticket/123/forward/", expect.objectContaining({
        html: "Please review"
      }));
    });
  });

  describe("deleteTicket", () => {
    it("sends staff_id", async () => {
      (mockClient.post as any).mockResolvedValue({ success: true });

      await endpoints.deleteTicket("123", 5);

      expect(mockClient.post).toHaveBeenCalledWith("/ticket/123/delete/", {
        staff_id: 5
      });
    });
  });

  describe("addContactReply", () => {
    it("maps text to html field", async () => {
      (mockClient.post as any).mockResolvedValue({ id: 1 });

      await endpoints.addContactReply("123", {
        text: "Customer reply"
      });

      expect(mockClient.post).toHaveBeenCalledWith("/ticket/123/user_reply/", {
        html: "Customer reply"
      });
    });

    it("joins cc and bcc with comma", async () => {
      (mockClient.post as any).mockResolvedValue({ id: 1 });

      await endpoints.addContactReply("123", {
        text: "Reply",
        cc: ["cc@example.com"],
        bcc: ["bcc@example.com"]
      });

      expect(mockClient.post).toHaveBeenCalledWith("/ticket/123/user_reply/", expect.objectContaining({
        cc: "cc@example.com",
        bcc: "bcc@example.com"
      }));
    });
  });

  describe("subscribeToTicket", () => {
    it("sends staff_id", async () => {
      (mockClient.post as any).mockResolvedValue({ success: true });

      await endpoints.subscribeToTicket("123", 5);

      expect(mockClient.post).toHaveBeenCalledWith("/ticket/123/subscribe/", {
        staff_id: 5
      });
    });
  });

  describe("unsubscribeFromTicket", () => {
    it("sends staff_id", async () => {
      (mockClient.post as any).mockResolvedValue({ success: true });

      await endpoints.unsubscribeFromTicket("123", 5);

      expect(mockClient.post).toHaveBeenCalledWith("/ticket/123/unsubscribe/", {
        staff_id: 5
      });
    });
  });

  describe("createTicketsBulk", () => {
    it("throws error for more than 100 tickets", async () => {
      const tickets = Array(101).fill({
        category: "1",
        subject: "Test",
        text: "Content",
        email: "test@example.com",
        name: "User"
      });

      await expect(endpoints.createTicketsBulk(tickets)).rejects.toThrow(
        "Bulk ticket creation limited to 100 tickets per request"
      );
    });

    it("throws error for empty array", async () => {
      await expect(endpoints.createTicketsBulk([])).rejects.toThrow(
        "At least one ticket is required"
      );
    });

    it("formats all tickets correctly", async () => {
      (mockClient.post as any).mockResolvedValue({ created: 2 });

      await endpoints.createTicketsBulk([
        {
          category: "1",
          subject: "Ticket 1",
          text: "Content 1",
          email: "user1@example.com",
          name: "User 1",
          tags: ["urgent"]
        },
        {
          category: "2",
          subject: "Ticket 2",
          text: "Content 2",
          email: "user2@example.com",
          name: "User 2"
        }
      ]);

      expect(mockClient.post).toHaveBeenCalledWith("/tickets/", [
        {
          category: "1",
          subject: "Ticket 1",
          text: "Content 1",
          email: "user1@example.com",
          name: "User 1",
          tags: "urgent"
        },
        {
          category: "2",
          subject: "Ticket 2",
          text: "Content 2",
          email: "user2@example.com",
          name: "User 2"
        }
      ]);
    });

    it("handles custom fields in bulk tickets", async () => {
      (mockClient.post as any).mockResolvedValue({ created: 1 });

      await endpoints.createTicketsBulk([
        {
          category: "1",
          subject: "Test",
          text: "Content",
          email: "test@example.com",
          name: "User",
          custom_fields: { "t-cf-1": "value" }
        }
      ]);

      expect(mockClient.post).toHaveBeenCalledWith("/tickets/", [
        expect.objectContaining({
          "t-cf-1": "value"
        })
      ]);
    });

    it("accepts exactly 100 tickets", async () => {
      (mockClient.post as any).mockResolvedValue({ created: 100 });

      const tickets = Array(100).fill({
        category: "1",
        subject: "Test",
        text: "Content",
        email: "test@example.com",
        name: "User"
      });

      await expect(endpoints.createTicketsBulk(tickets)).resolves.toEqual({ created: 100 });
    });
  });
});
