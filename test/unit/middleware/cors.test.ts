import { describe, it, expect } from "vitest";
import { CORSMiddleware } from "../../../src/middleware/cors";

describe("CORSMiddleware", () => {
  describe("constructor", () => {
    it("uses default origins when none provided", () => {
      const middleware = new CORSMiddleware();
      const headers = middleware.getCORSHeaders("http://localhost:3000");
      expect(headers["Access-Control-Allow-Origin"]).toBe("http://localhost:3000");
    });

    it("parses comma-separated origins", () => {
      const middleware = new CORSMiddleware("https://example.com,https://test.com");
      const headers = middleware.getCORSHeaders("https://example.com");
      expect(headers["Access-Control-Allow-Origin"]).toBe("https://example.com");
    });

    it("trims whitespace from origins", () => {
      const middleware = new CORSMiddleware("  https://example.com  ,  https://test.com  ");
      const headers = middleware.getCORSHeaders("https://example.com");
      expect(headers["Access-Control-Allow-Origin"]).toBe("https://example.com");
    });
  });

  describe("getCORSHeaders", () => {
    it("returns MCP 2026-07-28 CORS headers", () => {
      const middleware = new CORSMiddleware("*");
      const headers = middleware.getCORSHeaders("https://any.com");

      // POST only: no SSE stream to GET, no session to DELETE.
      expect(headers["Access-Control-Allow-Methods"]).toBe("POST, OPTIONS");
      expect(headers["Access-Control-Allow-Headers"]).toContain("MCP-Protocol-Version");
      expect(headers["Access-Control-Allow-Headers"]).toContain("Accept");
      expect(headers["Access-Control-Max-Age"]).toBe("86400");
    });

    it("allows the now-mandatory Mcp-Method and Mcp-Name headers", () => {
      const middleware = new CORSMiddleware("*");
      const headers = middleware.getCORSHeaders("https://any.com");

      // Without these, a browser client cannot send the required headers at all.
      expect(headers["Access-Control-Allow-Headers"]).toContain("Mcp-Method");
      expect(headers["Access-Control-Allow-Headers"]).toContain("Mcp-Name");
    });

    it("no longer advertises the retired session headers", () => {
      const middleware = new CORSMiddleware("*");
      const headers = middleware.getCORSHeaders("https://any.com");

      expect(headers["Access-Control-Allow-Headers"]).not.toContain("MCP-Session-Id");
      expect(headers["Access-Control-Allow-Headers"]).not.toContain("Last-Event-ID");
      expect(headers["Access-Control-Allow-Methods"]).not.toContain("GET");
      expect(headers["Access-Control-Allow-Methods"]).not.toContain("DELETE");
    });

    it("includes OAuth Authorization header in allowed headers", () => {
      const middleware = new CORSMiddleware("*");
      const headers = middleware.getCORSHeaders("https://any.com");

      expect(headers["Access-Control-Allow-Headers"]).toContain("Authorization");
    });

    it("exposes WWW-Authenticate so browser clients can read 401/403 challenges", () => {
      const middleware = new CORSMiddleware("*");
      const headers = middleware.getCORSHeaders("https://any.com");

      // Not CORS-safelisted; without it a browser client cannot see resource_metadata
      // or the insufficient_scope challenge. The server sets no MCP-* response headers.
      expect(headers["Access-Control-Expose-Headers"]).toBe("WWW-Authenticate");
    });

    it("does not include Allow-Origin for disallowed origins", () => {
      const middleware = new CORSMiddleware("https://allowed.com");
      const headers = middleware.getCORSHeaders("https://disallowed.com");

      expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
      expect(headers["Access-Control-Allow-Credentials"]).toBeUndefined();
    });

    it("includes credentials header for allowed origins", () => {
      const middleware = new CORSMiddleware("https://allowed.com");
      const headers = middleware.getCORSHeaders("https://allowed.com");

      expect(headers["Access-Control-Allow-Origin"]).toBe("https://allowed.com");
      expect(headers["Access-Control-Allow-Credentials"]).toBe("true");
    });

    it("handles null origin", () => {
      const middleware = new CORSMiddleware("https://allowed.com");
      const headers = middleware.getCORSHeaders(null);

      expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
    });

    it("handles undefined origin", () => {
      const middleware = new CORSMiddleware("https://allowed.com");
      const headers = middleware.getCORSHeaders(undefined);

      expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
    });
  });

  describe("isOriginValid", () => {
    it("returns true for null origin (same-origin/non-browser)", () => {
      const middleware = new CORSMiddleware("https://allowed.com");
      expect(middleware.isOriginValid(null)).toBe(true);
    });

    it("returns true for allowed origin", () => {
      const middleware = new CORSMiddleware("https://allowed.com");
      expect(middleware.isOriginValid("https://allowed.com")).toBe(true);
    });

    it("returns false for disallowed origin", () => {
      const middleware = new CORSMiddleware("https://allowed.com");
      expect(middleware.isOriginValid("https://evil.com")).toBe(false);
    });

    it("returns true for localhost with wildcard port", () => {
      const middleware = new CORSMiddleware("http://localhost:*");
      expect(middleware.isOriginValid("http://localhost:3000")).toBe(true);
      expect(middleware.isOriginValid("http://localhost:8080")).toBe(true);
    });

    it("returns true for any origin when * is allowed", () => {
      const middleware = new CORSMiddleware("*");
      expect(middleware.isOriginValid("https://any.com")).toBe(true);
    });
  });

  describe("handleInvalidOrigin", () => {
    it("returns 403 Forbidden", () => {
      const middleware = new CORSMiddleware("https://allowed.com");
      const response = middleware.handleInvalidOrigin();

      expect(response.status).toBe(403);
    });

    it("returns text/plain content type", () => {
      const middleware = new CORSMiddleware("https://allowed.com");
      const response = middleware.handleInvalidOrigin();

      expect(response.headers.get("Content-Type")).toBe("text/plain");
    });
  });

  describe("wildcard port matching", () => {
    it("matches any port with wildcard", () => {
      const middleware = new CORSMiddleware("http://localhost:*");

      expect(middleware.getCORSHeaders("http://localhost:3000")["Access-Control-Allow-Origin"])
        .toBe("http://localhost:3000");
      expect(middleware.getCORSHeaders("http://localhost:5173")["Access-Control-Allow-Origin"])
        .toBe("http://localhost:5173");
      expect(middleware.getCORSHeaders("http://localhost:8080")["Access-Control-Allow-Origin"])
        .toBe("http://localhost:8080");
      expect(middleware.getCORSHeaders("http://localhost:80")["Access-Control-Allow-Origin"])
        .toBe("http://localhost:80");
    });

    it("does not match different hosts with wildcard port", () => {
      const middleware = new CORSMiddleware("http://localhost:*");
      const headers = middleware.getCORSHeaders("http://example.com:3000");
      expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
    });

    it("matches https with wildcard port", () => {
      const middleware = new CORSMiddleware("https://localhost:*");
      const headers = middleware.getCORSHeaders("https://localhost:3000");
      expect(headers["Access-Control-Allow-Origin"]).toBe("https://localhost:3000");
    });

    it("does not match http when https required", () => {
      const middleware = new CORSMiddleware("https://localhost:*");
      const headers = middleware.getCORSHeaders("http://localhost:3000");
      expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
    });
  });

  describe("global wildcard", () => {
    it("allows all origins with *", () => {
      const middleware = new CORSMiddleware("*");
      const headers = middleware.getCORSHeaders("https://any-domain.com");
      expect(headers["Access-Control-Allow-Origin"]).toBe("https://any-domain.com");
    });

    it("returns * for null origin when * is allowed", () => {
      const middleware = new CORSMiddleware("*");
      const headers = middleware.getCORSHeaders(null);
      expect(headers["Access-Control-Allow-Origin"]).toBe("*");
    });
  });

  describe("handlePreflight", () => {
    it("returns 204 status for allowed origin", () => {
      const middleware = new CORSMiddleware("http://localhost:*");
      const response = middleware.handlePreflight("http://localhost:3000");

      expect(response.status).toBe(204);
    });

    it("returns 403 for disallowed origin", () => {
      const middleware = new CORSMiddleware("https://allowed.com");
      const response = middleware.handlePreflight("https://evil.com");

      expect(response.status).toBe(403);
    });

    it("includes MCP 2026-07-28 CORS headers for allowed origin", () => {
      const middleware = new CORSMiddleware("http://localhost:*");
      const response = middleware.handlePreflight("http://localhost:3000");

      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3000");
      expect(response.headers.get("Access-Control-Allow-Methods")).toBe("POST, OPTIONS");
      expect(response.headers.get("Access-Control-Allow-Headers")).toContain("MCP-Protocol-Version");
      expect(response.headers.get("Access-Control-Allow-Headers")).toContain("Mcp-Method");
      expect(response.headers.get("Access-Control-Allow-Headers")).not.toContain("MCP-Session-Id");
    });

    it("returns null body for allowed origin", () => {
      const middleware = new CORSMiddleware("http://localhost:*");
      const response = middleware.handlePreflight("http://localhost:3000");

      expect(response.body).toBeNull();
    });
  });

  describe("multiple allowed origins", () => {
    it("allows any of the specified origins", () => {
      const middleware = new CORSMiddleware("https://app.example.com,https://admin.example.com,http://localhost:*");

      expect(middleware.getCORSHeaders("https://app.example.com")["Access-Control-Allow-Origin"])
        .toBe("https://app.example.com");
      expect(middleware.getCORSHeaders("https://admin.example.com")["Access-Control-Allow-Origin"])
        .toBe("https://admin.example.com");
      expect(middleware.getCORSHeaders("http://localhost:5000")["Access-Control-Allow-Origin"])
        .toBe("http://localhost:5000");
    });

    it("rejects origins not in the list", () => {
      const middleware = new CORSMiddleware("https://app.example.com,https://admin.example.com");
      const headers = middleware.getCORSHeaders("https://evil.com");

      expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
    });
  });
});
