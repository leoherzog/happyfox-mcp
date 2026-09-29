import { describe, it, expect, beforeEach } from "vitest";
import { DUE_DATE_PATTERN, TicketEndpoints, TicketInput } from "../../../../src/happyfox/endpoints/tickets";
import { HappyFoxClient } from "../../../../src/happyfox/client";
import { TICKET_ID_PROPERTY, TicketTools } from "../../../../src/mcp/tools/tickets";
import { CUSTOM_FIELD_VALUE_FORMATS } from "../../../../src/happyfox/endpoints/custom-fields";
import { createMockClient } from "../../../helpers/client-mock";
import { INJECTION_IDS, MALFORMED_IDS } from "../../../helpers/invalid-ids";
import {
  resetFetchMock,
  mockHappyFoxGet,
  mockHappyFoxPost,
  lastHappyFoxRequest
} from "../../../helpers/fetch-mock-helpers";

/** The smallest ticket Docs/1039 §4 accepts for a new contact. */
const BASE_TICKET: TicketInput = {
  category: 1,
  subject: "Test Subject",
  text: "Test content",
  email: "test@example.com",
  name: "Test User"
};

/** A failed bulk entry as Docs/1039 §5 documents it. It names no ticket, and the docs state no result order. */
const BULK_FAILURE = {
  success: false,
  error: [{ field: "category", errors: ["This field is required."] }]
};

/** The ticket update_tags returns (Docs/1039 §12), trimmed from the §3 detail example. */
const TICKET_DETAIL = {
  id: 123,
  display_id: "#DC00000123",
  subject: "Example ticket",
  status: { name: "In Progress", color: "0066CC", order: 2, default: false, behavior: "pending", id: 2 },
  tags: "test"
};

describe("TicketEndpoints", () => {
  let mockClient: ReturnType<typeof createMockClient>;
  let endpoints: TicketEndpoints;

  beforeEach(() => {
    mockClient = createMockClient();
    endpoints = new TicketEndpoints(mockClient as any);
  });

  /** The body of the only POST sent. */
  function postedBody(): any {
    expect(mockClient.post).toHaveBeenCalledTimes(1);
    return (mockClient.post as any).mock.calls[0][1];
  }

  describe("createTicket", () => {
    beforeEach(() => {
      (mockClient.post as any).mockResolvedValue({ id: 1 });
    });

    it("sends the required fields, with the category id as a number", async () => {
      await endpoints.createTicket({ ...BASE_TICKET, category: "1" });

      expect(mockClient.post).toHaveBeenCalledWith("/tickets/", {
        category: 1,
        subject: "Test Subject",
        text: "Test content",
        email: "test@example.com",
        name: "Test User"
      });
    });

    it("sends html instead of text", async () => {
      const { text: _text, ...ticket } = BASE_TICKET;
      await endpoints.createTicket({ ...ticket, html: "<p>Hello</p>" });

      expect(postedBody()).toEqual({
        category: 1,
        subject: "Test Subject",
        html: "<p>Hello</p>",
        email: "test@example.com",
        name: "Test User"
      });
    });

    it("requires text or html", async () => {
      await expect(endpoints.createTicket({ ...BASE_TICKET, text: "" })).rejects.toMatchObject({
        statusCode: 400,
        code: "INVALID_ARGUMENT",
        message: expect.stringContaining("text or html")
      });
      expect(mockClient.post).not.toHaveBeenCalled();
    });

    it.each([
      ["html", { text: "hi", html: 42 }],
      ["text", { text: { body: "hi" }, html: "<p>hi</p>" }],
      ["tickets[0].html", null]
    ])("refuses a malformed %s instead of sending the other body alone", async (field, override) => {
      const call = override === null
        ? endpoints.createTicketsBulk([{ ...BASE_TICKET, html: ["<p>hi</p>"] } as any])
        : endpoints.createTicket({ ...BASE_TICKET, ...override } as any);

      await expect(call).rejects.toMatchObject({
        statusCode: 400,
        code: "INVALID_ARGUMENT",
        message: `Invalid ${field}: expected a string.`
      });
      expect(mockClient.post).not.toHaveBeenCalled();
    });

    it("requires a subject", async () => {
      await expect(endpoints.createTicket({ ...BASE_TICKET, subject: "" })).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        message: expect.stringContaining("subject")
      });
      expect(mockClient.post).not.toHaveBeenCalled();
    });

    it("sends client in place of name and email for an existing contact", async () => {
      await endpoints.createTicket({ category: 1, subject: "S", text: "T", client: "42" });

      expect(postedBody()).toEqual({ category: 1, subject: "S", text: "T", client: 42 });
    });

    it("rejects client together with name or email", async () => {
      await expect(endpoints.createTicket({ ...BASE_TICKET, client: 42 })).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        message: expect.stringContaining("client")
      });
      expect(mockClient.post).not.toHaveBeenCalled();
    });

    it.each([
      ["name", { category: 1, subject: "S", text: "T", email: "a@example.com" }],
      ["email", { category: 1, subject: "S", text: "T", name: "A" }]
    ])("requires %s when client is absent", async (_field, ticket) => {
      await expect(endpoints.createTicket(ticket as TicketInput)).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        message: expect.stringContaining("unless client")
      });
      expect(mockClient.post).not.toHaveBeenCalled();
    });

    it.each([
      ["category", { category: "Billing" }],
      ["client", { client: "#42", name: undefined, email: undefined }],
      ["priority", { priority: "High" }],
      ["assignee", { assignee: "agent@example.com" }]
    ])("rejects a %s that is not a numeric id", async (field, override) => {
      await expect(endpoints.createTicket({ ...BASE_TICKET, ...override } as TicketInput)).rejects.toMatchObject({
        statusCode: 400,
        code: "INVALID_ID",
        message: expect.stringContaining(field)
      });
      expect(mockClient.post).not.toHaveBeenCalled();
    });

    it("sends assignee null to leave the ticket unassigned", async () => {
      await endpoints.createTicket({ ...BASE_TICKET, assignee: null });

      expect(postedBody()).toHaveProperty("assignee", null);
    });

    it("sends priority and assignee ids as numbers", async () => {
      await endpoints.createTicket({ ...BASE_TICKET, phone: "555-1234", priority: "2", assignee: 5 });

      expect(postedBody()).toMatchObject({ phone: "555-1234", priority: 2, assignee: 5 });
    });

    it("sends created_at, due_date and visible_only_staff as given", async () => {
      await endpoints.createTicket({
        ...BASE_TICKET,
        created_at: "2019-12-20T10:15:00",
        due_date: "20/12/2019",
        visible_only_staff: false
      });

      expect(postedBody()).toMatchObject({
        created_at: "2019-12-20T10:15:00",
        due_date: "20/12/2019",
        visible_only_staff: false
      });
    });

    it("joins tags, cc and bcc with commas", async () => {
      await endpoints.createTicket({
        ...BASE_TICKET,
        tags: ["urgent", "billing"],
        cc: ["cc1@example.com", "cc2@example.com"],
        bcc: ["bcc@example.com"]
      });

      expect(postedBody()).toMatchObject({
        tags: "urgent,billing",
        cc: "cc1@example.com,cc2@example.com",
        bcc: "bcc@example.com"
      });
    });

    it.each([
      ["visible_only_staff", { visible_only_staff: "true" }],
      ["created_at", { created_at: 1576836900 }],
      ["due_date", { due_date: "2019/12/20" }],
      ["due_date", { due_date: 20191220 }],
      ["phone", { phone: 5551234 }],
      ["tags", { tags: "urgent" }],
      ["tags", { tags: [{}] }],
      ["cc", { cc: "cc@example.com" }],
      ["bcc", { bcc: [42] }]
    ])("rejects a malformed %s before sending", async (field, override) => {
      await expect(endpoints.createTicket({ ...BASE_TICKET, ...override } as any)).rejects.toMatchObject({
        statusCode: 400,
        code: "INVALID_ARGUMENT",
        message: expect.stringContaining(field)
      });
      expect(mockClient.post).not.toHaveBeenCalled();
    });

    it("names the bulk ticket whose optional field is malformed", async () => {
      await expect(
        endpoints.createTicketsBulk([BASE_TICKET, { ...BASE_TICKET, visible_only_staff: "true" } as any])
      ).rejects.toMatchObject({ code: "INVALID_ARGUMENT", message: expect.stringContaining("tickets[1].visible_only_staff") });
      expect(mockClient.post).not.toHaveBeenCalled();
    });

    it("omits optional fields when not provided", async () => {
      await endpoints.createTicket(BASE_TICKET);

      expect(Object.keys(postedBody()).sort()).toEqual(["category", "email", "name", "subject", "text"]);
    });

    it("sends ticket and contact custom fields as top-level keys (Docs/1039 §4 example 1)", async () => {
      await endpoints.createTicket({
        ...BASE_TICKET,
        custom_fields: {
          "t-cf-3": [1, "2"],
          "t-cf-1": "text field value",
          "t-cf-5": 200,
          "t-cf-4": "2019-12-20",
          "c-cf-3": 1
        }
      });

      expect(postedBody()).toEqual({
        category: 1,
        subject: "Test Subject",
        text: "Test content",
        email: "test@example.com",
        name: "Test User",
        "t-cf-3": [1, 2],
        "t-cf-1": "text field value",
        "t-cf-5": 200,
        "t-cf-4": "2019-12-20",
        "c-cf-3": 1
      });
    });

    it.each(["3", "priority", "email", "category", "t-cf-", "t-cf-0", "t-cf-03", "a-cf-1", "T-CF-1", "t-cf-1 "])(
      "rejects the custom field key %j before sending",
      async key => {
        await expect(
          endpoints.createTicket({ ...BASE_TICKET, custom_fields: { [key]: "x" } })
        ).rejects.toMatchObject({
          statusCode: 400,
          code: "INVALID_ARGUMENT",
          message: expect.stringContaining(JSON.stringify(key))
        });
        expect(mockClient.post).not.toHaveBeenCalled();
      }
    );

    it.each([
      ["null", null],
      ["an object", { id: 1 }],
      ["a boolean", true],
      ["choice labels", ["Bengaluru"]]
    ])("rejects %s as a custom field value", async (_what, value) => {
      await expect(
        endpoints.createTicket({ ...BASE_TICKET, custom_fields: { "t-cf-3": value } })
      ).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        message: expect.stringContaining("t-cf-3")
      });
      expect(mockClient.post).not.toHaveBeenCalled();
    });
  });

  describe("listTickets", () => {
    beforeEach(() => {
      (mockClient.get as any).mockResolvedValue({ data: [] });
    });

    it("sets default pagination (page=1, size=50)", async () => {
      await endpoints.listTickets();

      expect(mockClient.get).toHaveBeenCalledWith("/tickets/", { page: 1, size: 50 });
    });

    it("caps size at 50", async () => {
      await endpoints.listTickets({ size: 100 });

      expect(mockClient.get).toHaveBeenCalledWith("/tickets/", expect.objectContaining({ size: 50 }));
    });

    it("allows size less than 50", async () => {
      await endpoints.listTickets({ size: 10 });

      expect(mockClient.get).toHaveBeenCalledWith("/tickets/", expect.objectContaining({ size: 10 }));
    });

    it("takes page and size as digit strings", async () => {
      await endpoints.listTickets({ page: "3", size: "10" } as any);

      expect(mockClient.get).toHaveBeenCalledWith("/tickets/", { page: 3, size: 10 });
    });

    it.each([
      ["page", "abc"], ["page", -3], ["page", 0], ["page", { a: 1 }], ["page", 1.5],
      ["size", "abc"], ["size", -5], ["size", 0], ["size", { a: 1 }], ["size", Number.NaN]
    ])("refuses %s %j before any request", async (param, value) => {
      await expect(endpoints.listTickets({ [param]: value } as any)).rejects.toMatchObject({
        statusCode: 400,
        code: "INVALID_ARGUMENT",
        message: expect.stringMatching(new RegExp(`^Invalid ${param} .*: expected a positive integer\\.$`))
      });
      expect(mockClient.get).not.toHaveBeenCalled();
    });

    it("sends a search as status=_all&q=... (Docs/1039 §1)", async () => {
      await endpoints.listTickets({ query: 'status:"New"' });

      expect(mockClient.get).toHaveBeenCalledWith("/tickets/", {
        page: 1,
        size: 50,
        status: "_all",
        q: 'status:"New"'
      });
    });

    it.each(["_all", "_pending"])("passes the status keyword %s through", async status => {
      await endpoints.listTickets({ status, query: "tag:\"a\"" });

      expect(mockClient.get).toHaveBeenCalledWith("/tickets/", expect.objectContaining({ status }));
    });

    it("sends a status id in canonical form", async () => {
      await endpoints.listTickets({ status: "02" });

      expect(mockClient.get).toHaveBeenCalledWith("/tickets/", { page: 1, size: 50, status: "2" });
    });

    it("rejects a status name and points to the status: search term", async () => {
      await expect(endpoints.listTickets({ status: "Open" })).rejects.toMatchObject({
        statusCode: 400,
        code: "INVALID_ARGUMENT",
        message: expect.stringContaining('query status:"<name>"')
      });
      expect(mockClient.get).not.toHaveBeenCalled();
    });

    it("sends several categories as a list of ids", async () => {
      await endpoints.listTickets({ category: [34, "5"] });

      expect(mockClient.get).toHaveBeenCalledWith("/tickets/", { page: 1, size: 50, category: ["34", "5"] });
    });

    it("accepts a single category id", async () => {
      await endpoints.listTickets({ category: "1" });

      expect(mockClient.get).toHaveBeenCalledWith("/tickets/", expect.objectContaining({ category: ["1"] }));
    });

    it("rejects a category that is not a numeric id", async () => {
      await expect(endpoints.listTickets({ category: ["1", "Billing"] })).rejects.toMatchObject({
        code: "INVALID_ID",
        message: expect.stringContaining("category")
      });
      expect(mockClient.get).not.toHaveBeenCalled();
    });

    it("maps a documented sort_by value to 'sort'", async () => {
      await endpoints.listTickets({ sort_by: "created" });

      expect(mockClient.get).toHaveBeenCalledWith("/tickets/", expect.objectContaining({ sort: "created" }));
    });

    it.each(["created_at", "-created", "toString"])("rejects the undocumented sort_by %j", async sort_by => {
      await expect(endpoints.listTickets({ sort_by })).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        message: expect.stringContaining("last_modifiedd")
      });
      expect(mockClient.get).not.toHaveBeenCalled();
    });

    it("joins fields array with comma", async () => {
      await endpoints.listTickets({ fields: ["id", "subject", "status"] });

      expect(mockClient.get).toHaveBeenCalledWith("/tickets/", expect.objectContaining({
        fields: "id,subject,status"
      }));
    });

    it.each([["a string", "id,subject"], ["a non-string item", [{}]]])("rejects fields given as %s", async (_what, fields) => {
      await expect(endpoints.listTickets({ fields } as any)).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        message: expect.stringContaining("fields")
      });
      expect(mockClient.get).not.toHaveBeenCalled();
    });

    it("sends minify_response only when true", async () => {
      await endpoints.listTickets({ minify_response: false });
      await endpoints.listTickets({ page: 2, size: 25, minify_response: true });

      expect((mockClient.get as any).mock.calls[0][1]).not.toHaveProperty("minify_response");
      expect(mockClient.get).toHaveBeenLastCalledWith("/tickets/", { page: 2, size: 25, minify_response: true });
    });

    describe("on the wire", () => {
      beforeEach(() => {
        resetFetchMock();
      });

      it("repeats category keys and encodes spaces in q as '+' like Docs/1039 §2.1", async () => {
        const client = new HappyFoxClient({
          apiKey: "k",
          authCode: "c",
          accountName: "testaccount",
          region: "us"
        });
        mockHappyFoxGet("/tickets/", { page_info: {}, data: [] });

        await new TicketEndpoints(client).listTickets({
          category: [34, 5],
          query: 'status:"In Progress","Send SMS" tag:"c++"'
        });

        const { query, url } = lastHappyFoxRequest();
        expect(query.getAll("category")).toEqual(["34", "5"]);
        expect(query.get("status")).toBe("_all");
        expect(query.get("q")).toBe('status:"In Progress","Send SMS" tag:"c++"');
        expect(url.search).toContain("q=status%3A%22In+Progress%22%2C%22Send+SMS%22+tag%3A%22c%2B%2B%22");
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

    it.each(["#DC00000003", "DC00000003"])("rejects the display id %s and says how to find the number", async id => {
      await expect(endpoints.getTicket(id)).rejects.toMatchObject({
        statusCode: 400,
        code: "INVALID_ID",
        message: expect.stringContaining("query id:DC00000003")
      });
      expect(mockClient.get).not.toHaveBeenCalled();
    });
  });

  describe("updateTags", () => {
    it("joins add tags with comma", async () => {
      (mockClient.post as any).mockResolvedValue(TICKET_DETAIL);

      await expect(endpoints.updateTags("123", { add: ["tag1", "tag2"] })).resolves.toEqual(TICKET_DETAIL);

      expect(mockClient.post).toHaveBeenCalledWith("/ticket/123/update_tags/", {
        add: "tag1,tag2"
      });
    });

    it("joins remove tags with comma", async () => {
      (mockClient.post as any).mockResolvedValue(TICKET_DETAIL);

      await endpoints.updateTags("123", { remove: ["old1", "old2"] });

      expect(mockClient.post).toHaveBeenCalledWith("/ticket/123/update_tags/", {
        remove: "old1,old2"
      });
    });

    it("sends add, remove and staff_id as Docs/1039 §12 shows", async () => {
      (mockClient.post as any).mockResolvedValue(TICKET_DETAIL);

      await endpoints.updateTags("123", { add: ["new"], remove: ["old"], staff_id: "1" });

      expect(mockClient.post).toHaveBeenCalledWith("/ticket/123/update_tags/", {
        add: "new",
        remove: "old",
        staff_id: 1
      });
    });

    it("requires a tag to add or remove", async () => {
      await expect(endpoints.updateTags("123", { add: [], staff_id: 1 })).rejects.toMatchObject({
        code: "INVALID_ARGUMENT"
      });
      await expect(endpoints.updateTags("123", { add: "a,b" as any })).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        message: expect.stringContaining("add")
      });
      expect(mockClient.post).not.toHaveBeenCalled();
    });
  });

  describe("updateCustomFields", () => {
    it("sends the required staff beside the t-cf values (Docs/1039 §11)", async () => {
      (mockClient.post as any).mockResolvedValue(TICKET_DETAIL);

      await endpoints.updateCustomFields("123", { "t-cf-1": "value1", "t-cf-2": 123, "t-cf-3": ["4", 5] }, 7);

      expect(mockClient.post).toHaveBeenCalledWith("/ticket/123/update_custom_fields/", {
        staff: 7,
        "t-cf-1": "value1",
        "t-cf-2": 123,
        "t-cf-3": [4, 5]
      });
    });

    it.each([
      ["a core field", { staff: 9 }],
      ["a move field", { target_category_id: "2" }],
      ["a contact field, which §11 does not document", { "c-cf-1": "x" }]
    ])("refuses %s before sending", async (_what, fields) => {
      await expect(endpoints.updateCustomFields("123", fields, 7)).rejects.toMatchObject({
        statusCode: 400,
        code: "INVALID_ARGUMENT",
        message: expect.stringContaining("t-cf-<id>")
      });
      expect(mockClient.post).not.toHaveBeenCalled();
    });

    it("requires at least one field and the acting agent", async () => {
      await expect(endpoints.updateCustomFields("123", {}, 7)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
      await expect(endpoints.updateCustomFields("123", { "t-cf-1": "x" }, undefined as any)).rejects.toMatchObject({
        code: "INVALID_ID",
        message: expect.stringContaining("staff_id")
      });
      expect(mockClient.post).not.toHaveBeenCalled();
    });
  });

  describe("moveCategory", () => {
    it("sends the documented fields with ids as numbers (Docs/1039 §16 example)", async () => {
      (mockClient.post as any).mockResolvedValue({ status_code: 200, message: "moved ticket to Test" });

      await endpoints.moveCategory("123", {
        staff_id: 1,
        target_category_id: "2",
        move_note: " move note text ",
        assign_to: "2"
      });

      expect(mockClient.post).toHaveBeenCalledWith("/ticket/123/move/", {
        staff_id: 1,
        target_category_id: 2,
        move_note: " move note text ",
        assign_to: 2
      });
    });

    it("omits move_note and assign_to when not given", async () => {
      await endpoints.moveCategory("123", { staff_id: 5, target_category_id: 2 });

      expect(postedBody()).toEqual({ staff_id: 5, target_category_id: 2 });
    });

    it("rejects a category that is not an id", async () => {
      await expect(endpoints.moveCategory("123", { staff_id: 5, target_category_id: "Billing" }))
        .rejects.toMatchObject({ code: "INVALID_ID", message: expect.stringContaining("target_category_id") });
      expect(mockClient.post).not.toHaveBeenCalled();
    });
  });

  describe("addStaffReply", () => {
    it("sends the staff id as `staff` and html as given", async () => {
      (mockClient.post as any).mockResolvedValue({ id: 1 });

      await endpoints.addStaffReply("123", { html: "<p>Reply content</p>", staff_id: 5 });

      expect(mockClient.post).toHaveBeenCalledWith("/ticket/123/staff_update/", {
        staff: 5,
        html: "<p>Reply content</p>"
      });
    });

    it("sends plaintext under its own key", async () => {
      await endpoints.addStaffReply("123", { plaintext: "Line 1\nLine 2", staff_id: 5 });

      expect(postedBody()).toEqual({ staff: 5, plaintext: "Line 1\nLine 2" });
    });

    it.each([
      ["neither html nor plaintext", {}, "html or plaintext is required"],
      ["both", { html: "<p>a</p>", plaintext: "a" }, "not both"]
    ])("rejects %s", async (_what, body, message) => {
      await expect(endpoints.addStaffReply("123", { staff_id: 5, ...body })).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        message: expect.stringContaining(message)
      });
      expect(mockClient.post).not.toHaveBeenCalled();
    });

    it("sends every documented staff_update field (Docs/1039 §8)", async () => {
      await endpoints.addStaffReply("123", {
        staff_id: "1",
        html: "<p>Example reply</p>",
        cc: ["cc@example.com", "cc2@example.com"],
        bcc: ["bcc@example.com"],
        update_customer: true,
        send_survey: false,
        subject: "Re: your order",
        last_staff_message: "40",
        parent_update: 41,
        status: "4",
        priority: 3,
        assignee: "2",
        time_spent: "15",
        due_date: "20/12/2019",
        tags: ["billing", "vip"],
        custom_fields: { "t-cf-3": [1, 2], "ccf-3": "1" }
      });

      expect(postedBody()).toEqual({
        staff: 1,
        html: "<p>Example reply</p>",
        cc: "cc@example.com,cc2@example.com",
        bcc: "bcc@example.com",
        update_customer: true,
        send_survey: false,
        subject: "Re: your order",
        last_staff_message: 40,
        parent_update: 41,
        status: 4,
        priority: 3,
        assignee: 2,
        time_spent: 15,
        due_date: "20/12/2019",
        tags: "billing,vip",
        "t-cf-3": [1, 2],
        "ccf-3": "1"
      });
    });

    it("sends assignee null to unassign", async () => {
      await endpoints.addStaffReply("123", { plaintext: "Unassigning", staff_id: 5, assignee: null });

      expect(postedBody()).toEqual({ staff: 5, plaintext: "Unassigning", assignee: null });
    });

    it("takes contact custom fields as ccf-<id>, the key §8 documents, not c-cf-<id>", async () => {
      await expect(endpoints.addStaffReply("123", {
        plaintext: "Hi",
        staff_id: 5,
        custom_fields: { "c-cf-3": 1 }
      })).rejects.toMatchObject({ code: "INVALID_ARGUMENT", message: expect.stringContaining("ccf-<id>") });
      expect(mockClient.post).not.toHaveBeenCalled();
    });

    it.each([
      ["due_date", { due_date: "2019/12/20" }],
      ["time_spent", { time_spent: -5 }],
      ["time_spent", { time_spent: "1.5" }],
      ["update_customer", { update_customer: "true" }],
      ["tags", { tags: "a,b" }],
      ["status", { status: "Closed" }],
      ["custom_fields", { custom_fields: { staff: 9 } }]
    ])("rejects a malformed %s before sending", async (param, extra) => {
      await expect(endpoints.addStaffReply("123", { plaintext: "Hi", staff_id: 5, ...(extra as any) }))
        .rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining(param) });
      expect(mockClient.post).not.toHaveBeenCalled();
    });

    it("sends assignee null on the wire, where JSON keeps it", async () => {
      resetFetchMock();
      const client = new HappyFoxClient({ apiKey: "k", authCode: "c", accountName: "testaccount", region: "us" });
      mockHappyFoxPost("/ticket/7/staff_update/", { id: 7 });

      await new TicketEndpoints(client).addStaffReply(7, { plaintext: "Hi", staff_id: 1, assignee: null });

      const request = lastHappyFoxRequest();
      expect(request.method).toBe("POST");
      expect(request.json()).toEqual({ staff: 1, plaintext: "Hi", assignee: null });
    });
  });

  describe("updateTicketProperties", () => {
    it("sends the Docs/1039 §8.1 property-only payload, with no message", async () => {
      (mockClient.post as any).mockResolvedValue({ id: 123 });

      await endpoints.updateTicketProperties("123", { staff_id: 1, priority: 5, assignee: 4, status: "3" });

      expect(mockClient.post).toHaveBeenCalledWith("/ticket/123/staff_update/", {
        staff: 1,
        priority: 5,
        assignee: 4,
        status: 3
      });
    });

    it("sends time_spent, due_date, tags and custom fields", async () => {
      await endpoints.updateTicketProperties("123", {
        staff_id: 1,
        time_spent: 30,
        due_date: "2019-12-20",
        tags: ["a"],
        custom_fields: { "t-cf-2": "done" }
      });

      expect(postedBody()).toEqual({ staff: 1, time_spent: 30, due_date: "2019-12-20", tags: "a", "t-cf-2": "done" });
    });

    it("sends assignee null to unassign", async () => {
      await endpoints.updateTicketProperties("123", { staff_id: 1, assignee: null });

      expect(postedBody()).toEqual({ staff: 1, assignee: null });
    });

    it("requires a property to change", async () => {
      await expect(endpoints.updateTicketProperties("123", { staff_id: 1 })).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        message: expect.stringContaining("at least one property")
      });
      expect(mockClient.post).not.toHaveBeenCalled();
    });

    it("ignores message fields, so it never posts a reply", async () => {
      await endpoints.updateTicketProperties("123", { staff_id: 1, status: 2, html: "<p>x</p>" } as any);

      expect(postedBody()).toEqual({ staff: 1, status: 2 });
    });
  });

  describe("addPrivateNote", () => {
    it("sends the staff id as `staff` and html as given", async () => {
      (mockClient.post as any).mockResolvedValue({ id: 1 });

      await endpoints.addPrivateNote("123", { html: "Private note content", staff_id: 5 });

      expect(mockClient.post).toHaveBeenCalledWith("/ticket/123/staff_pvtnote/", {
        staff: 5,
        html: "Private note content"
      });
    });

    it("sends every documented staff_pvtnote field (Docs/1039 §9)", async () => {
      await endpoints.addPrivateNote("123", {
        staff_id: 5,
        plaintext: "Heads up",
        alert: "s",
        status: 2,
        priority: 3,
        assignee: null,
        time_spent: 10,
        due_date: "2019-12-20",
        tags: ["escalated"],
        custom_fields: { "t-cf-1": "x", "ccf-2": 4 }
      });

      expect(postedBody()).toEqual({
        staff: 5,
        plaintext: "Heads up",
        alert: "s",
        status: 2,
        priority: 3,
        assignee: null,
        time_spent: 10,
        due_date: "2019-12-20",
        tags: "escalated",
        "t-cf-1": "x",
        "ccf-2": 4
      });
    });

    it.each([["c", "c"], ["an agent id", "12"]])("sends alert %s", async (_what, alert) => {
      await endpoints.addPrivateNote("123", { plaintext: "x", staff_id: 5, alert });

      expect(postedBody().alert).toBe(alert === "12" ? 12 : alert);
    });

    it("rejects an alert outside s, c or an agent id", async () => {
      await expect(endpoints.addPrivateNote("123", { plaintext: "x", staff_id: 5, alert: "everyone" }))
        .rejects.toMatchObject({ code: "INVALID_ARGUMENT", message: expect.stringContaining("alert") });
      expect(mockClient.post).not.toHaveBeenCalled();
    });

    it("requires html or plaintext", async () => {
      await expect(endpoints.addPrivateNote("123", { staff_id: 5, alert: "s" })).rejects.toMatchObject({
        code: "INVALID_ARGUMENT"
      });
      expect(mockClient.post).not.toHaveBeenCalled();
    });
  });

  describe("forwardTicket", () => {
    const FORWARD = { to: ["email1@example.com", "email2@example.com"], subject: "FW: Ticket", message: "Please review", staff_id: 5 };

    it("sends message, subject and a comma-joined to (Docs/1039 §15)", async () => {
      (mockClient.post as any).mockResolvedValue({ message: "Successfully forwarded the ticket #DC00000004" });

      await endpoints.forwardTicket("123", FORWARD);

      expect(mockClient.post).toHaveBeenCalledWith("/ticket/123/forward/", {
        to: "email1@example.com,email2@example.com",
        subject: "FW: Ticket",
        message: "Please review",
        staff_id: 5
      });
    });

    it("sends cc, bcc and the documented flags", async () => {
      await endpoints.forwardTicket("123", {
        ...FORWARD,
        cc: ["cc@example.com"],
        bcc: ["bcc@example.com"],
        to_include_ticket_contact: true,
        cc_include_ticket_contact: false,
        send_all_messages: false,
        include_pvt_notes: true,
        convert_replies_as_new_ticket: false
      });

      expect(postedBody()).toEqual({
        to: "email1@example.com,email2@example.com",
        subject: "FW: Ticket",
        message: "Please review",
        staff_id: 5,
        cc: "cc@example.com",
        bcc: "bcc@example.com",
        to_include_ticket_contact: true,
        cc_include_ticket_contact: false,
        send_all_messages: false,
        include_pvt_notes: true,
        convert_replies_as_new_ticket: false
      });
    });

    it.each([
      ["message", { message: undefined }],
      ["subject", { subject: "" }],
      ["to", { to: [] }]
    ])("requires %s", async (param, missing) => {
      await expect(endpoints.forwardTicket("123", { ...FORWARD, ...(missing as any) })).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        message: expect.stringContaining(param)
      });
      expect(mockClient.post).not.toHaveBeenCalled();
    });
  });

  describe("deleteTicket", () => {
    it("sends staff_id as a number", async () => {
      (mockClient.post as any).mockResolvedValue({ deleted_ticket: "#DC00000005" });

      await endpoints.deleteTicket("123", "5");

      expect(mockClient.post).toHaveBeenCalledWith("/ticket/123/delete/", {
        staff_id: 5
      });
    });
  });

  describe("addContactReply", () => {
    it("sends the reply as `text` with the contact as `user` (Docs/1039 §10)", async () => {
      (mockClient.post as any).mockResolvedValue({ id: 1 });

      await endpoints.addContactReply("123", { text: "Customer reply", user: "27662" });

      expect(mockClient.post).toHaveBeenCalledWith("/ticket/123/user_reply/", {
        user: 27662,
        text: "Customer reply"
      });
    });

    it("joins cc and bcc with comma", async () => {
      await endpoints.addContactReply("123", {
        text: "Reply",
        user: 1,
        cc: ["cc@example.com"],
        bcc: ["bcc@example.com"]
      });

      expect(postedBody()).toEqual({ user: 1, text: "Reply", cc: "cc@example.com", bcc: "bcc@example.com" });
    });

    it("requires text and user", async () => {
      await expect(endpoints.addContactReply("123", { text: "", user: 1 })).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        message: expect.stringContaining("text")
      });
      await expect(endpoints.addContactReply("123", { text: "Hi" } as any)).rejects.toMatchObject({
        code: "INVALID_ID",
        message: expect.stringContaining("user")
      });
      expect(mockClient.post).not.toHaveBeenCalled();
    });
  });

  describe("subscribeToTicket", () => {
    it("sends staff_id", async () => {
      (mockClient.post as any).mockResolvedValue({ message: "Admin Agent, Subscribers added to ticket" });

      await endpoints.subscribeToTicket("123", 5);

      expect(mockClient.post).toHaveBeenCalledWith("/ticket/123/subscribe/", {
        staff_id: 5
      });
    });

    it("sends more agents as the `data` id list (Docs/1039 §13 example)", async () => {
      await endpoints.subscribeToTicket("123", 1, [3, "2"]);

      expect(postedBody()).toEqual({ data: [3, 2], staff_id: 1 });
    });

    it("rejects a data entry that is not an agent id", async () => {
      await expect(endpoints.subscribeToTicket("123", 1, [3, "james"])).rejects.toMatchObject({
        code: "INVALID_ID",
        message: expect.stringContaining("data[1]")
      });
      expect(mockClient.post).not.toHaveBeenCalled();
    });
  });

  describe("unsubscribeFromTicket", () => {
    it("sends staff_id", async () => {
      (mockClient.post as any).mockResolvedValue({ message: "Admin Agent unsubscribed" });

      await endpoints.unsubscribeFromTicket("123", 5);

      expect(mockClient.post).toHaveBeenCalledWith("/ticket/123/unsubscribe/", {
        staff_id: 5
      });
    });
  });

  describe("createTicketsBulk", () => {
    it("throws error for more than 100 tickets", async () => {
      const tickets = Array(101).fill(BASE_TICKET);

      await expect(endpoints.createTicketsBulk(tickets)).rejects.toThrow(
        "Bulk ticket creation limited to 100 tickets per request"
      );
      expect(mockClient.post).not.toHaveBeenCalled();
    });

    it.each([["an empty list", []], ["a non-list", undefined]])("throws error for %s", async (_what, tickets) => {
      await expect(endpoints.createTicketsBulk(tickets as any)).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        message: expect.stringContaining("At least one ticket is required")
      });
    });

    it("sends every ticket in the single-ticket shape", async () => {
      (mockClient.post as any).mockResolvedValue([
        { display_id: "#DC00000011", id: 11, success: true },
        { display_id: "#DC00000012", id: 12, success: true }
      ]);

      await endpoints.createTicketsBulk([
        { ...BASE_TICKET, subject: "Ticket 1", tags: ["urgent"], custom_fields: { "t-cf-1": "value" } },
        { category: "2", subject: "Ticket 2", html: "<p>Hi</p>", client: 7, assignee: null }
      ]);

      expect(mockClient.post).toHaveBeenCalledWith("/tickets/", [
        {
          category: 1,
          subject: "Ticket 1",
          text: "Test content",
          email: "test@example.com",
          name: "Test User",
          tags: "urgent",
          "t-cf-1": "value"
        },
        { category: 2, subject: "Ticket 2", html: "<p>Hi</p>", client: 7, assignee: null }
      ]);
    });

    it("names the failing ticket by index and sends nothing", async () => {
      await expect(
        endpoints.createTicketsBulk([BASE_TICKET, { ...BASE_TICKET, custom_fields: { "3": [1] } }])
      ).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        message: expect.stringContaining('tickets[1].custom_fields key "3"')
      });
      expect(mockClient.post).not.toHaveBeenCalled();
    });

    it("returns a partial result unchanged (Docs/1039 §5)", async () => {
      const results = [{ display_id: "#DC00000011", id: 11, success: true }, BULK_FAILURE];
      (mockClient.post as any).mockResolvedValue(results);

      await expect(endpoints.createTicketsBulk([BASE_TICKET, BASE_TICKET])).resolves.toEqual(results);
    });

    it("fails with each ticket's errors when none was created, numbered as local errors number them", async () => {
      (mockClient.post as any).mockResolvedValue([BULK_FAILURE, BULK_FAILURE]);

      await expect(endpoints.createTicketsBulk([BASE_TICKET, BASE_TICKET])).rejects.toMatchObject({
        statusCode: 400,
        code: "API_ERROR",
        message:
          "No tickets were created. tickets[0]: category: This field is required.; " +
          "tickets[1]: category: This field is required."
      });
    });

    it("accepts exactly 100 tickets", async () => {
      const results = Array.from({ length: 100 }, (_, i) => ({
        display_id: `#DC${String(i + 1).padStart(8, "0")}`,
        id: i + 1,
        success: true
      }));
      (mockClient.post as any).mockResolvedValue(results);

      await expect(endpoints.createTicketsBulk(Array(100).fill(BASE_TICKET))).resolves.toEqual(results);
    });
  });
  describe("ticket_id validation", () => {
    const calls: Array<[string, (id: any) => Promise<unknown>]> = [
      ["getTicket", id => endpoints.getTicket(id)],
      ["updateTags", id => endpoints.updateTags(id, { add: ["x"], staff_id: 7 })],
      ["updateCustomFields", id => endpoints.updateCustomFields(id, { "t-cf-1": "x" }, 7)],
      ["moveCategory", id => endpoints.moveCategory(id, { staff_id: 7, target_category_id: 2 })],
      ["addStaffReply", id => endpoints.addStaffReply(id, { plaintext: "Hi", staff_id: 7 })],
      ["updateTicketProperties", id => endpoints.updateTicketProperties(id, { status: 2, staff_id: 7 })],
      ["addPrivateNote", id => endpoints.addPrivateNote(id, { plaintext: "Hi", staff_id: 7 })],
      ["forwardTicket", id => endpoints.forwardTicket(id, { to: ["x@example.com"], subject: "s", message: "m", staff_id: 7 })],
      ["deleteTicket", id => endpoints.deleteTicket(id, 7)],
      ["addContactReply", id => endpoints.addContactReply(id, { text: "Hi", user: 1 })],
      ["subscribeToTicket", id => endpoints.subscribeToTicket(id, 7)],
      ["unsubscribeFromTicket", id => endpoints.unsubscribeFromTicket(id, 7)]
    ];

    it.each(calls)("%s rejects injected and malformed ids before any request", async (_name, call) => {
      for (const id of [...INJECTION_IDS, ...MALFORMED_IDS]) {
        await expect(call(id)).rejects.toMatchObject({
          statusCode: 400,
          code: "INVALID_ID",
          message: expect.stringContaining("ticket_id")
        });
      }
      expect(mockClient.get).not.toHaveBeenCalled();
      expect(mockClient.post).not.toHaveBeenCalled();
    });

    it("accepts a numeric ticket number", async () => {
      await endpoints.subscribeToTicket(123, 7);
      expect(mockClient.post).toHaveBeenCalledWith("/ticket/123/subscribe/", { staff_id: 7 });
    });

    it("writes a digit string in canonical form", async () => {
      await endpoints.updateTags("0042", { add: ["x"] });
      expect(mockClient.post).toHaveBeenCalledWith("/ticket/42/update_tags/", { add: "x" });
    });
  });
});

describe("ticket tool schemas", () => {
  const tools = new Map(new TicketTools().getTools().map(tool => [tool.name, tool]));
  const create = tools.get("happyfox_create_ticket")!.inputSchema;
  const bulk = tools.get("happyfox_create_tickets_bulk")!.inputSchema.properties.tickets;
  const list = tools.get("happyfox_list_tickets")!.inputSchema.properties;

  it("requires only what Docs/1039 §4 requires of every ticket", () => {
    expect(create.required).toEqual(["category", "subject"]);
    expect(bulk.items).toEqual({ type: "object", properties: create.properties, required: create.required });
    expect(bulk.maxItems).toBe(100);
  });

  it("offers the documented optional create fields", () => {
    expect(Object.keys(create.properties)).toEqual(expect.arrayContaining([
      "html", "client", "created_at", "due_date", "visible_only_staff", "assignee", "custom_fields"
    ]));
    expect(create.properties.assignee.type).toContain("null");
    expect(create.properties.custom_fields.propertyNames.pattern).toBe("^(t-cf-|c-cf-)[1-9][0-9]*$");
  });

  it("asks for a public category, the only kind Docs/1039 §4 creates tickets in", () => {
    const category = create.properties.category.description;
    expect(category).toContain("`public` is true");
    expect(category).toContain("happyfox://categories");
    expect(bulk.items.properties.category).toBe(create.properties.category);
  });

  it("gives the documented custom field value formats and id sources on ticket creation", () => {
    const customFields = create.properties.custom_fields.description;
    expect(customFields).toContain(CUSTOM_FIELD_VALUE_FORMATS);
    expect(customFields).toContain("happyfox://ticket-custom-fields");
    expect(customFields).toContain("happyfox://contact-custom-fields");
    expect(customFields).toContain("never from agent portal URLs");
    expect(customFields).toContain("Every field marked `required` must be given");
    expect(create.properties.custom_fields.additionalProperties.anyOf).toHaveLength(3);
  });

  it("says minify_response returns only ticket ids and points to fields (Docs/1039 §1)", () => {
    expect(list.minify_response.description).toContain("only the list of ticket ids");
    expect(list.minify_response.description).toContain("use fields instead");
  });

  it("promises no bulk result order and says how to check a failed ticket", () => {
    const description = tools.get("happyfox_create_tickets_bulk")!.description;
    expect(description).not.toContain("input order");
    expect(description).toContain("HappyFox documents no result order and a failed entry names no ticket");
    expect(description).toContain("happyfox_list_tickets");
  });

  it("lists exactly the 22 documented sort values", () => {
    expect(list.sort_by.enum).toHaveLength(22);
    expect(list.sort_by.enum).toEqual(expect.arrayContaining(["createa", "created", "last_modifiedd", "clientd"]));
    expect(list.sort_by.enum).not.toContain("created_at");
  });

  it("teaches assignee:none, not the doc's bullet-prefixed --none", () => {
    expect(list.query.description).toContain("assignee:none");
    expect(list.query.description).not.toContain("--none");
  });

  it("gives the time filters and a date custom field their own documented date forms (Docs/1039 §2.1)", () => {
    expect(list.query.description).toContain('created-after:"2024/01/15"');
    expect(list.query.description).toContain('"Date Field":"08/23/2019"');
  });

  it("checks the create due_date against the documented formats", () => {
    expect(create.properties.due_date.pattern).toBe(DUE_DATE_PATTERN);
  });

  it("describes every ticket_id as the numeric ticket number", () => {
    for (const tool of tools.values()) {
      const ticketId = tool.inputSchema.properties.ticket_id;
      if (ticketId) expect(ticketId, tool.name).toBe(TICKET_ID_PROPERTY);
    }
  });

  it("offers no attachment parameters", () => {
    const names = (schema: any): string[] => Object.entries(schema?.properties ?? {})
      .flatMap(([name, property]: [string, any]) => [name, ...names(property), ...names(property.items)]);
    for (const tool of tools.values()) {
      expect(names(tool.inputSchema).filter(name => /attachment/i.test(name)), tool.name).toEqual([]);
    }
  });

  it("offers every documented staff_update field on the staff reply (Docs/1039 §8)", () => {
    const reply = tools.get("happyfox_add_staff_reply")!;
    expect(Object.keys(reply.inputSchema.properties).sort()).toEqual([
      "assignee", "bcc", "cc", "custom_fields", "due_date", "html", "last_staff_message", "parent_update",
      "plaintext", "priority", "send_survey", "staff_id", "status", "subject", "tags", "ticket_id",
      "time_spent", "update_customer"
    ]);
    expect(reply.inputSchema.required).toEqual(["ticket_id"]);
    expect(reply.inputSchema.properties.assignee.type).toContain("null");
    expect(reply.inputSchema.properties.custom_fields.propertyNames.pattern).toBe("^(t-cf-|ccf-)[1-9][0-9]*$");
    expect(reply.description).toContain("only when update_customer is true");
    expect(reply.description).toContain("concurrent");
  });

  it("offers every documented staff_pvtnote field on the private note (Docs/1039 §9)", () => {
    const note = tools.get("happyfox_add_private_note")!.inputSchema;
    expect(Object.keys(note.properties).sort()).toEqual([
      "alert", "assignee", "custom_fields", "due_date", "html", "plaintext", "priority", "staff_id", "status",
      "tags", "ticket_id", "time_spent"
    ]);
    expect(note.properties.alert.pattern).toBe("^(s|c|[0-9]+)$");
  });

  it("offers a property-only staff_update with no message fields (Docs/1039 §8.1)", () => {
    const properties = tools.get("happyfox_update_ticket_properties")!.inputSchema;
    expect(Object.keys(properties.properties).sort()).toEqual([
      "assignee", "custom_fields", "due_date", "priority", "staff_id", "status", "tags", "ticket_id", "time_spent"
    ]);
    expect(properties.required).toEqual(["ticket_id"]);
  });

  it("requires what Docs/1039 §10, §11, §15 and §16 require", () => {
    expect(tools.get("happyfox_add_contact_reply")!.inputSchema.required).toEqual(["ticket_id", "user", "text"]);
    expect(tools.get("happyfox_forward_ticket")!.inputSchema.required).toEqual(["ticket_id", "to", "subject", "message"]);
    expect(tools.get("happyfox_move_ticket_category")!.inputSchema.required).toEqual(["ticket_id", "target_category_id"]);

    const customFields = tools.get("happyfox_update_ticket_custom_fields")!.inputSchema;
    expect(customFields.properties).not.toHaveProperty("staff");
    expect(customFields.properties).toHaveProperty("staff_id");
    expect(customFields.properties.custom_fields.propertyNames.pattern).toBe("^(t-cf-)[1-9][0-9]*$");
  });

  it("offers the documented forward, move and subscribe options", () => {
    expect(Object.keys(tools.get("happyfox_forward_ticket")!.inputSchema.properties)).toEqual(expect.arrayContaining([
      "cc", "bcc", "to_include_ticket_contact", "cc_include_ticket_contact", "send_all_messages",
      "include_pvt_notes", "convert_replies_as_new_ticket"
    ]));
    const move = tools.get("happyfox_move_ticket_category")!;
    expect(Object.keys(move.inputSchema.properties)).toEqual(expect.arrayContaining(["move_note", "assign_to"]));
    expect(move.description).toContain("permission to move tickets");
    expect(tools.get("happyfox_subscribe_to_ticket")!.inputSchema.properties.data.type).toBe("array");
  });
});
