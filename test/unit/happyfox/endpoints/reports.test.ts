import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  ReportEndpoints,
  REPORT_PERIOD_RANGES,
  REPORT_PERIOD_TYPES,
  TABULAR_SORT_KEYS
} from "../../../../src/happyfox/endpoints/reports";
import { ReportTools } from "../../../../src/mcp/tools/reports";
import { ToolRegistry } from "../../../../src/mcp/tools/registry";
import { TOOL_SCOPE_MAP, TOOLS_REQUIRING_STAFF_ID } from "../../../../src/oauth/services/scope-enforcer";
import { AuthContext, HappyFoxAuth } from "../../../../src/types";
import { createMockClient } from "../../../helpers/client-mock";
import { INJECTION_IDS, MALFORMED_IDS } from "../../../helpers/invalid-ids";
import {
  fetchMock,
  resetFetchMock,
  mockHappyFoxGet,
  lastHappyFoxRequest
} from "../../../helpers/fetch-mock-helpers";

const AUTH: HappyFoxAuth = { apiKey: "k", authCode: "c", accountName: "testaccount", region: "us" };

/** The period filter of the Docs/1088 §9 "Specific date range" example. */
const DOC_RANGE = {
  period_start: "2019-01-09",
  period_end: "2019-08-05",
  period_type: "cr",
  period_date_range_type: "sr"
};
const DOC_RANGE_QUERY = "period_start=2019-01-09&period_end=2019-08-05&period_type=cr&period_date_range_type=sr";

type View = "getTabularData" | "getResponseStats" | "getStaffPerformance" | "getStaffActivity" | "getContactActivity" | "getSlaPerformance";

/** Each filterable view and the path Docs/1088 §3-8 give it, for report 3. */
const VIEWS: Array<[View, string]> = [
  ["getTabularData", "/report/3/tabulardata/"],
  ["getResponseStats", "/report/3/responsestats/"],
  ["getStaffPerformance", "/report/3/staffperformance/"],
  ["getStaffActivity", "/report/3/staffactivity/"],
  ["getContactActivity", "/report/3/customeractivity/"],
  ["getSlaPerformance", "/report/3/slaentries/"]
];

/** The views Docs/1088 shows answering with a page_count envelope. */
const PAGED_VIEWS: View[] = ["getTabularData", "getStaffPerformance", "getStaffActivity", "getContactActivity"];

describe("ReportEndpoints", () => {
  let mockClient: ReturnType<typeof createMockClient>;
  let endpoints: ReportEndpoints;

  beforeEach(() => {
    mockClient = createMockClient();
    endpoints = new ReportEndpoints(mockClient as any);
    (mockClient.get as any).mockResolvedValue({ rows: [] });
  });

  /** The query of the only GET sent. */
  function sentQuery(): Record<string, unknown> {
    expect(mockClient.get).toHaveBeenCalledTimes(1);
    return (mockClient.get as any).mock.calls[0][1];
  }

  function expectInvalid(promise: Promise<unknown>, code = "INVALID_ARGUMENT") {
    return expect(promise).rejects.toMatchObject({ name: "HappyFoxAPIError", statusCode: 400, code });
  }

  describe("getReportSummary", () => {
    it("sends GET /report/<id>/ with no query (Docs/1088 §2)", async () => {
      (mockClient.get as any).mockResolvedValue({ ticket_count: 0, completed_count: 0 });

      await expect(endpoints.getReportSummary(7)).resolves.toEqual({ ticket_count: 0, completed_count: 0 });
      expect(mockClient.get).toHaveBeenCalledWith("/report/7/");
    });

    it("accepts a report id given as a digit string", async () => {
      await endpoints.getReportSummary("7");
      expect(mockClient.get).toHaveBeenCalledWith("/report/7/");
    });
  });

  describe("view paths", () => {
    it.each(VIEWS)("%s sends GET %s", async (view, path) => {
      await endpoints[view](3);
      expect((mockClient.get as any).mock.calls[0][0]).toBe(path);
    });

    it.each(PAGED_VIEWS)("%s asks for the largest page by default (Docs/1088 §3)", async view => {
      await endpoints[view](3);
      expect(sentQuery()).toEqual({ size: 50, page: 1 });
    });

    it.each(["getResponseStats", "getSlaPerformance"] as View[])("%s sends no query without a period", async view => {
      await endpoints[view](3);
      expect(sentQuery()).toEqual({});
    });
  });

  describe("period filter (Docs/1088 §9)", () => {
    it.each(VIEWS)("%s passes the documented date range", async view => {
      await endpoints[view](3, DOC_RANGE);
      expect(sentQuery()).toMatchObject(DOC_RANGE);
    });

    it("sends the doc's year-to-date example", async () => {
      await endpoints.getResponseStats(3, { period_type: "cr", period_date_range_type: "ytd" });
      expect(sentQuery()).toEqual({ period_type: "cr", period_date_range_type: "ytd" });
    });

    it("accepts every documented period type and range", async () => {
      for (const period_type of Object.keys(REPORT_PERIOD_TYPES)) {
        for (const period_date_range_type of Object.keys(REPORT_PERIOD_RANGES).filter(range => range !== "sr")) {
          await endpoints.getSlaPerformance(3, { period_type, period_date_range_type });
        }
      }
      expect(mockClient.get).toHaveBeenCalledTimes(7 * 5);
    });

    it("implies sr when only the dates are given", async () => {
      await endpoints.getResponseStats(3, { period_type: "cl", period_start: "2024-02-01", period_end: "2024-02-29" });
      expect(sentQuery()).toEqual({
        period_start: "2024-02-01",
        period_end: "2024-02-29",
        period_type: "cl",
        period_date_range_type: "sr"
      });
    });

    const rejected: Array<[string, Record<string, unknown>]> = [
      ["a range without period_type", { period_date_range_type: "l7d" }],
      ["dates without period_type", { period_start: "2024-01-01", period_end: "2024-01-31" }],
      ["period_type without a range", { period_type: "cr" }],
      ["an undocumented period_type", { period_type: "created", period_date_range_type: "l7d" }],
      ["an undocumented range", { period_type: "cr", period_date_range_type: "last_week" }],
      ["sr without dates", { period_type: "cr", period_date_range_type: "sr" }],
      ["sr with only a start", { period_type: "cr", period_date_range_type: "sr", period_start: "2024-01-01" }],
      ["dates with another range", { ...DOC_RANGE, period_date_range_type: "ytd" }],
      ["a dd/mm/yyyy date", { ...DOC_RANGE, period_start: "09/01/2019" }],
      ["an impossible date", { ...DOC_RANGE, period_end: "2019-02-30" }],
      ["a date with a time", { ...DOC_RANGE, period_end: "2019-08-05T00:00:00Z" }],
      ["a start after the end", { ...DOC_RANGE, period_start: "2019-08-06" }]
    ];

    it.each(rejected)("refuses %s before any request", async (_label, period) => {
      await expectInvalid(endpoints.getTabularData(3, period));
      expect(mockClient.get).not.toHaveBeenCalled();
    });
  });

  describe("sorting (Docs/1088 §9)", () => {
    it("sends the tabular sort key and direction", async () => {
      await endpoints.getTabularData(3, { sort_key: "created", sort_dir: "d" });
      expect(sentQuery()).toEqual({ sort_key: "created", sort_dir: "d", size: 50, page: 1 });
    });

    it("accepts every documented tabular sort key", async () => {
      for (const sort_key of Object.keys(TABULAR_SORT_KEYS)) {
        await endpoints.getTabularData(3, { sort_key });
      }
      expect(Object.keys(TABULAR_SORT_KEYS)).toEqual(["ticket", "status", "created", "duedate", "assigned"]);
      expect(mockClient.get).toHaveBeenCalledTimes(5);
    });

    it("refuses a sort key the tabular view does not document", async () => {
      await expectInvalid(endpoints.getTabularData(3, { sort_key: "name" }));
      await expectInvalid(endpoints.getTabularData(3, { sort_dir: "desc" }));
      expect(mockClient.get).not.toHaveBeenCalled();
    });

    it.each(["getStaffPerformance", "getStaffActivity", "getContactActivity"] as View[])(
      "%s sorts by name, its only documented key",
      async view => {
        await endpoints[view](3, { sort_dir: "d" } as never);
        expect(sentQuery()).toEqual({ sort_key: "name", sort_dir: "d", size: 50, page: 1 });
      }
    );
  });

  describe("paging (Docs/1088 §3)", () => {
    it("sends the doc's size and page", async () => {
      await endpoints.getTabularData(1, { size: 50, page: 1 });
      expect(sentQuery()).toEqual({ size: 50, page: 1 });
    });

    it("caps size at 50 and accepts digit strings", async () => {
      await endpoints.getStaffActivity(1, { size: "80", page: "3" });
      expect(sentQuery()).toEqual({ size: 50, page: 3 });
    });

    it.each([0, -1, 1.5, "two", ""])("refuses page %j", async page => {
      await expectInvalid(endpoints.getTabularData(1, { page: page as never }));
      expect(mockClient.get).not.toHaveBeenCalled();
    });
  });

  describe("id validation", () => {
    const calls: Array<[string, (id: unknown) => Promise<unknown>]> = [
      ["getReportSummary", id => endpoints.getReportSummary(id as never)],
      ...VIEWS.map(([view]) => [view, (id: unknown) => endpoints[view](id as never)] as [string, (id: unknown) => Promise<unknown>])
    ];

    it.each(calls)("%s refuses injected and malformed report ids", async (_name, call) => {
      for (const id of [...INJECTION_IDS, ...MALFORMED_IDS]) {
        await expectInvalid(call(id), "INVALID_ID");
      }
      expect(mockClient.get).not.toHaveBeenCalled();
    });

    it("reports a bad id before a bad filter", async () => {
      await expectInvalid(endpoints.getTabularData("../reports/#", { period_type: "nope" }), "INVALID_ID");
    });
  });
});

describe("report tool schemas", () => {
  const tools = new Map(new ReportTools().getTools().map(tool => [tool.name, tool]));
  const schema = (name: string) => tools.get(name)!.inputSchema;

  const NAMES = [
    "happyfox_get_report_summary",
    "happyfox_get_report_tabular_data",
    "happyfox_get_report_response_stats",
    "happyfox_get_report_staff_performance",
    "happyfox_get_report_staff_activity",
    "happyfox_get_report_contact_activity",
    "happyfox_get_report_sla_performance"
  ];

  it("offers one read-only tool per documented view", () => {
    expect([...tools.keys()]).toEqual(NAMES);
    for (const name of NAMES) {
      expect(TOOL_SCOPE_MAP[name], name).toEqual(["happyfox:read"]);
      expect(TOOLS_REQUIRING_STAFF_ID[name], name).toBeUndefined();
      expect(schema(name).required, name).toEqual(["report_id"]);
      expect(schema(name).properties.report_id.pattern, name).toBe("^[0-9]+$");
      expect(schema(name).properties.report_id.description, name).toContain("happyfox://reports");
    }
  });

  it("offers the period filter on every view Docs/1088 §9 lists, not on the summary", () => {
    expect(schema("happyfox_get_report_summary").properties).not.toHaveProperty("period_type");
    for (const name of NAMES.slice(1)) {
      const properties = schema(name).properties;
      expect(properties.period_type.enum, name).toEqual(["cr", "as", "str", "cur", "prs", "srp", "cl"]);
      expect(properties.period_date_range_type.enum, name).toEqual(["sr", "tod", "l7d", "mtd", "ytd", "pm"]);
      expect(properties.period_start.pattern, name).toBe("^[0-9]{4}-[0-9]{2}-[0-9]{2}$");
      expect(properties.period_end.pattern, name).toBe("^[0-9]{4}-[0-9]{2}-[0-9]{2}$");
    }
  });

  it("pages and sorts only the views that return a page_count envelope", () => {
    for (const name of ["happyfox_get_report_response_stats", "happyfox_get_report_sla_performance"]) {
      expect(schema(name).properties, name).not.toHaveProperty("page");
      expect(schema(name).properties, name).not.toHaveProperty("sort_dir");
    }
    for (const name of NAMES.slice(3, 6)) {
      expect(schema(name).properties.size.maximum, name).toBe(50);
      expect(schema(name).properties.sort_dir.enum, name).toEqual(["a", "d"]);
      expect(schema(name).properties, name).not.toHaveProperty("sort_key");
    }
    const tabular = schema("happyfox_get_report_tabular_data").properties;
    expect(tabular.sort_key.enum).toEqual(["ticket", "status", "created", "duedate", "assigned"]);
    expect(tabular.size.description).toContain("default 50");
  });

  it("tells the model which tabular id the ticket tools take", () => {
    const description = tools.get("happyfox_get_report_tabular_data")!.description;
    expect(description).toContain("numeric ticket number");
    expect(description).toContain("display_id");
  });
});

describe("report tools through the registry", () => {
  const context: AuthContext = { credentials: AUTH, staffId: 7, scopes: ["happyfox:read"] };
  const registry = new ToolRegistry();

  beforeEach(() => {
    resetFetchMock();
  });

  afterEach(() => {
    fetchMock.deactivate();
  });

  it("reads the summary with GET /report/<id>/", async () => {
    mockHappyFoxGet("/report/7/", { ticket_count: 4 });

    await expect(registry.callToolWithAuth("happyfox_get_report_summary", { report_id: 7 }, context))
      .resolves.toEqual({ ticket_count: 4 });
    const request = lastHappyFoxRequest();
    expect([request.method, request.apiPath, request.url.search]).toEqual(["GET", "/report/7/", ""]);
  });

  it("sends the doc's tabular paging example on the wire", async () => {
    mockHappyFoxGet("/report/1/tabulardata/", { rows: [] });

    await registry.callToolWithAuth("happyfox_get_report_tabular_data", { report_id: "1", size: 50, page: 1 }, context);

    expect(lastHappyFoxRequest().query.toString()).toBe("size=50&page=1");
  });

  it("sends the doc's date range example on the wire", async () => {
    mockHappyFoxGet("/report/3/responsestats/", []);

    await registry.callToolWithAuth("happyfox_get_report_response_stats", { report_id: 3, ...DOC_RANGE }, context);

    const request = lastHappyFoxRequest();
    expect(request.method).toBe("GET");
    expect(request.query.toString()).toBe(DOC_RANGE_QUERY);
  });

  it.each([
    ["happyfox_get_report_staff_performance", "/report/3/staffperformance/"],
    ["happyfox_get_report_staff_activity", "/report/3/staffactivity/"],
    ["happyfox_get_report_contact_activity", "/report/3/customeractivity/"]
  ])("%s sends GET %s with the name sort", async (tool, path) => {
    mockHappyFoxGet(path, { rows: [] });

    await registry.callToolWithAuth(tool, { report_id: 3, period_type: "as", period_date_range_type: "pm", sort_dir: "d" }, context);

    const request = lastHappyFoxRequest();
    expect(request.apiPath).toBe(path);
    expect(request.query.toString()).toBe("period_type=as&period_date_range_type=pm&sort_key=name&sort_dir=d&size=50&page=1");
  });

  it("reads SLA entries with GET /report/<id>/slaentries/", async () => {
    mockHappyFoxGet("/report/3/slaentries/", [{ name: "Sla 1", target: 100 }]);

    await expect(registry.callToolWithAuth("happyfox_get_report_sla_performance", { report_id: 3 }, context))
      .resolves.toEqual([{ name: "Sla 1", target: 100 }]);
    expect(lastHappyFoxRequest().url.search).toBe("");
  });

  it("surfaces an invalid filter as a tool error without a request", async () => {
    await expect(registry.callToolWithAuth(
      "happyfox_get_report_tabular_data", { report_id: 3, period_type: "cr" }, context
    )).rejects.toMatchObject({ name: "ToolExecutionError", statusCode: 400, errorCode: "INVALID_ARGUMENT" });
    expect(fetchMock.requests()).toHaveLength(0);
  });
});
