import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { KnowledgeBaseEndpoints } from "../../../../src/happyfox/endpoints/knowledge-base";
import { HappyFoxAPIError } from "../../../../src/happyfox/client";
import { KnowledgeBaseTools } from "../../../../src/mcp/tools/knowledge-base";
import { ToolRegistry } from "../../../../src/mcp/tools/registry";
import { TOOL_SCOPE_MAP } from "../../../../src/oauth/services/scope-enforcer";
import { AuthContext, HappyFoxAuth } from "../../../../src/types";
import { createMockClient } from "../../../helpers/client-mock";
import { INJECTION_IDS, MALFORMED_IDS } from "../../../helpers/invalid-ids";
import {
  fetchMock,
  resetFetchMock,
  mockHappyFoxGet,
  mockHappyFoxRaw,
  sentHappyFoxRequests
} from "../../../helpers/fetch-mock-helpers";

const AUTH: HappyFoxAuth = { apiKey: "k", authCode: "c", accountName: "testaccount", region: "us" };

describe("KnowledgeBaseEndpoints", () => {
  let mockClient: ReturnType<typeof createMockClient>;
  let endpoints: KnowledgeBaseEndpoints;

  beforeEach(() => {
    mockClient = createMockClient();
    endpoints = new KnowledgeBaseEndpoints(mockClient as any);
    (mockClient.get as any).mockResolvedValue({ id: 5 });
  });

  it("sends GET /kb/article/<id> as Docs/360 §6 writes it", async () => {
    await expect(endpoints.getArticle(5)).resolves.toEqual({ id: 5 });
    expect(mockClient.get).toHaveBeenCalledTimes(1);
    expect(mockClient.get).toHaveBeenCalledWith("/kb/article/5");
  });

  it("sends GET /kb/section/<id> as Docs/360 §6 writes it", async () => {
    await endpoints.getSection("12");
    expect(mockClient.get).toHaveBeenCalledWith("/kb/section/12");
  });

  it.each([
    ["getArticle", "/kb/article/5"],
    ["getSection", "/kb/section/5"]
  ] as const)("%s retries a redirect once with the trailing slash", async (method, path) => {
    (mockClient.get as any)
      .mockRejectedValueOnce(new HappyFoxAPIError("redirected", 301, "REDIRECT"))
      .mockResolvedValueOnce({ id: 5, title: "Article" });

    await expect(endpoints[method](5)).resolves.toEqual({ id: 5, title: "Article" });
    expect((mockClient.get as any).mock.calls).toEqual([[path], [`${path}/`]]);
  });

  it("does not retry any other failure", async () => {
    (mockClient.get as any).mockRejectedValue(new HappyFoxAPIError("Not found", 404, "API_ERROR"));

    await expect(endpoints.getArticle(5)).rejects.toMatchObject({ statusCode: 404 });
    expect(mockClient.get).toHaveBeenCalledTimes(1);
  });

  it.each(["getArticle", "getSection"] as const)("%s refuses injected and malformed ids", async method => {
    for (const id of [...INJECTION_IDS, ...MALFORMED_IDS]) {
      await expect(endpoints[method](id as never))
        .rejects.toMatchObject({ name: "HappyFoxAPIError", statusCode: 400, code: "INVALID_ID" });
    }
    expect(mockClient.get).not.toHaveBeenCalled();
  });
});

describe("knowledge base tool schemas", () => {
  const tools = new Map(new KnowledgeBaseTools().getTools().map(tool => [tool.name, tool]));

  it("reads one article or section under happyfox:read", () => {
    expect([...tools.keys()]).toEqual(["happyfox_get_kb_article", "happyfox_get_kb_section"]);
    for (const name of tools.keys()) expect(TOOL_SCOPE_MAP[name], name).toEqual(["happyfox:read"]);
    expect(tools.get("happyfox_get_kb_article")!.inputSchema.required).toEqual(["article_id"]);
    expect(tools.get("happyfox_get_kb_section")!.inputSchema.required).toEqual(["section_id"]);
  });

  it("limits the single-article export to external articles (Docs/360 §6)", () => {
    const article = tools.get("happyfox_get_kb_article")!;
    expect(article.description).toContain("external");
    expect(article.description).toContain("happyfox://kb-internal-articles");
    expect(article.inputSchema.properties.article_id.description).toContain("happyfox://kb-articles");
    expect(tools.get("happyfox_get_kb_section")!.inputSchema.properties.section_id.description)
      .toContain("happyfox://kb-sections");
  });
});

describe("knowledge base tools through the registry", () => {
  const context: AuthContext = { credentials: AUTH, staffId: 7, scopes: ["happyfox:read"] };
  const registry = new ToolRegistry();

  beforeEach(() => {
    resetFetchMock();
  });

  afterEach(() => {
    fetchMock.deactivate();
  });

  it("reads one article with a plain GET", async () => {
    mockHappyFoxGet("/kb/article/5", { id: 5, title: "Reset a password" });

    await expect(registry.callToolWithAuth("happyfox_get_kb_article", { article_id: 5 }, context))
      .resolves.toEqual({ id: 5, title: "Reset a password" });
    expect(sentHappyFoxRequests().map(r => [r.method, r.apiPath, r.url.search])).toEqual([["GET", "/kb/article/5", ""]]);
  });

  it("follows a trailing-slash redirect by asking for the slashed path, never the Location", async () => {
    mockHappyFoxRaw("GET", "/kb/section/3", 301, "", {
      Location: "https://testaccount.happyfox.com/api/1.1/json/kb/section/3/"
    });
    mockHappyFoxGet("/kb/section/3/", { id: 3, name: "FAQ" });

    await expect(registry.callToolWithAuth("happyfox_get_kb_section", { section_id: "3" }, context))
      .resolves.toEqual({ id: 3, name: "FAQ" });
    expect(sentHappyFoxRequests().map(r => [r.apiPath, r.redirect])).toEqual([
      ["/kb/section/3", "manual"],
      ["/kb/section/3/", "manual"]
    ]);
  });

  it("gives up after the slashed path redirects too", async () => {
    mockHappyFoxRaw("GET", "/kb/article/5", 301, "", { Location: "https://testaccount.happyfox.net/" });
    mockHappyFoxRaw("GET", "/kb/article/5/", 301, "", { Location: "https://testaccount.happyfox.net/" });

    await expect(registry.callToolWithAuth("happyfox_get_kb_article", { article_id: 5 }, context))
      .rejects.toMatchObject({ name: "ToolExecutionError", statusCode: 301, errorCode: "REDIRECT" });
    expect(sentHappyFoxRequests()).toHaveLength(2);
  });
});
