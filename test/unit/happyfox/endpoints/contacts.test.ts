import { describe, it, expect, beforeEach } from "vitest";
import { ContactEndpoints } from "../../../../src/happyfox/endpoints/contacts";
import { createMockClient } from "../../../helpers/client-mock";

describe("ContactEndpoints", () => {
  let mockClient: ReturnType<typeof createMockClient>;
  let endpoints: ContactEndpoints;

  beforeEach(() => {
    mockClient = createMockClient();
    endpoints = new ContactEndpoints(mockClient as any);
  });

  describe("phone type mapping (via createContact)", () => {
    it("maps 'mobile' to 'mo'", async () => {
      (mockClient.post as any).mockResolvedValue({ id: 1 });

      await endpoints.createContact({
        name: "Test",
        email: "test@example.com",
        phones: [{ number: "555-1234", type: "mobile" }]
      });

      expect(mockClient.post).toHaveBeenCalledWith("/users/", expect.objectContaining({
        phones: [{ number: "555-1234", type: "mo", is_primary: true }]
      }));
    });

    it("maps 'work' to 'w'", async () => {
      (mockClient.post as any).mockResolvedValue({ id: 1 });

      await endpoints.createContact({
        name: "Test",
        email: "test@example.com",
        phones: [{ number: "555-1234", type: "work" }]
      });

      expect(mockClient.post).toHaveBeenCalledWith("/users/", expect.objectContaining({
        phones: [{ number: "555-1234", type: "w", is_primary: true }]
      }));
    });

    it("maps 'main' to 'm'", async () => {
      (mockClient.post as any).mockResolvedValue({ id: 1 });

      await endpoints.createContact({
        name: "Test",
        email: "test@example.com",
        phones: [{ number: "555-1234", type: "main" }]
      });

      expect(mockClient.post).toHaveBeenCalledWith("/users/", expect.objectContaining({
        phones: [{ number: "555-1234", type: "m", is_primary: true }]
      }));
    });

    it("maps 'home' to 'h'", async () => {
      (mockClient.post as any).mockResolvedValue({ id: 1 });

      await endpoints.createContact({
        name: "Test",
        email: "test@example.com",
        phones: [{ number: "555-1234", type: "home" }]
      });

      expect(mockClient.post).toHaveBeenCalledWith("/users/", expect.objectContaining({
        phones: [{ number: "555-1234", type: "h", is_primary: true }]
      }));
    });

    it("maps 'other' to 'o'", async () => {
      (mockClient.post as any).mockResolvedValue({ id: 1 });

      await endpoints.createContact({
        name: "Test",
        email: "test@example.com",
        phones: [{ number: "555-1234", type: "other" }]
      });

      expect(mockClient.post).toHaveBeenCalledWith("/users/", expect.objectContaining({
        phones: [{ number: "555-1234", type: "o", is_primary: true }]
      }));
    });

    it("maps unknown types to 'o' (default)", async () => {
      (mockClient.post as any).mockResolvedValue({ id: 1 });

      await endpoints.createContact({
        name: "Test",
        email: "test@example.com",
        phones: [{ number: "555-1234", type: "fax" }]
      });

      expect(mockClient.post).toHaveBeenCalledWith("/users/", expect.objectContaining({
        phones: [{ number: "555-1234", type: "o", is_primary: true }]
      }));
    });

    it("handles case-insensitive input", async () => {
      (mockClient.post as any).mockResolvedValue({ id: 1 });

      await endpoints.createContact({
        name: "Test",
        email: "test@example.com",
        phones: [{ number: "555-1234", type: "MOBILE" }]
      });

      expect(mockClient.post).toHaveBeenCalledWith("/users/", expect.objectContaining({
        phones: [{ number: "555-1234", type: "mo", is_primary: true }]
      }));
    });
  });

  describe("createContact", () => {
    it("sends required fields", async () => {
      (mockClient.post as any).mockResolvedValue({ id: 1 });

      await endpoints.createContact({
        name: "John Doe",
        email: "john@example.com"
      });

      expect(mockClient.post).toHaveBeenCalledWith("/users/", {
        name: "John Doe",
        email: "john@example.com"
      });
    });

    it("formats phones array with mapped types", async () => {
      (mockClient.post as any).mockResolvedValue({ id: 1 });

      await endpoints.createContact({
        name: "Test",
        email: "test@example.com",
        phones: [
          { number: "555-1111", type: "mobile" },
          { number: "555-2222", type: "work" }
        ]
      });

      expect(mockClient.post).toHaveBeenCalledWith("/users/", expect.objectContaining({
        phones: [
          { number: "555-1111", type: "mo", is_primary: true },
          { number: "555-2222", type: "w", is_primary: false }
        ]
      }));
    });

    it("sets first phone as primary by default", async () => {
      (mockClient.post as any).mockResolvedValue({ id: 1 });

      await endpoints.createContact({
        name: "Test",
        email: "test@example.com",
        phones: [
          { number: "555-1111", type: "mobile" },
          { number: "555-2222", type: "work" },
          { number: "555-3333", type: "home" }
        ]
      });

      const calledWith = (mockClient.post as any).mock.calls[0][1];
      expect(calledWith.phones[0].is_primary).toBe(true);
      expect(calledWith.phones[1].is_primary).toBe(false);
      expect(calledWith.phones[2].is_primary).toBe(false);
    });

    it("respects explicit is_primary flag", async () => {
      (mockClient.post as any).mockResolvedValue({ id: 1 });

      await endpoints.createContact({
        name: "Test",
        email: "test@example.com",
        phones: [
          { number: "555-1111", type: "mobile", is_primary: false },
          { number: "555-2222", type: "work", is_primary: true }
        ]
      });

      const calledWith = (mockClient.post as any).mock.calls[0][1];
      expect(calledWith.phones[0].is_primary).toBe(false);
      expect(calledWith.phones[1].is_primary).toBe(true);
    });

    it("joins contact_groups with comma", async () => {
      (mockClient.post as any).mockResolvedValue({ id: 1 });

      await endpoints.createContact({
        name: "Test",
        email: "test@example.com",
        contact_groups: ["1", "2", "3"]
      });

      expect(mockClient.post).toHaveBeenCalledWith("/users/", expect.objectContaining({
        contact_groups: "1,2,3"
      }));
    });

    it("includes is_login_enabled when provided", async () => {
      (mockClient.post as any).mockResolvedValue({ id: 1 });

      await endpoints.createContact({
        name: "Test",
        email: "test@example.com",
        is_login_enabled: true
      });

      expect(mockClient.post).toHaveBeenCalledWith("/users/", expect.objectContaining({
        is_login_enabled: true
      }));
    });

    it("spreads custom_fields into formData", async () => {
      (mockClient.post as any).mockResolvedValue({ id: 1 });

      await endpoints.createContact({
        name: "Test",
        email: "test@example.com",
        custom_fields: {
          "c-cf-1": "value1",
          "c-cf-2": "value2"
        }
      });

      expect(mockClient.post).toHaveBeenCalledWith("/users/", expect.objectContaining({
        "c-cf-1": "value1",
        "c-cf-2": "value2"
      }));
    });
  });

  describe("listContacts", () => {
    it("sets default pagination", async () => {
      (mockClient.get as any).mockResolvedValue({ data: [] });

      await endpoints.listContacts();

      expect(mockClient.get).toHaveBeenCalledWith("/users/", {
        page: 1,
        size: 50
      });
    });

    it("caps size at 50", async () => {
      (mockClient.get as any).mockResolvedValue({ data: [] });

      await endpoints.listContacts({ size: 100 });

      expect(mockClient.get).toHaveBeenCalledWith("/users/", expect.objectContaining({
        size: 50
      }));
    });

    it("maps query to 'q' parameter", async () => {
      (mockClient.get as any).mockResolvedValue({ data: [] });

      await endpoints.listContacts({ query: "john" });

      expect(mockClient.get).toHaveBeenCalledWith("/users/", expect.objectContaining({
        q: "john"
      }));
    });

    it("includes all filter parameters", async () => {
      (mockClient.get as any).mockResolvedValue({ data: [] });

      await endpoints.listContacts({
        page: 2,
        size: 25
      });

      expect(mockClient.get).toHaveBeenCalledWith("/users/", {
        page: 2,
        size: 25
      });
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
    it("includes phone id for existing phones", async () => {
      (mockClient.post as any).mockResolvedValue({ id: 1 });

      await endpoints.updateContact("123", {
        phones: [
          { id: 456, number: "555-1234", type: "mobile" }
        ]
      });

      expect(mockClient.post).toHaveBeenCalledWith("/user/123/", expect.objectContaining({
        phones: [{ id: 456, number: "555-1234", type: "mo", is_primary: true }]
      }));
    });

    it("omits id for new phones", async () => {
      (mockClient.post as any).mockResolvedValue({ id: 1 });

      await endpoints.updateContact("123", {
        phones: [
          { number: "555-9999", type: "work" }
        ]
      });

      const calledWith = (mockClient.post as any).mock.calls[0][1];
      expect(calledWith.phones[0]).not.toHaveProperty("id");
    });

    it("only includes provided fields", async () => {
      (mockClient.post as any).mockResolvedValue({ id: 1 });

      await endpoints.updateContact("123", {
        name: "New Name"
      });

      const calledWith = (mockClient.post as any).mock.calls[0][1];
      expect(calledWith).toEqual({ name: "New Name" });
      expect(calledWith).not.toHaveProperty("email");
      expect(calledWith).not.toHaveProperty("phones");
    });

    it("joins contact_groups with comma", async () => {
      (mockClient.post as any).mockResolvedValue({ id: 1 });

      await endpoints.updateContact("123", {
        contact_groups: ["1", "2", "3"]
      });

      expect(mockClient.post).toHaveBeenCalledWith("/user/123/", expect.objectContaining({
        contact_groups: "1,2,3"
      }));
    });

    it("includes is_login_enabled when provided", async () => {
      (mockClient.post as any).mockResolvedValue({ id: 1 });

      await endpoints.updateContact("123", {
        is_login_enabled: true
      });

      expect(mockClient.post).toHaveBeenCalledWith("/user/123/", expect.objectContaining({
        is_login_enabled: true
      }));
    });

    it("handles is_login_enabled false", async () => {
      (mockClient.post as any).mockResolvedValue({ id: 1 });

      await endpoints.updateContact("123", {
        is_login_enabled: false
      });

      expect(mockClient.post).toHaveBeenCalledWith("/user/123/", expect.objectContaining({
        is_login_enabled: false
      }));
    });

    it("spreads custom_fields into formData", async () => {
      (mockClient.post as any).mockResolvedValue({ id: 1 });

      await endpoints.updateContact("123", {
        custom_fields: {
          "c-cf-1": "updated_value1",
          "c-cf-2": "updated_value2"
        }
      });

      expect(mockClient.post).toHaveBeenCalledWith("/user/123/", expect.objectContaining({
        "c-cf-1": "updated_value1",
        "c-cf-2": "updated_value2"
      }));
    });

    it("updates all fields together", async () => {
      (mockClient.post as any).mockResolvedValue({ id: 1 });

      await endpoints.updateContact("123", {
        name: "Updated Name",
        email: "updated@example.com",
        phones: [{ number: "555-9999", type: "work" }],
        contact_groups: ["1", "2"],
        is_login_enabled: true,
        custom_fields: { "c-cf-1": "value" }
      });

      const calledWith = (mockClient.post as any).mock.calls[0][1];
      expect(calledWith.name).toBe("Updated Name");
      expect(calledWith.email).toBe("updated@example.com");
      expect(calledWith.phones).toBeDefined();
      expect(calledWith.contact_groups).toBe("1,2");
      expect(calledWith.is_login_enabled).toBe(true);
      expect(calledWith["c-cf-1"]).toBe("value");
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
    it("sends name only when description not provided", async () => {
      (mockClient.post as any).mockResolvedValue({ id: 1 });

      await endpoints.createContactGroup({ name: "New Group" });

      expect(mockClient.post).toHaveBeenCalledWith("/contact_groups/", {
        name: "New Group"
      });
    });

    it("includes description when provided", async () => {
      (mockClient.post as any).mockResolvedValue({ id: 1 });

      await endpoints.createContactGroup({
        name: "New Group",
        description: "A test group"
      });

      expect(mockClient.post).toHaveBeenCalledWith("/contact_groups/", {
        name: "New Group",
        description: "A test group"
      });
    });
  });

  describe("updateContactGroup", () => {
    it("only includes provided fields", async () => {
      (mockClient.post as any).mockResolvedValue({ id: 1 });

      await endpoints.updateContactGroup("1", { name: "Updated" });

      expect(mockClient.post).toHaveBeenCalledWith("/contact_group/1/", {
        name: "Updated"
      });
    });

    it("includes description when provided", async () => {
      (mockClient.post as any).mockResolvedValue({ id: 1 });

      await endpoints.updateContactGroup("1", { description: "New description" });

      expect(mockClient.post).toHaveBeenCalledWith("/contact_group/1/", {
        description: "New description"
      });
    });

    it("updates both name and description", async () => {
      (mockClient.post as any).mockResolvedValue({ id: 1 });

      await endpoints.updateContactGroup("1", {
        name: "New Name",
        description: "New Description"
      });

      expect(mockClient.post).toHaveBeenCalledWith("/contact_group/1/", {
        name: "New Name",
        description: "New Description"
      });
    });
  });

  describe("addContactsToGroup", () => {
    it("formats contactIds as objects array", async () => {
      (mockClient.post as any).mockResolvedValue({ success: true });

      await endpoints.addContactsToGroup("1", [10, 20, 30]);

      expect(mockClient.post).toHaveBeenCalledWith("/contact_group/1/update_contacts/", {
        contacts: [{ id: 10 }, { id: 20 }, { id: 30 }]
      });
    });
  });

  describe("removeContactsFromGroup", () => {
    it("formats contactIds as plain array", async () => {
      (mockClient.post as any).mockResolvedValue({ success: true });

      await endpoints.removeContactsFromGroup("1", [10, 20, 30]);

      expect(mockClient.post).toHaveBeenCalledWith("/contact_group/1/delete_contacts/", {
        contacts: [10, 20, 30]
      });
    });
  });
});
