import { describe, it, expect } from "vitest";
import { renderHomePage } from "../../../src/views/home";
import { MCP_PROTOCOL_VERSION } from "../../../src/types";
import { AVAILABLE_SCOPES, SCOPE_DESCRIPTIONS } from "../../../src/oauth/types";

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

  it("shows each scope's description", () => {
    for (const scope of AVAILABLE_SCOPES) {
      expect(html).toContain(SCOPE_DESCRIPTIONS[scope]);
    }
  });

  it("does not claim the assistant is limited by the user's own permissions", () => {
    expect(html).not.toContain("limited by your own HappyFox permissions");
    expect(html).toContain("open the whole HappyFox account");
    expect(html).toContain("default attribution, not a permission boundary");
    expect(html).toContain("name another agent's ID");
  });

  it("names the HappyFox role permissions the docs require", () => {
    expect(html).toContain("Manage Assets");
    expect(html).toContain("Manage all Contacts");
    expect(html).toContain("Moving tickets to another category needs a move");
  });

  it("lists the report and knowledge base resources and tools", () => {
    for (const uri of ["happyfox://reports", "happyfox://kb-articles", "happyfox://kb-internal-articles", "happyfox://kb-sections"]) {
      expect(html).toContain(uri);
    }
    expect(html).toContain("<strong>Reports</strong>");
    expect(html).toContain("<strong>Knowledge base</strong>");
    expect(html).toContain("choices account-wide");
  });

  it("gives the Docs/476 way to cut off a key instead of rotating it", () => {
    expect(html).not.toMatch(/rotat/i);
    expect(html).toContain("toggle in its edit slider");
    expect(html).toContain("Apps &rarr; Goodies &rarr; API");
  });

  it("explains the custom domain option", () => {
    expect(html).toContain("Custom domain");
    expect(html).toContain("support.yourcompany.com");
  });

  it("states that connections are rechecked on token refresh", () => {
    expect(html).toContain("refreshes its access token");
    expect(html).toContain("deactivated");
  });

  it("states the supported protocol version", () => {
    expect(html).toContain(MCP_PROTOCOL_VERSION);
  });

  it("links to the well-known metadata endpoints", () => {
    expect(html).toContain("/.well-known/oauth-authorization-server");
    expect(html).toContain("/.well-known/oauth-protected-resource/mcp");
  });

  it("escapes HTML in the origin", () => {
    const malicious = renderHomePage('https://evil"><script>alert(1)</script>');
    expect(malicious).not.toContain("<script>alert(1)</script>");
    expect(malicious).toContain("&lt;script&gt;");
  });
});
