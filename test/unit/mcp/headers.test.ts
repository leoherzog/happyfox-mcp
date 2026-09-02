import { describe, it, expect } from "vitest";
import { decodeMcpHeaderValue, HeaderValueError } from "../../../src/mcp/headers";

/**
 * MCP 2026-07-28 transport, "Standard Request Headers":
 *
 *   Mcp-Name: =?base64?{Base64EncodedValue}?=
 *
 * "These markers are case-sensitive and MUST appear exactly as shown
 * (lowercase). Servers ... MUST decode an encoded Mcp-Name ... value before
 * comparing it to the corresponding request body value."
 */
describe("decodeMcpHeaderValue", () => {
  describe("plain values", () => {
    it("returns an ordinary tool name unchanged", () => {
      expect(decodeMcpHeaderValue("happyfox_list_tickets")).toBe("happyfox_list_tickets");
    });

    it("returns a resource URI unchanged", () => {
      expect(decodeMcpHeaderValue("happyfox://categories")).toBe("happyfox://categories");
    });

    it("returns an empty string unchanged", () => {
      expect(decodeMcpHeaderValue("")).toBe("");
    });
  });

  describe("sentinel decoding", () => {
    it("decodes an ASCII payload", () => {
      // base64("happyfox_list_tickets")
      expect(decodeMcpHeaderValue("=?base64?aGFwcHlmb3hfbGlzdF90aWNrZXRz?=")).toBe(
        "happyfox_list_tickets"
      );
    });

    it("decodes a resource URI payload", () => {
      // base64("happyfox://categories")
      expect(decodeMcpHeaderValue("=?base64?aGFwcHlmb3g6Ly9jYXRlZ29yaWVz?=")).toBe(
        "happyfox://categories"
      );
    });

    it("decodes UTF-8 bytes, not a binary string", () => {
      // atob() alone yields "Hello, ä¸ç"; the TextDecoder step is mandatory.
      expect(decodeMcpHeaderValue("=?base64?SGVsbG8sIOS4lueVjA==?=")).toBe("Hello, 世界");
    });

    it("uses the standard base64 alphabet, not the URL-safe one", () => {
      // The spec's own example: base64("=?base64?literal?=") contains a "/".
      expect(decodeMcpHeaderValue("=?base64?PT9iYXNlNjQ/bGl0ZXJhbD89?=")).toBe(
        "=?base64?literal?="
      );
    });

    it("round-trips a value a conforming client would encode", () => {
      const value = "  leading and trailing whitespace  ";
      const bytes = new TextEncoder().encode(value);
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      expect(decodeMcpHeaderValue(`=?base64?${btoa(binary)}?=`)).toBe(value);
    });
  });

  describe("values that only look like the sentinel", () => {
    it("leaves uppercase markers alone (markers are case-sensitive)", () => {
      expect(decodeMcpHeaderValue("=?BASE64?abc?=")).toBe("=?BASE64?abc?=");
    });

    it("leaves a value with only the prefix alone", () => {
      expect(decodeMcpHeaderValue("=?base64?abc")).toBe("=?base64?abc");
    });

    it("leaves a value with only the suffix alone", () => {
      expect(decodeMcpHeaderValue("abc?=")).toBe("abc?=");
    });

    it("leaves the 10-character '=?base64?=' alone (below the 11-char minimum)", () => {
      expect(decodeMcpHeaderValue("=?base64?=")).toBe("=?base64?=");
    });
  });

  describe("malformed payloads", () => {
    it("throws HeaderValueError on a non-base64 payload", () => {
      expect(() => decodeMcpHeaderValue("=?base64?!!!?=")).toThrow(HeaderValueError);
    });

    it("throws HeaderValueError on a payload with invalid characters", () => {
      expect(() => decodeMcpHeaderValue("=?base64?not!valid!?=")).toThrow(HeaderValueError);
    });

    it("names the failure as an invalid header value (maps to -32020)", () => {
      expect(() => decodeMcpHeaderValue("=?base64?!!!?=")).toThrow(/invalid characters/i);
    });
  });
});
