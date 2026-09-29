import { describe, it, expect } from "vitest";
import {
  CONTACT_CUSTOM_FIELDS,
  CUSTOM_FIELD_VALUE_FORMATS,
  TICKET_CUSTOM_FIELDS,
  customFieldEntries,
  customFieldsSchema
} from "../../../../src/happyfox/endpoints/custom-fields";

describe("customFieldEntries", () => {
  it("returns no entries when the argument is absent", () => {
    expect(customFieldEntries(undefined, [TICKET_CUSTOM_FIELDS])).toEqual({});
    expect(customFieldEntries(null, [TICKET_CUSTOM_FIELDS])).toEqual({});
  });

  it("keeps each documented value format and turns choice id strings into numbers", () => {
    expect(
      customFieldEntries(
        { "t-cf-1": "text", "t-cf-5": 200.5, "t-cf-2": 4, "t-cf-3": [4, "1"], "t-cf-6": [], "t-cf-4": "2019-12-20" },
        [TICKET_CUSTOM_FIELDS]
      )
    ).toEqual({ "t-cf-1": "text", "t-cf-5": 200.5, "t-cf-2": 4, "t-cf-3": [4, 1], "t-cf-6": [], "t-cf-4": "2019-12-20" });
  });

  it("accepts only the prefixes the endpoint documents", () => {
    expect(() => customFieldEntries({ "t-cf-1": "x" }, [CONTACT_CUSTOM_FIELDS])).toThrow(
      'Invalid custom_fields key "t-cf-1": expected c-cf-<id> with an id from happyfox://contact-custom-fields.'
    );
    expect(customFieldEntries({ "c-cf-1": "x" }, [CONTACT_CUSTOM_FIELDS])).toEqual({ "c-cf-1": "x" });
  });

  it("names the argument and every accepted prefix in a key error", () => {
    expect(() =>
      customFieldEntries({ email: "x@example.com" }, [TICKET_CUSTOM_FIELDS, CONTACT_CUSTOM_FIELDS], "tickets[0].custom_fields")
    ).toThrow(
      'Invalid tickets[0].custom_fields key "email": expected t-cf-<id> with an id from ' +
        "happyfox://ticket-custom-fields, or c-cf-<id> with an id from happyfox://contact-custom-fields."
    );
  });

  it.each([["a list", [1]], ["a string", "t-cf-1=2"], ["a number", 3]])("rejects %s in place of an object", (_what, fields) => {
    expect(() => customFieldEntries(fields, [TICKET_CUSTOM_FIELDS])).toThrow(
      expect.objectContaining({ statusCode: 400, code: "INVALID_ARGUMENT" })
    );
  });

  it.each([[Number.NaN], [Number.POSITIVE_INFINITY]])("rejects the non-finite number %s", value => {
    expect(() => customFieldEntries({ "t-cf-5": value }, [TICKET_CUSTOM_FIELDS])).toThrow('"t-cf-5"');
  });

  it.each([[[0]], [[1.5]], [["01"]], [[{ id: 1 }]]])("rejects the multiple-choice value %j", value => {
    expect(() => customFieldEntries({ "t-cf-3": value }, [TICKET_CUSTOM_FIELDS])).toThrow("list of choice ids");
  });
});

describe("customFieldsSchema", () => {
  it("restricts key names to the same pattern the validator enforces", () => {
    const schema = customFieldsSchema([TICKET_CUSTOM_FIELDS, CONTACT_CUSTOM_FIELDS], "desc") as any;
    const pattern = new RegExp(schema.propertyNames.pattern, "u");

    expect(schema).toMatchObject({ type: "object", description: "desc" });
    expect(["t-cf-1", "c-cf-12"].every(key => pattern.test(key))).toBe(true);
    expect(["3", "t-cf-0", "a-cf-1", "priority"].some(key => pattern.test(key))).toBe(false);
  });

  it("accepts the value types the validator accepts: text, a number or a list of choice ids", () => {
    const schema = customFieldsSchema([TICKET_CUSTOM_FIELDS], "desc") as any;

    expect(schema.additionalProperties).toEqual({
      anyOf: [
        { type: "string" },
        { type: "number" },
        { type: "array", items: { type: "integer", minimum: 1 } }
      ]
    });
  });

  it("states each documented value format (Docs/1039 §4)", () => {
    for (const format of ["text, a string", "at most 2 decimal places", "one choice id", "a list of choice ids", "yyyy-mm-dd"]) {
      expect(CUSTOM_FIELD_VALUE_FORMATS).toContain(format);
    }
  });
});
