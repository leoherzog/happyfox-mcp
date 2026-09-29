import { describe, it, expect } from "vitest";
import { apiHostFor, isRegion, isValidAccount, parseApiHost } from "../../../src/happyfox/host";
import { HappyFoxAPIError } from "../../../src/happyfox/errors";
import { HappyFoxAuth } from "../../../src/types";

function account(overrides: Partial<HappyFoxAuth> = {}): HappyFoxAuth {
  return { apiKey: "key", authCode: "code", accountName: "acme", region: "us", ...overrides };
}

describe("isRegion", () => {
  it("accepts exactly the two documented regions", () => {
    expect(isRegion("us")).toBe(true);
    expect(isRegion("eu")).toBe(true);
  });

  it.each(["", "US", "EU", "us/../eu", "../eu/victim/staff#", "eu ", "net", undefined, null, 1])(
    "rejects %j",
    (value) => {
      expect(isRegion(value)).toBe(false);
    }
  );
});

describe("parseApiHost", () => {
  it.each([
    ["support.example.com", "support.example.com"],
    ["Support.Example.COM", "support.example.com"],
    ["  help.acme.co.uk  ", "help.acme.co.uk"],
    ["acme.happyfox.com", "acme.happyfox.com"],
    ["xn--bcher-kva.de", "xn--bcher-kva.de"],
    ["help.xn--p1ai", "help.xn--p1ai"],
    ["a-b.example.org", "a-b.example.org"],
  ])("parses %j as %j", (input, expected) => {
    expect(parseApiHost(input)).toBe(expected);
  });

  it.each([
    ["scheme", "https://support.example.com"],
    ["scheme-relative", "//support.example.com"],
    ["port", "support.example.com:8443"],
    ["path", "support.example.com/api"],
    ["query", "support.example.com?x=1"],
    ["fragment", "support.example.com#x"],
    ["userinfo", "user@support.example.com"],
    ["userinfo with password", "user:pass@support.example.com"],
    ["IPv4 literal", "192.168.1.10"],
    ["public IPv4 literal", "8.8.8.8"],
    ["IPv6 literal", "[::1]"],
    ["bare IPv6", "::1"],
    ["localhost", "localhost"],
    ["localhost subdomain", "api.localhost"],
    ["mDNS name", "printer.local"],
    ["internal name", "helpdesk.internal"],
    ["reverse DNS name", "1.0.0.127.in-addr.arpa"],
    ["single label", "intranet"],
    ["trailing dot", "support.example.com."],
    ["empty label", "support..example.com"],
    ["leading hyphen", "-support.example.com"],
    ["trailing hyphen", "support-.example.com"],
    ["underscore", "my_support.example.com"],
    ["space inside", "support example.com"],
    ["percent escape", "support%2eexample.com"],
    ["backslash", "support.example.com\\evil"],
    ["non-ASCII", "süpport.example.com"],
    ["numeric top-level label", "support.example.123"],
    ["one-letter top-level label", "support.example.c"],
    ["empty", ""],
    ["whitespace only", "   "],
    ["too long", `${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(63)}.com`],
  ])("rejects %s (%j)", (_label, input) => {
    expect(parseApiHost(input)).toBeNull();
  });

  it("rejects a label longer than 63 characters", () => {
    expect(parseApiHost(`${"a".repeat(64)}.example.com`)).toBeNull();
    expect(parseApiHost(`${"a".repeat(63)}.example.com`)).toBe(`${"a".repeat(63)}.example.com`);
  });

  it.each([undefined, null, 42, {}])("rejects the non-string %j", (value) => {
    expect(parseApiHost(value)).toBeNull();
  });
});

describe("isValidAccount", () => {
  it("accepts a subdomain account in either region", () => {
    expect(isValidAccount(account())).toBe(true);
    expect(isValidAccount(account({ region: "eu" }))).toBe(true);
  });

  it("accepts a normalized custom host and rejects one that is not", () => {
    expect(isValidAccount(account({ apiHost: "support.example.com" }))).toBe(true);
    expect(isValidAccount(account({ apiHost: "Support.Example.com" }))).toBe(false);
    expect(isValidAccount(account({ apiHost: "support.example.com/x" }))).toBe(false);
  });

  it.each([
    [{ region: "us/../eu" as any }],
    [{ region: "../eu/victim/staff#" as any }],
    [{ accountName: "acme/../victim" }],
    [{ accountName: "acme.happyfox.net" }],
    [{ accountName: "" }],
    [{ accountName: 42 as any }],
    [{ apiHost: null as any }],
    [{ apiHost: 42 as any }],
  ])("rejects %j", (overrides) => {
    expect(isValidAccount(account(overrides))).toBe(false);
  });
});

describe("apiHostFor", () => {
  it("builds the documented US and EU hosts (Docs/1039, Docs/360)", () => {
    expect(apiHostFor(account())).toBe("acme.happyfox.com");
    expect(apiHostFor(account({ region: "eu" }))).toBe("acme.happyfox.net");
  });

  it("lowercases the account subdomain", () => {
    expect(apiHostFor(account({ accountName: "Acme" }))).toBe("acme.happyfox.com");
  });

  it("uses the custom domain in place of the subdomain, whatever the region", () => {
    expect(apiHostFor(account({ apiHost: "support.example.com" }))).toBe("support.example.com");
    expect(apiHostFor(account({ region: "eu", apiHost: "support.example.com" }))).toBe("support.example.com");
  });

  it("throws INVALID_ACCOUNT for a crafted region", () => {
    expect(() => apiHostFor(account({ region: "us/../eu" as any }))).toThrow(HappyFoxAPIError);
    let caught: unknown;
    try {
      apiHostFor(account({ region: "../eu/victim/staff#" as any }));
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ statusCode: 400, code: "INVALID_ACCOUNT" });
  });

  it("throws INVALID_ACCOUNT for a null custom host rather than returning it", () => {
    expect(() => apiHostFor(account({ apiHost: null as any }))).toThrow(
      expect.objectContaining({ code: "INVALID_ACCOUNT" })
    );
  });
});
