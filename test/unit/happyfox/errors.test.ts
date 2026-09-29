import { describe, it, expect } from "vitest";
import { formatErrorBody } from "../../../src/happyfox/errors";

describe("formatErrorBody", () => {
  it("keeps a string error", () => {
    expect(formatErrorBody({ error: "Ticket not found" })).toBe("Ticket not found");
  });

  it("formats a field/errors list (Docs/1039 create ticket, Docs/1092 create contact)", () => {
    expect(formatErrorBody({
      error: [
        { field: "category", errors: ["This field is required."] },
        { field: "t-cf-3", errors: ["This field is required"] }
      ]
    })).toBe("category: This field is required.; t-cf-3: This field is required");
  });

  it("formats a field-keyed object (Docs/1039 staff_update)", () => {
    expect(formatErrorBody({
      error: { "t-cf-2": "This field should be filled before marking this ticket as completed" }
    })).toBe("t-cf-2: This field should be filled before marking this ticket as completed");
  });

  it("formats mixed and nested field errors (Docs/1201 create asset)", () => {
    expect(formatErrorBody({
      error: {
        display_id: ["This field is required."],
        contact_ids: "Enter a list of values.",
        custom_fields: { "1": "Provide a valid choice. 5 is not one of the available choices." }
      }
    })).toBe(
      "display_id: This field is required.; contact_ids: Enter a list of values.; " +
      "custom_fields.1: Provide a valid choice. 5 is not one of the available choices."
    );
  });

  it("joins several messages for one field", () => {
    expect(formatErrorBody({ error: { email: ["Enter a valid email.", "Already in use."] } }))
      .toBe("email: Enter a valid email. Already in use.");
  });

  it("formats failed items of a bulk ticket result (Docs/1039 create multiple tickets)", () => {
    expect(formatErrorBody([
      { display_id: "#DC00000011", id: 11, success: true },
      { success: false, error: [{ field: "category", errors: ["This field is required."] }] }
    ])).toBe("item 2: category: This field is required.");
  });

  it("names bulk items with the caller's label", () => {
    expect(formatErrorBody([
      { display_id: "#DC00000011", id: 11, success: true },
      { success: false, error: [{ field: "category", errors: ["This field is required."] }] }
    ], index => `tickets[${index}]`)).toBe("tickets[1]: category: This field is required.");
  });

  it("formats failed items that report 'errors' (Docs/1092 update_contacts)", () => {
    expect(formatErrorBody([
      { data: { access_tickets: true, contact: 1 }, success: true },
      {
        errors: [{
          field: "contact",
          errors: ["Select a valid choice. That choice is not one of the available choices."]
        }],
        success: false
      }
    ])).toBe("item 2: contact: Select a valid choice. That choice is not one of the available choices.");
  });

  it("formats failed items that report data.message (Docs/1092 delete_contacts)", () => {
    expect(formatErrorBody([
      { data: { message: "Successfully removed contact from group", contact: 1 }, success: true },
      { data: { message: "Contact not part of the contact group", contact: 3 }, success: false },
      { data: { message: "Contact does not exist", contact: 100 }, success: false }
    ])).toBe(
      "item 2: contact 3: Contact not part of the contact group; item 3: contact 100: Contact does not exist"
    );
  });

  it("uses a top-level 'errors' or 'message'", () => {
    expect(formatErrorBody({ errors: { name: ["Required."] } })).toBe("name: Required.");
    expect(formatErrorBody({ message: "Invalid request" })).toBe("Invalid request");
  });

  it("takes the text from errors or message when error is only a flag", () => {
    expect(formatErrorBody({ error: true, message: "Ticket not found" })).toBe("Ticket not found");
    expect(formatErrorBody({ error: false, errors: { name: ["Required."] } })).toBe("name: Required.");
  });

  it.each([
    {}, [], [{ success: true }], { error: "" }, { error: " " }, { error: [] }, { error: {} },
    { error: false }, { error: 0 }, { error: true }, null, 42
  ])(
    "returns undefined for %j",
    (body) => {
      expect(formatErrorBody(body)).toBeUndefined();
    }
  );
});
