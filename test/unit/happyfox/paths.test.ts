import { describe, it, expect } from "vitest";
import { idSegment, contactSegment, assertSafePath } from "../../../src/happyfox/paths";
import { HappyFoxAPIError } from "../../../src/happyfox/client";
import { INJECTION_IDS, MALFORMED_IDS } from "../../helpers/invalid-ids";

function expectInvalidId(fn: () => unknown, param: string) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(HappyFoxAPIError);
    expect(error).toMatchObject({ statusCode: 400, code: "INVALID_ID" });
    expect((error as Error).message).toContain(param);
    return;
  }
  throw new Error("expected INVALID_ID");
}

describe("idSegment", () => {
  it.each([
    [1, "1"],
    [42, "42"],
    ["42", "42"],
    ["007", "7"],
    [Number.MAX_SAFE_INTEGER, String(Number.MAX_SAFE_INTEGER)]
  ])("accepts %j as %j", (value, expected) => {
    expect(idSegment(value, "ticket_id")).toBe(expected);
  });

  it.each([...INJECTION_IDS, ...MALFORMED_IDS])("rejects %j", (value) => {
    expectInvalidId(() => idSegment(value, "ticket_id"), "ticket_id");
  });

  it.each([
    [["12"], 'Invalid ticket_id ["12"]:'],
    [[1], "Invalid ticket_id [1]:"],
    [{}, "Invalid ticket_id {}:"],
    [{ id: 3 }, 'Invalid ticket_id {"id":3}:'],
    [undefined, "Invalid ticket_id undefined:"],
    [Number.NaN, "Invalid ticket_id NaN:"],
    ["#DC1", 'Invalid ticket_id "#DC1":']
  ])("shows %j in the message as the model sent it", (value, expected) => {
    expect(() => idSegment(value, "ticket_id")).toThrow(expected);
  });

  it("truncates a long value in the message", () => {
    const error = (() => {
      try {
        idSegment("x".repeat(500), "asset_id");
      } catch (e) {
        return e as Error;
      }
    })();
    expect(error!.message.length).toBeLessThan(140);
  });
});

describe("contactSegment", () => {
  it.each([
    [33, "33"],
    ["33", "33"],
    ["james@example.com", "james@example.com"],
    ["a+b@example.com", "a%2Bb@example.com"],
    ["o'brien@example.co.uk", "o'brien@example.co.uk"],
    ["a#b@example.com", "a%23b@example.com"],
    ["a?b@example.com", "a%3Fb@example.com"],
    ["a%b@example.com", "a%25b@example.com"],
    ["x%40@y", "x%2540@y"]
  ])("accepts %j as %j (Docs/1092 §3)", (value, expected) => {
    expect(contactSegment(value, "contact_id")).toBe(expected);
  });

  it.each([
    ...INJECTION_IDS,
    ...MALFORMED_IDS,
    "x@y/../z",
    "../ticket/5/delete@x",
    "x@y?z",
    "x@y#",
    "x\\@y",
    "x@y%2e",
    "a..b@example.com",
    "a@b@c",
    "@example.com",
    "james@",
    "james @example.com",
    "\uD800@example.com",
    `${"a".repeat(250)}@example.com`
  ])("rejects %j", (value) => {
    expectInvalidId(() => contactSegment(value, "contact_id"), "contact_id");
  });
});

describe("assertSafePath", () => {
  it.each([
    "/tickets/",
    "/ticket/1/update_tags/",
    "/user/a%2Bb@example.com/",
    "/user/a%23b%3Fc%25d@example.com/"
  ])("accepts %j", (path) => {
    expect(() => assertSafePath(path)).not.toThrow();
  });

  it.each([
    "tickets/",
    "/ticket/../users/",
    "/ticket/./1/",
    "/ticket/%2e%2e/",
    "/ticket/%2F/",
    "/ticket/1?x=y",
    "/ticket/1#x",
    "/ticket\\1/",
    "/ticket/%E0%A4%A/"
  ])("rejects %j", (path) => {
    expect(() => assertSafePath(path)).toThrow(expect.objectContaining({ code: "INVALID_PATH", statusCode: 400 }));
  });
});
