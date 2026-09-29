import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ContactEndpoints } from "../../../../src/happyfox/endpoints/contacts";
import { HappyFoxClient } from "../../../../src/happyfox/client";
import { ContactTools } from "../../../../src/mcp/tools/contacts";
import { referenceCache } from "../../../../src/cache/reference-cache";
import { TOOL_SCOPE_MAP } from "../../../../src/oauth/services/scope-enforcer";
import { HappyFoxAuth } from "../../../../src/types";
import { createMockClient } from "../../../helpers/client-mock";
import { INJECTION_IDS, MALFORMED_IDS } from "../../../helpers/invalid-ids";
import {
  fetchMock,
  resetFetchMock,
  mockHappyFoxGet,
  mockHappyFoxPost,
  lastHappyFoxRequest
} from "../../../helpers/fetch-mock-helpers";

const AUTH: HappyFoxAuth = { apiKey: "k", authCode: "c", accountName: "testaccount", region: "us" };

/** A failed update_contacts entry as Docs/1092 §12 documents it. */
const GROUP_ADD_FAILURE = {
  errors: [{ field: "contact", errors: ["Select a valid choice. That choice is not one of the available choices."] }],
  success: false
};

describe("ContactEndpoints", () => {
  let mockClient: ReturnType<typeof createMockClient>;
  let endpoints: ContactEndpoints;

  beforeEach(() => {
    mockClient = createMockClient();
    endpoints = new ContactEndpoints(mockClient as any);
    (mockClient.post as any).mockResolvedValue({ id: 1 });
  });

  /** The body of the only POST sent. */
  function postedBody(): any {
    expect(mockClient.post).toHaveBeenCalledTimes(1);
    return (mockClient.post as any).mock.calls[0][1];
  }

  describe("phones (via createContact)", () => {
    const create = (phones: any[]) => endpoints.createContact({ name: "Test", email: "test@example.com", phones });

    it.each([
      ["mobile", "mo"],
      ["work", "w"],
      ["main", "m"],
      ["home", "h"],
      ["other", "o"]
    ])("maps '%s' to the Docs/1092 §4 code '%s'", async (word, code) => {
      await create([{ number: "555-1234", type: word }]);

      expect(postedBody().phones).toEqual([{ type: code, number: "555-1234" }]);
    });

    it("accepts the API codes and any case, so a type read from a contact can be sent back", async () => {
      await create([{ number: "1", type: "MOBILE" }, { number: "2", type: "w" }, { number: "3", type: "Mo" }]);

      expect(postedBody().phones.map((phone: any) => phone.type)).toEqual(["mo", "w", "mo"]);
    });

    it("omits type when not given, leaving HappyFox's documented default of other", async () => {
      await create([{ number: "555-1234" }]);

      expect(postedBody().phones).toEqual([{ number: "555-1234" }]);
    });

    it("rejects a type outside the documented set instead of filing it as other", async () => {
      await expect(create([{ number: "555-1234", type: "fax" }])).rejects.toMatchObject({
        statusCode: 400,
        code: "INVALID_ARGUMENT",
        message: expect.stringContaining("phones[0].type")
      });
      expect(mockClient.post).not.toHaveBeenCalled();
    });

    it("sends is_primary only on the phones that set it", async () => {
      await create([{ number: "555-1111", type: "mobile" }, { number: "555-2222", type: "work", is_primary: true }]);

      expect(postedBody().phones).toEqual([
        { type: "mo", number: "555-1111" },
        { type: "w", number: "555-2222", is_primary: true }
      ]);
    });

    it("keeps an explicit is_primary false", async () => {
      await create([{ number: "555-1111", type: "mobile", is_primary: false }]);

      expect(postedBody().phones).toEqual([{ type: "mo", number: "555-1111", is_primary: false }]);
    });

    it.each([
      ["two primaries", [{ number: "1", is_primary: true }, { number: "2", is_primary: true }], "is_primary"],
      ["a missing number", [{ type: "mobile" }], "phones[0].number"],
      ["a numeric number", [{ number: 5551234 }], "phones[0].number"],
      ["a non-boolean is_primary", [{ number: "1", is_primary: "yes" }], "phones[0].is_primary"],
      ["a non-object entry", ["555-1234"], "phones[0]"]
    ])("rejects %s", async (_case, phones, param) => {
      await expect(create(phones as any[])).rejects.toMatchObject({
        statusCode: 400,
        message: expect.stringContaining(param)
      });
      expect(mockClient.post).not.toHaveBeenCalled();
    });

    it("refuses a phone id on create, where HappyFox would add the phone instead of editing it", async () => {
      await expect(create([{ number: "555-1234", type: "work", id: 31 }])).rejects.toMatchObject({
        statusCode: 400,
        code: "INVALID_ARGUMENT",
        message: "phones[0].id is not accepted here, where every phone is added. To change an existing phone, " +
          "use happyfox_update_contact."
      });
      expect(mockClient.post).not.toHaveBeenCalled();
    });
  });

  describe("createContact", () => {
    it("sends the Docs/1092 §4 fields", async () => {
      await endpoints.createContact({ name: "John Doe", email: "john@example.com" });

      expect(mockClient.post).toHaveBeenCalledWith("/users/", { name: "John Doe", email: "john@example.com" });
    });

    it("creates a phone-only contact with email null, which Docs/1092 §4 requires even beside phones", async () => {
      await endpoints.createContact({ name: "Jane", phones: [{ number: "987654321", type: "mobile" }] });

      expect(postedBody()).toEqual({ name: "Jane", email: null, phones: [{ type: "mo", number: "987654321" }] });
    });

    it("accepts an explicit email null beside phones", async () => {
      await endpoints.createContact({ name: "Jane", email: null, phones: [{ number: "1" }] });

      expect(postedBody().email).toBeNull();
    });

    it.each([
      ["neither email nor phones", { name: "Jane" }, "email or phones is required"],
      ["email null without phones", { name: "Jane", email: null, phones: [] }, "email or phones is required"],
      ["no name", { email: "jane@example.com" }, "name is required"],
      ["a non-string email", { name: "Jane", email: 5 }, "email"]
    ])("rejects %s", async (_case, data, message) => {
      await expect(endpoints.createContact(data as any)).rejects.toMatchObject({
        statusCode: 400,
        code: "INVALID_ARGUMENT",
        message: expect.stringContaining(message)
      });
      expect(mockClient.post).not.toHaveBeenCalled();
    });

    it.each([
      [true, "TRUE"],
      [false, "FALSE"]
    ])("sends is_login_enabled %s as the Docs/1092 §7 string %s", async (value, sent) => {
      await endpoints.createContact({ name: "T", email: "t@example.com", is_login_enabled: value });

      expect(postedBody().is_login_enabled).toBe(sent);
    });

    it("rejects a non-boolean is_login_enabled", async () => {
      await expect(endpoints.createContact({ name: "T", email: "t@example.com", is_login_enabled: "TRUE" as any }))
        .rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining("is_login_enabled") });
      expect(mockClient.post).not.toHaveBeenCalled();
    });

    it("sends c-cf-<id> custom fields as top-level keys, with choice ids as numbers", async () => {
      await endpoints.createContact({
        name: "Test",
        email: "test@example.com",
        custom_fields: { "c-cf-1": "value1", "c-cf-2": 3, "c-cf-5": ["4", 1] }
      });

      expect(postedBody()).toEqual({
        name: "Test",
        email: "test@example.com",
        "c-cf-1": "value1",
        "c-cf-2": 3,
        "c-cf-5": [4, 1]
      });
    });

    it.each(["email", "name", "t-cf-1", "3", "c-cf-0"])(
      "rejects custom_fields key %j instead of sending or overwriting it",
      async key => {
        await expect(endpoints.createContact({
          name: "Test",
          email: "test@example.com",
          custom_fields: { [key]: "other@example.com" }
        })).rejects.toMatchObject({ statusCode: 400, code: "INVALID_ARGUMENT", message: expect.stringContaining(key) });
        expect(mockClient.post).not.toHaveBeenCalled();
      }
    );

    it("refuses the retired contact_groups field instead of reporting a membership that never changed", async () => {
      await expect(
        endpoints.createContact({ name: "T", email: "t@example.com", contact_groups: ["1", "2"] } as any)
      ).rejects.toMatchObject({
        statusCode: 400,
        code: "INVALID_ARGUMENT",
        message: expect.stringMatching(/^contact_groups is not accepted.*happyfox_add_contacts_to_group\.$/)
      });
      expect(mockClient.post).not.toHaveBeenCalled();
    });
  });

  describe("upsertContactsBulk", () => {
    it("posts the Docs/1092 §5 top-level list to /users/", async () => {
      (mockClient.post as any).mockResolvedValue([
        { email: "johnsmith@example.com", success: true, id: 14 },
        { email: "nathen@example.com", success: true, id: 15 }
      ]);

      const result = await endpoints.upsertContactsBulk([
        { email: "johnsmith@example.com", name: "John Smith", custom_fields: { "c-cf-4": "XHR1234" } },
        { email: "nathen@example.com", name: "Nathan", custom_fields: { "c-cf-4": "LDA5000" } }
      ]);

      expect(mockClient.post).toHaveBeenCalledWith("/users/", [
        { email: "johnsmith@example.com", name: "John Smith", "c-cf-4": "XHR1234" },
        { email: "nathen@example.com", name: "Nathan", "c-cf-4": "LDA5000" }
      ]);
      expect(result).toHaveLength(2);
    });

    it("lets an entry that edits an existing contact omit name", async () => {
      (mockClient.post as any).mockResolvedValue([{ email: "a@example.com", success: true, id: 1 }]);

      await endpoints.upsertContactsBulk([{ email: "a@example.com", is_login_enabled: false }]);

      expect(postedBody()).toEqual([{ email: "a@example.com", is_login_enabled: "FALSE" }]);
    });

    it("formats each entry's phones", async () => {
      (mockClient.post as any).mockResolvedValue([{ success: true, id: 1 }]);

      await endpoints.upsertContactsBulk([{ name: "P", phones: [{ number: "1", type: "home" }] }]);

      expect(postedBody()).toEqual([{ name: "P", email: null, phones: [{ type: "h", number: "1" }] }]);
    });

    it.each([
      ["an empty list", [], "At least one contact"],
      ["more than 100 contacts", Array.from({ length: 101 }, (_, i) => ({ email: `c${i}@example.com` })), "100"],
      ["an entry without email or phones", [{ email: "a@example.com" }, { name: "B" }], "contacts[1].email or contacts[1].phones"],
      ["a bad custom field key", [{ email: "a@example.com", custom_fields: { email: "x" } }], "contacts[0].custom_fields"],
      ["a bad phone type", [{ email: "a@example.com", phones: [{ number: "1", type: "fax" }] }], "contacts[0].phones[0].type"],
      [
        "a phone id, which Docs/1092 §4 Example 2 would read as an edit",
        [{ email: "jamesmay@example1.com", phones: [{ id: 20, type: "mobile", number: "987654321" }] }],
        "contacts[0].phones[0].id is not accepted here"
      ],
      ["the retired contact_groups", [{ email: "a@example.com" }, { email: "b@example.com", contact_groups: [5] }], "contacts[1].contact_groups"],
      ["a non-object entry", ["a@example.com"], "contacts[0]"]
    ])("rejects %s before sending", async (_case, contacts, message) => {
      await expect(endpoints.upsertContactsBulk(contacts as any)).rejects.toMatchObject({
        statusCode: 400,
        message: expect.stringContaining(message)
      });
      expect(mockClient.post).not.toHaveBeenCalled();
    });

    it("returns a partial result so each entry can be checked", async () => {
      const results = [
        { email: "a@example.com", success: true, id: 1 },
        { success: false, error: [{ field: "name", errors: ["This field is required."] }] }
      ];
      (mockClient.post as any).mockResolvedValue(results);

      await expect(endpoints.upsertContactsBulk([{ email: "a@example.com" }, { email: "b@example.com" }]))
        .resolves.toEqual(results);
    });

    it("fails, naming each error, when no contact was saved", async () => {
      (mockClient.post as any).mockResolvedValue([
        { success: false, error: [{ field: "name", errors: ["This field is required."] }] }
      ]);

      await expect(endpoints.upsertContactsBulk([{ email: "b@example.com" }])).rejects.toMatchObject({
        statusCode: 400,
        code: "API_ERROR",
        message: "No contacts were saved. contacts[0]: name: This field is required."
      });
    });
  });

  describe("listContacts", () => {
    beforeEach(() => {
      (mockClient.get as any).mockResolvedValue({ data: [] });
    });

    it("sets default pagination", async () => {
      await endpoints.listContacts();

      expect(mockClient.get).toHaveBeenCalledWith("/users/", { page: 1, size: 50 });
    });

    it("caps size at 50", async () => {
      await endpoints.listContacts({ size: 100 });

      expect(mockClient.get).toHaveBeenCalledWith("/users/", expect.objectContaining({ size: 50 }));
    });

    it("passes page and size through", async () => {
      await endpoints.listContacts({ page: 2, size: 25 });

      expect(mockClient.get).toHaveBeenCalledWith("/users/", { page: 2, size: 25 });
    });

    it("takes page and size as digit strings", async () => {
      await endpoints.listContacts({ page: "3", size: "10" } as any);

      expect(mockClient.get).toHaveBeenCalledWith("/users/", { page: 3, size: 10 });
    });

    it.each([
      ["page", "abc"], ["page", -3], ["page", 0], ["page", { a: 1 }], ["page", 1.5],
      ["size", "abc"], ["size", -5], ["size", 0], ["size", { a: 1 }], ["size", Number.NaN]
    ])("refuses %s %j before any request", async (param, value) => {
      await expect(endpoints.listContacts({ [param]: value } as any)).rejects.toMatchObject({
        statusCode: 400,
        code: "INVALID_ARGUMENT",
        message: expect.stringMatching(new RegExp(`^Invalid ${param} .*: expected a positive integer\\.$`))
      });
      expect(mockClient.get).not.toHaveBeenCalled();
    });

    it("maps query to 'q'", async () => {
      await endpoints.listContacts({ query: "name:adam email:adam@example.com" });

      expect(mockClient.get).toHaveBeenCalledWith("/users/", {
        page: 1,
        size: 50,
        q: "name:adam email:adam@example.com"
      });
    });

    it("drops the '+' Docs/1092 §2 says a phone search must not include", async () => {
      await endpoints.listContacts({ query: "phone:+11231231234 name:a+b" });

      expect((mockClient.get as any).mock.calls[0][1].q).toBe("phone:11231231234 name:a+b");
    });

    it("sends terms separated by spaces on the wire, as the Docs/1092 §2 example does", async () => {
      resetFetchMock();
      mockHappyFoxGet("/users/", { page_info: {}, data: [] });

      await new ContactEndpoints(new HappyFoxClient(AUTH)).listContacts({ query: "name:adam created_since:2024-01-15" });

      const { query } = lastHappyFoxRequest();
      expect(query.get("q")).toBe("name:adam created_since:2024-01-15");
      expect(query.get("size")).toBe("50");
    });
  });

  describe("getContact", () => {
    it("fetches contact by ID", async () => {
      (mockClient.get as any).mockResolvedValue({ id: 123 });

      await endpoints.getContact("123");

      expect(mockClient.get).toHaveBeenCalledWith("/user/123/");
    });
  });

  describe("updateContact", () => {
    it("edits a phone by id in the Docs/1092 §14 shape, without promoting it to primary", async () => {
      await endpoints.updateContact("33", {
        email: "georgen@example.com",
        phones: [{ type: "work", id: 31, number: "555-0123" }]
      });

      expect(mockClient.post).toHaveBeenCalledWith("/user/33/", {
        email: "georgen@example.com",
        phones: [{ type: "w", number: "555-0123", id: 31 }]
      });
    });

    it("keeps an explicit is_primary on an edited phone, as Docs/1092 §4 Example 2 sends it", async () => {
      (mockClient.get as any).mockResolvedValue({ id: 33, email: "jamesmay@example1.com", phones: [] });
      await endpoints.updateContact("33", { phones: [{ type: "mobile", id: "20", number: "987654321", is_primary: true }] });

      expect(postedBody().phones).toEqual([{ type: "mo", number: "987654321", is_primary: true, id: 20 }]);
    });

    it("reads the contact's email and sends it with a phone edit, as both documented edits do", async () => {
      (mockClient.get as any).mockResolvedValue({ id: 33, email: "georgen@example.com", phones: [] });
      await endpoints.updateContact(33, { phones: [{ type: "work", id: 31, number: "555-0123" }] });

      expect(mockClient.get).toHaveBeenCalledWith("/user/33/");
      expect(mockClient.post).toHaveBeenCalledWith("/user/33/", {
        email: "georgen@example.com",
        phones: [{ type: "w", number: "555-0123", id: 31 }]
      });
    });

    it("sends email null with a phone edit on a phone-only contact", async () => {
      (mockClient.get as any).mockResolvedValue({ id: 33, email: null, phones: [] });
      await endpoints.updateContact(33, { phones: [{ type: "work", id: 31, number: "555-0123" }] });

      expect(postedBody()).toEqual({ email: null, phones: [{ type: "w", number: "555-0123", id: 31 }] });
    });

    it("uses an email contact_id as the phone edit's email without reading the contact", async () => {
      await endpoints.updateContact("a+b@example.com", { phones: [{ type: "home", id: 31, number: "1" }] });

      expect(mockClient.get).not.toHaveBeenCalled();
      expect(mockClient.post).toHaveBeenCalledWith("/user/a%2Bb@example.com/", {
        email: "a+b@example.com",
        phones: [{ type: "h", number: "1", id: 31 }]
      });
    });

    it("refuses a phone edit when the contact read has no email field", async () => {
      (mockClient.get as any).mockResolvedValue({ id: 33 });

      await expect(endpoints.updateContact(33, { phones: [{ type: "work", id: 31, number: "1" }] }))
        .rejects.toMatchObject({ code: "INVALID_RESPONSE" });
      expect(mockClient.post).not.toHaveBeenCalled();
    });

    it("requires the type of a phone edited by id, since HappyFox defaults it to other", async () => {
      await expect(endpoints.updateContact(33, { email: "a@example.com", phones: [{ id: 31, number: "555-0123" }] }))
        .rejects.toMatchObject({ code: "INVALID_ARGUMENT", message: expect.stringContaining("phones[0].type") });
      expect(mockClient.get).not.toHaveBeenCalled();
      expect(mockClient.post).not.toHaveBeenCalled();
    });

    it("omits id for new phones and reads no email for them", async () => {
      await endpoints.updateContact("123", { phones: [{ number: "555-9999" }] });

      expect(postedBody()).toEqual({ phones: [{ number: "555-9999" }] });
      expect(mockClient.get).not.toHaveBeenCalled();
    });

    it("rejects a malformed phone id before sending", async () => {
      await expect(endpoints.updateContact("123", { phones: [{ number: "1", type: "work", id: "31/x" as any }] }))
        .rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining("phones[0].id") });
      expect(mockClient.post).not.toHaveBeenCalled();
    });

    it("only includes provided fields", async () => {
      await endpoints.updateContact("123", { name: "New Name" });

      expect(postedBody()).toEqual({ name: "New Name" });
    });

    it.each([
      [true, "TRUE"],
      [false, "FALSE"]
    ])("sends is_login_enabled %s as the Docs/1092 §7 string %s", async (value, sent) => {
      await endpoints.updateContact("123", { is_login_enabled: value });

      expect(mockClient.post).toHaveBeenCalledWith("/user/123/", { is_login_enabled: sent });
    });

    it("sends c-cf-<id> custom fields as top-level keys", async () => {
      await endpoints.updateContact("123", { custom_fields: { "c-cf-1": "updated", "c-cf-2": "2024-01-15" } });

      expect(postedBody()).toEqual({ "c-cf-1": "updated", "c-cf-2": "2024-01-15" });
    });

    it("rejects a custom_fields key that would overwrite a core field", async () => {
      await expect(endpoints.updateContact("123", { custom_fields: { email: "x@example.com" } }))
        .rejects.toMatchObject({ statusCode: 400, code: "INVALID_ARGUMENT" });
      expect(mockClient.post).not.toHaveBeenCalled();
    });

    it("refuses an empty change, which could reset custom fields for nothing", async () => {
      await expect(endpoints.updateContact("123", { name: "", phones: [] })).rejects.toMatchObject({
        statusCode: 400,
        message: expect.stringContaining("at least one field")
      });
      expect(mockClient.post).not.toHaveBeenCalled();
    });

    it("refuses the retired contact_groups field", async () => {
      await expect(endpoints.updateContact("123", { name: "A", contact_groups: ["1", "2"] } as any)).rejects.toMatchObject({
        statusCode: 400,
        code: "INVALID_ARGUMENT",
        message: expect.stringContaining("happyfox_add_contacts_to_group")
      });
      expect(mockClient.get).not.toHaveBeenCalled();
      expect(mockClient.post).not.toHaveBeenCalled();
    });

    it("updates all documented fields together", async () => {
      await endpoints.updateContact("123", {
        name: "Updated Name",
        email: "updated@example.com",
        phones: [{ number: "555-9999", type: "work" }],
        is_login_enabled: true,
        custom_fields: { "c-cf-1": "value" }
      });

      expect(postedBody()).toEqual({
        name: "Updated Name",
        email: "updated@example.com",
        phones: [{ type: "w", number: "555-9999" }],
        is_login_enabled: "TRUE",
        "c-cf-1": "value"
      });
    });
  });

  describe("getContactGroup", () => {
    it("fetches group by ID", async () => {
      (mockClient.get as any).mockResolvedValue({ id: 1 });

      await endpoints.getContactGroup("1");

      expect(mockClient.get).toHaveBeenCalledWith("/contact_group/1/");
    });
  });

  describe("createContactGroup", () => {
    it("sends name only when nothing else is given", async () => {
      await endpoints.createContactGroup({ name: "New Group" });

      expect(mockClient.post).toHaveBeenCalledWith("/contact_groups/", { name: "New Group" });
    });

    it("sends the Docs/1092 §10 payload, with tagged_domains comma-separated", async () => {
      await endpoints.createContactGroup({
        name: "test group",
        description: "example description",
        tagged_domains: ["example.com", "acme.com"]
      });

      expect(mockClient.post).toHaveBeenCalledWith("/contact_groups/", {
        name: "test group",
        description: "example description",
        tagged_domains: "example.com,acme.com"
      });
    });

    it.each([
      ["no name", { description: "d" }, "name is required"],
      ["a domain with a comma", { name: "G", tagged_domains: ["a.com,b.com"] }, "tagged_domains"],
      ["a domain with a space", { name: "G", tagged_domains: ["a .com"] }, "tagged_domains"],
      ["a string of domains", { name: "G", tagged_domains: "a.com" }, "tagged_domains"]
    ])("rejects %s", async (_case, data, message) => {
      await expect(endpoints.createContactGroup(data as any)).rejects.toMatchObject({
        statusCode: 400,
        message: expect.stringContaining(message)
      });
      expect(mockClient.post).not.toHaveBeenCalled();
    });
  });

  describe("updateContactGroup", () => {
    it("sends the Docs/1092 §11 edit fields", async () => {
      await endpoints.updateContactGroup("1", { description: "New description", tagged_domains: ["example.com"] });

      expect(mockClient.post).toHaveBeenCalledWith("/contact_group/1/", {
        description: "New description",
        tagged_domains: "example.com"
      });
    });

    it("clears the description with an empty string", async () => {
      await endpoints.updateContactGroup("1", { description: "" });

      expect(mockClient.post).toHaveBeenCalledWith("/contact_group/1/", { description: "" });
    });

    it("removes every tagged domain with an empty list", async () => {
      await endpoints.updateContactGroup("1", { tagged_domains: [] });

      expect(mockClient.post).toHaveBeenCalledWith("/contact_group/1/", { tagged_domains: "" });
    });

    it.each([
      ["alone", { name: "Renamed" }],
      ["beside a description", { name: "Renamed", description: "d" }]
    ])("refuses name %s, which the edit table does not list, instead of dropping it", async (_case, changes) => {
      await expect(endpoints.updateContactGroup("1", changes as any)).rejects.toMatchObject({
        statusCode: 400,
        code: "INVALID_ARGUMENT",
        message: "name is not accepted: a contact group cannot be renamed. Give description, tagged_domains or both."
      });
      expect(mockClient.post).not.toHaveBeenCalled();
    });
  });

  describe("addContactsToGroup", () => {
    beforeEach(() => {
      (mockClient.post as any).mockResolvedValue([{ data: { contact: 10, access_tickets: false }, success: true }]);
    });

    it("posts the Docs/1092 §12 top-level list of {contact}", async () => {
      await endpoints.addContactsToGroup("1", [10, "20", 30]);

      expect(mockClient.post).toHaveBeenCalledWith("/contact_group/1/update_contacts/", [
        { contact: 10 },
        { contact: 20 },
        { contact: 30 }
      ]);
    });

    it.each([true, false])("sends access_tickets %s on every entry when given", async value => {
      await endpoints.addContactsToGroup(1, [41, 200], value);

      expect(postedBody()).toEqual([
        { contact: 41, access_tickets: value },
        { contact: 200, access_tickets: value }
      ]);
    });

    it("accepts exactly 100 contacts", async () => {
      await endpoints.addContactsToGroup(1, Array.from({ length: 100 }, (_, i) => i + 1));

      expect(postedBody()).toHaveLength(100);
    });

    it.each([
      ["101 contacts", Array.from({ length: 101 }, (_, i) => i + 1), undefined, "at most 100"],
      ["no contacts", [], undefined, "contact_ids is required"],
      ["a display id", [1, "#HFS1"], undefined, "contact_ids[1]"],
      ["an email", ["a@example.com"], undefined, "contact_ids[0]"],
      ["a string access_tickets", [1], "true", "access_tickets"]
    ])("rejects %s before sending", async (_case, ids, access, message) => {
      await expect(endpoints.addContactsToGroup(1, ids as any, access as any)).rejects.toMatchObject({
        statusCode: 400,
        message: expect.stringContaining(message)
      });
      expect(mockClient.post).not.toHaveBeenCalled();
    });

    it("returns a partial result so each entry can be checked", async () => {
      const results = [{ data: { access_tickets: true, contact: 1 }, success: true }, GROUP_ADD_FAILURE];
      (mockClient.post as any).mockResolvedValue(results);

      await expect(endpoints.addContactsToGroup(1, [1, 999])).resolves.toEqual(results);
    });

    it("fails, naming each per-contact error, when no contact was added", async () => {
      (mockClient.post as any).mockResolvedValue([GROUP_ADD_FAILURE]);

      await expect(endpoints.addContactsToGroup(1, [999])).rejects.toMatchObject({
        statusCode: 400,
        code: "API_ERROR",
        message:
          "No contacts were added to the group. contact_ids[0]: contact: Select a valid choice. That choice is not one of the available choices."
      });
    });

    it("sends a JSON array body on the wire", async () => {
      resetFetchMock();
      mockHappyFoxPost("/contact_group/3/update_contacts/", [{ data: { contact: 41 }, success: true }]);

      await new ContactEndpoints(new HappyFoxClient(AUTH)).addContactsToGroup(3, [41, 200], true);

      const request = lastHappyFoxRequest();
      expect(request.method).toBe("POST");
      expect(request.apiPath).toBe("/contact_group/3/update_contacts/");
      expect(request.json()).toEqual([{ contact: 41, access_tickets: true }, { contact: 200, access_tickets: true }]);
    });
  });

  describe("removeContactsFromGroup", () => {
    const removed = { data: { message: "Successfully removed contact from group", contact: 1 }, success: true };
    const notMember = { data: { message: "Contact not part of the contact group", contact: 3 }, success: false };

    it("posts the Docs/1092 §6 payload", async () => {
      (mockClient.post as any).mockResolvedValue([removed]);

      await endpoints.removeContactsFromGroup("1", [10, "20", 30]);

      expect(mockClient.post).toHaveBeenCalledWith("/contact_group/1/delete_contacts/", { contacts: [10, 20, 30] });
    });

    it("returns a partial result so each entry can be checked", async () => {
      (mockClient.post as any).mockResolvedValue([removed, notMember]);

      await expect(endpoints.removeContactsFromGroup(1, [1, 3])).resolves.toEqual([removed, notMember]);
    });

    it("fails, naming each contact's message, when no contact was removed", async () => {
      (mockClient.post as any).mockResolvedValue([notMember]);

      await expect(endpoints.removeContactsFromGroup(1, [3])).rejects.toMatchObject({
        statusCode: 400,
        code: "API_ERROR",
        message: "No contacts were removed from the group. contact_ids[0]: contact 3: Contact not part of the contact group"
      });
    });

    it("rejects an empty or malformed id list before sending", async () => {
      await expect(endpoints.removeContactsFromGroup(1, [])).rejects.toMatchObject({ statusCode: 400 });
      await expect(endpoints.removeContactsFromGroup(1, ["1/x"])).rejects.toMatchObject({
        statusCode: 400,
        message: expect.stringContaining("contact_ids[0]")
      });
      expect(mockClient.post).not.toHaveBeenCalled();
    });
  });

  describe("contact_id validation", () => {
    const calls: Array<[string, (id: any) => Promise<unknown>]> = [
      ["getContact", id => endpoints.getContact(id)],
      ["updateContact", id => endpoints.updateContact(id, { custom_fields: { staff_id: 1 } })]
    ];

    it.each(calls)("%s rejects injected and malformed ids before any request", async (_name, call) => {
      const invalid = [
        ...INJECTION_IDS,
        ...MALFORMED_IDS,
        "../ticket/5/delete",
        "x@y/../z",
        "x@example.com#",
        "x@example.com?y=1",
        "x@example.com%2f",
        "a..b@example.com"
      ];
      for (const id of invalid) {
        await expect(call(id)).rejects.toMatchObject({
          statusCode: 400,
          code: "INVALID_ID",
          message: expect.stringContaining("contact_id")
        });
      }
      expect(mockClient.get).not.toHaveBeenCalled();
      expect(mockClient.post).not.toHaveBeenCalled();
    });

    it("percent-encodes # ? and % in an email's local part instead of refusing the address", async () => {
      await endpoints.getContact("a#b?c%d@example.com");
      expect(mockClient.get).toHaveBeenCalledWith("/user/a%23b%3Fc%25d@example.com/");

      resetFetchMock();
      mockHappyFoxGet("/user/a%23b%3Fc%25d@example.com/", { id: 33 });
      await new ContactEndpoints(new HappyFoxClient(AUTH)).getContact("a#b?c%d@example.com");
      expect(lastHappyFoxRequest().url.pathname).toBe("/api/1.1/json/user/a%23b%3Fc%25d@example.com/");
      expect(lastHappyFoxRequest().url.search).toBe("");
      fetchMock.deactivate();
    });

    it("looks a contact up by email address (Docs/1092 §3)", async () => {
      await endpoints.getContact("james@example.com");
      expect(mockClient.get).toHaveBeenCalledWith("/user/james@example.com/");
    });

    it("updates a contact by email address (Docs/1092 §7)", async () => {
      await endpoints.updateContact("james@example.com", { is_login_enabled: false });
      expect(mockClient.post).toHaveBeenCalledWith("/user/james@example.com/", { is_login_enabled: "FALSE" });
    });

    it("percent-encodes an email address", async () => {
      await endpoints.updateContact("a+b@example.com", { name: "A" });
      expect(mockClient.post).toHaveBeenCalledWith("/user/a%2Bb@example.com/", { name: "A" });
    });

    it("accepts a numeric contact id", async () => {
      await endpoints.getContact(33);
      expect(mockClient.get).toHaveBeenCalledWith("/user/33/");
    });
  });

  describe("group_id validation", () => {
    const calls: Array<[string, (id: any) => Promise<unknown>]> = [
      ["getContactGroup", id => endpoints.getContactGroup(id)],
      ["updateContactGroup", id => endpoints.updateContactGroup(id, { description: "G" })],
      ["addContactsToGroup", id => endpoints.addContactsToGroup(id, [1])],
      ["removeContactsFromGroup", id => endpoints.removeContactsFromGroup(id, [1])]
    ];

    it.each(calls)("%s rejects injected and malformed ids before any request", async (_name, call) => {
      for (const id of [...INJECTION_IDS, ...MALFORMED_IDS, "team@example.com"]) {
        await expect(call(id)).rejects.toMatchObject({
          statusCode: 400,
          code: "INVALID_ID",
          message: expect.stringContaining("group_id")
        });
      }
      expect(mockClient.get).not.toHaveBeenCalled();
      expect(mockClient.post).not.toHaveBeenCalled();
    });

    it("accepts a numeric group id", async () => {
      await endpoints.getContactGroup(4);
      expect(mockClient.get).toHaveBeenCalledWith("/contact_group/4/");
    });
  });
});

describe("contact tool schemas", () => {
  const tools = new Map(new ContactTools().getTools().map(tool => [tool.name, tool]));
  const schema = (name: string) => tools.get(name)!.inputSchema;

  it("requires only name on create, and email or phones as Docs/1092 §4 allows", () => {
    const create = schema("happyfox_create_contact");
    expect(create.required).toEqual(["name"]);
    expect(create.properties.email.type).toEqual(["string", "null"]);
    expect(tools.get("happyfox_create_contact")!.description).toContain("edits it");
    expect(tools.get("happyfox_create_contact")!.description).toContain("reset");
  });

  it("makes phone type optional and lists the words it accepts", () => {
    for (const name of ["happyfox_create_contact", "happyfox_update_contact"]) {
      const phones = schema(name).properties.phones;
      expect(phones.items.required, name).toEqual(["number"]);
      expect(phones.items.properties.type.enum, name).toEqual(["mobile", "work", "main", "home", "other"]);
      expect(phones.description, name).not.toMatch(/mo=|w=work/);
    }
    expect(schema("happyfox_update_contact").properties.phones.items.properties).toHaveProperty("id");
    expect(schema("happyfox_create_contact").properties.phones.items.properties).not.toHaveProperty("id");
  });

  it("says a phone edit by id needs its type and is sent with the contact's email", () => {
    const phones = schema("happyfox_update_contact").properties.phones;
    expect(phones.items.properties.id.description).toContain("type is then required");
    expect(phones.description).toContain("contact's email");
  });

  it("does not promise per-item results in input order (Docs/1092 §5, §12)", () => {
    const bulk = tools.get("happyfox_upsert_contacts_bulk")!.description;
    const add = tools.get("happyfox_add_contacts_to_group")!.description;
    for (const description of [bulk, add]) expect(description).not.toContain("input order");
    expect(bulk).toContain("by email or id");
    expect(add).toContain("happyfox_get_contact_group");
  });

  it("offers no undocumented contact_groups input", () => {
    for (const tool of tools.values()) {
      expect(tool.inputSchema.properties, tool.name).not.toHaveProperty("contact_groups");
    }
  });

  it("offers no phone id where phones are only added, and points phone edits at update_contact", () => {
    const phones = schema("happyfox_create_contact").properties.phones;
    expect(phones.items.properties).not.toHaveProperty("id");
    expect(phones.description).toContain("happyfox_update_contact");
    expect(schema("happyfox_update_contact").properties.phones.items.properties).toHaveProperty("id");
  });

  it("keys custom fields c-cf-<id> and states the value formats and the reset", () => {
    for (const name of ["happyfox_create_contact", "happyfox_update_contact"]) {
      const customFields = schema(name).properties.custom_fields;
      expect(customFields.propertyNames.pattern, name).toBe("^(c-cf-)[1-9][0-9]*$");
      expect(customFields.description, name).toContain("happyfox://contact-custom-fields");
      expect(customFields.description, name).toContain("yyyy-mm-dd");
    }
    expect(tools.get("happyfox_update_contact")!.description).toContain("resets every custom field");
  });

  it("addresses a contact by id or email", () => {
    for (const name of ["happyfox_get_contact", "happyfox_update_contact"]) {
      expect(schema(name).properties.contact_id.description, name).toContain("email address");
      expect(schema(name).properties.contact_id).not.toHaveProperty("pattern");
    }
  });

  it("describes the Docs/1092 §2 search syntax and date filters", () => {
    const query = schema("happyfox_list_contacts").properties.query.description;
    for (const term of ["field:value", "name", "email", "phone", "created_since", "updated_since", "leading +"]) {
      expect(query).toContain(term);
    }
  });

  it("exposes tagged_domains on groups and no rename on edit (Docs/1092 §10-11)", () => {
    expect(schema("happyfox_create_contact_group").properties).toHaveProperty("tagged_domains");
    expect(Object.keys(schema("happyfox_update_contact_group").properties).sort())
      .toEqual(["description", "group_id", "tagged_domains"]);
    expect(tools.get("happyfox_update_contact_group")!.description).toContain("cannot be renamed");
  });

  it("offers access_tickets and caps add_contacts_to_group at 100 (Docs/1092 §12)", () => {
    const add = schema("happyfox_add_contacts_to_group");
    expect(add.properties.access_tickets.type).toBe("boolean");
    expect(add.properties.contact_ids.maxItems).toBe(100);
    expect(add.required).toEqual(["group_id", "contact_ids"]);
  });

  it("offers a bulk upsert of up to 100 contacts with the create fields (Docs/1092 §5)", () => {
    const contacts = schema("happyfox_upsert_contacts_bulk").properties.contacts;
    expect(contacts.maxItems).toBe(100);
    expect(contacts.items.properties).toBe(schema("happyfox_create_contact").properties);
    expect(TOOL_SCOPE_MAP.happyfox_upsert_contacts_bulk).toEqual(["happyfox:write"]);
  });

  it("gives every contact tool a scope", () => {
    for (const name of tools.keys()) expect(TOOL_SCOPE_MAP[name], name).toBeDefined();
  });

  it("offers no attachment parameters", () => {
    const names = (s: any): string[] => Object.entries(s?.properties ?? {})
      .flatMap(([name, property]: [string, any]) => [name, ...names(property), ...names(property.items)]);
    for (const tool of tools.values()) {
      expect(names(tool.inputSchema).filter(name => /attachment/i.test(name)), tool.name).toEqual([]);
    }
  });
});

describe("contact group cache after a lost response", () => {
  beforeEach(() => {
    resetFetchMock();
  });

  afterEach(() => {
    fetchMock.deactivate();
  });

  it("leaves happyfox://contact-groups empty when POST /contact_groups/ is reset mid-request", async () => {
    await referenceCache.set(AUTH, "contact-groups", [{ id: 1, name: "Old" }]);
    fetchMock
      .get("https://testaccount.happyfox.com")
      .intercept({ path: "/api/1.1/json/contact_groups/", method: "POST" })
      .replyWithError(Object.assign(new Error("Connection reset"), { code: "ECONNRESET" }));

    await expect(new ContactTools().createContactGroup({ name: "VIP" }, AUTH)).rejects.toMatchObject({
      code: "NETWORK_ERROR",
      message: expect.stringContaining("HappyFox may still have applied this write")
    });
    expect(fetchMock.requests()).toHaveLength(1);
    expect(await referenceCache.get(AUTH, "contact-groups")).toBeNull();
  });
});

describe("contact group cache invalidation", () => {
  const contactTools = new ContactTools();
  let invalidate: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    invalidate = vi.spyOn(referenceCache, "invalidate").mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("drops the cached happyfox://contact-groups after creating a group", async () => {
    vi.spyOn(ContactEndpoints.prototype, "createContactGroup").mockResolvedValue({ id: 5, name: "G" });

    await expect(contactTools.createContactGroup({ name: "G" }, AUTH)).resolves.toEqual({ id: 5, name: "G" });

    expect(invalidate).toHaveBeenCalledWith(AUTH, "contact-groups");
  });

  it("drops the cached happyfox://contact-groups after editing a group", async () => {
    const update = vi.spyOn(ContactEndpoints.prototype, "updateContactGroup").mockResolvedValue({ id: 5 });

    await contactTools.updateContactGroup({ group_id: 5, description: "d" }, AUTH);

    expect(update).toHaveBeenCalledWith(5, { description: "d" });
    expect(invalidate).toHaveBeenCalledWith(AUTH, "contact-groups");
  });

  it("drops the cache when a group write fails, since a lost response can follow an applied change", async () => {
    vi.spyOn(ContactEndpoints.prototype, "createContactGroup").mockRejectedValue(new Error("duplicate name"));
    vi.spyOn(ContactEndpoints.prototype, "updateContactGroup").mockRejectedValue(new Error("not found"));

    await expect(contactTools.createContactGroup({ name: "G" }, AUTH)).rejects.toThrow("duplicate name");
    await expect(contactTools.updateContactGroup({ group_id: 5, description: "d" }, AUTH)).rejects.toThrow("not found");

    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenCalledWith(AUTH, "contact-groups");
  });

  it("leaves the cache alone for membership changes, which the listed fields do not show", async () => {
    vi.spyOn(ContactEndpoints.prototype, "addContactsToGroup").mockResolvedValue([]);
    vi.spyOn(ContactEndpoints.prototype, "removeContactsFromGroup").mockResolvedValue([]);

    await contactTools.addContactsToGroup({ group_id: 5, contact_ids: [1], access_tickets: true }, AUTH);
    await contactTools.removeContactsFromGroup({ group_id: 5, contact_ids: [1] }, AUTH);

    expect(invalidate).not.toHaveBeenCalled();
  });

  it("passes access_tickets through to the endpoint", async () => {
    const add = vi.spyOn(ContactEndpoints.prototype, "addContactsToGroup").mockResolvedValue([]);

    await contactTools.addContactsToGroup({ group_id: 5, contact_ids: [1, 2], access_tickets: true }, AUTH);

    expect(add).toHaveBeenCalledWith(5, [1, 2], true);
  });
});
