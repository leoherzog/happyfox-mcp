import { describe, it, expect } from "vitest";
import { renderHomePage } from "../../../src/views/home";
import { MCP_PROTOCOL_VERSION } from "../../../src/types";
import { AVAILABLE_SCOPES } from "../../../src/oauth/types";

describe("renderHomePage", () => {
  const html = renderHomePage("https://happyfox-mcp.example.workers.dev");

  it("renders a complete HTML document", () => {
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<title>HappyFox MCP Adapter</title>");
    expect(html).toContain("</html>");
  });

  it("shows the MCP endpoint for this deployment", () => {
    expect(html).toContain("https://happyfox-mcp.example.workers.dev/mcp");
  });

  it("strips trailing slashes from the origin", () => {
    const withSlash = renderHomePage("https://happyfox-mcp.example.workers.dev/");
    expect(withSlash).toContain("https://happyfox-mcp.example.workers.dev/mcp");
    expect(withSlash).not.toContain("workers.dev//mcp");
  });

  it("documents every available scope", () => {
    for (const scope of AVAILABLE_SCOPES) {
      expect(html).toContain(scope);
    }
  });

  it("states the supported protocol version", () => {
    expect(html).toContain(MCP_PROTOCOL_VERSION);
  });

  it("links to the well-known metadata endpoints", () => {
    expect(html).toContain("/.well-known/oauth-authorization-server");
    expect(html).toContain("/.well-known/oauth-protected-resource");
  });

  it("escapes HTML in the origin", () => {
    const malicious = renderHomePage('https://evil"><script>alert(1)</script>');
    expect(malicious).not.toContain("<script>alert(1)</script>");
    expect(malicious).toContain("&lt;script&gt;");
  });
});
