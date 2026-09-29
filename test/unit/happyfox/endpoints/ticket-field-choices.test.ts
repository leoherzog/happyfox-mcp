import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TicketFieldChoiceEndpoints } from "../../../../src/happyfox/endpoints/ticket-field-choices";
import { TicketFieldChoiceTools } from "../../../../src/mcp/tools/ticket-field-choices";
import { ToolRegistry } from "../../../../src/mcp/tools/registry";
import { TOOL_SCOPE_MAP, TOOLS_REQUIRING_STAFF_ID } from "../../../../src/oauth/services/scope-enforcer";
import { AuthContext, HappyFoxAuth, InsufficientScopeError } from "../../../../src/types";
import { referenceCache } from "../../../../src/cache/reference-cache";
import { createMockClient } from "../../../helpers/client-mock";
import { INJECTION_IDS, MALFORMED_IDS } from "../../../helpers/invalid-ids";
import {
  fetchMock,
  resetFetchMock,
  mockHappyFoxPut,
  lastHappyFoxRequest
} from "../../../helpers/fetch-mock-helpers";

const AUTH: HappyFoxAuth = { apiKey: "k", authCode: "c", accountName: "testaccount", region: "us" };

/** The example payload of Docs/1247: keep Option 1, rename Option 2, drop Option 3, add Option 4. */
const DOC_PAYLOAD = {
  choices: [
    { id: 11, text: "Option 1", dependant_fields: [] },
    { id: 12, text: "Option 2 (Edited)", dependant_fields: [] },
    { id: null, text: "Options 4", dependant_fields: [] }
  ]
};

describe("TicketFieldChoiceEndpoints", () => {
  let mockClient: ReturnType<typeof createMockClient>;
  let endpoints: TicketFieldChoiceEndpoints;

  beforeEach(() => {
    mockClient = createMockClient();
    endpoints = new TicketFieldChoiceEndpoints(mockClient as any);
    (mockClient.put as any).mockResolvedValue({ id: 1, type: "choice" });
  });

  function putBody(): any {
    expect(mockClient.put).toHaveBeenCalledTimes(1);
    return (mockClient.put as any).mock.calls[0][1];
  }

  function expectRefused(promise: Promise<unknown>, code = "INVALID_ARGUMENT") {
    return expect(promise).rejects.toMatchObject({ name: "HappyFoxAPIError", statusCode: 400, code });
  }

  it("sends the Docs/1247 example as PUT /ticket_custom_field/<id>/", async () => {
    await expect(endpoints.replaceChoices(1, DOC_PAYLOAD.choices)).resolves.toEqual({ id: 1, type: "choice" });

    expect((mockClient.put as any).mock.calls[0][0]).toBe("/ticket_custom_field/1/");
    expect(putBody()).toEqual(DOC_PAYLOAD);
  });

  it("sends only the documented choice keys, in the documented form", async () => {
    await endpoints.replaceChoices("61", [
      { id: "2", text: "No", dependant_fields: [], label: "ignored" },
      { id: null, text: "Maybe" }
    ] as never);

    expect(putBody()).toEqual({
      choices: [
        { id: 2, text: "No", dependant_fields: [] },
        { id: null, text: "Maybe", dependant_fields: [] }
      ]
    });
  });

  it("keeps an existing choice's dependant_fields unchanged", async () => {
    const dependantFields = [7, { id: 8 }];
    await endpoints.replaceChoices(61, [{ id: 1, text: "Yes", dependant_fields: dependantFields }]);

    expect(putBody().choices[0].dependant_fields).toEqual(dependantFields);
  });

  const refused: Array<[string, unknown]> = [
    ["no choices", undefined],
    ["an empty list, which would delete every choice", []],
    ["a non-list", { id: 1, text: "x" }],
    ["a choice that is not an object", ["Option 1"]],
    ["a blank text", [{ id: null, text: " " }]],
    ["a missing text", [{ id: 11, dependant_fields: [] }]],
    ["a choice that omits id, which would replace an existing choice under a new id", [
      { id: 11, text: "Option 1", dependant_fields: [] },
      { text: "Option 2 (Edited)" }
    ]],
    ["an existing choice without its dependant_fields", [{ id: 11, text: "Option 1" }]],
    ["dependant_fields that is not a list", [{ id: null, text: "New", dependant_fields: "none" }]],
    ["a repeated choice id", [
      { id: 11, text: "Option 1", dependant_fields: [] },
      { id: "11", text: "Option 1 again", dependant_fields: [] }
    ]]
  ];

  it.each(refused)("refuses %s before any request", async (_label, choices) => {
    await expectRefused(endpoints.replaceChoices(1, choices));
    expect(mockClient.put).not.toHaveBeenCalled();
  });

  it("names the choice whose id key is missing", async () => {
    await expect(endpoints.replaceChoices(1, [
      { id: 11, text: "Option 1", dependant_fields: [] },
      { text: "Option 2 (Edited)" }
    ])).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
      message: expect.stringMatching(/^choices\[1\]\.id is required: .* or null for a new choice\./)
    });
    expect(mockClient.put).not.toHaveBeenCalled();
  });

  it("refuses a choice id that is not a positive integer", async () => {
    for (const id of ["Option 1", 0, -2, 1.5, "#11"]) {
      await expectRefused(endpoints.replaceChoices(1, [{ id, text: "x", dependant_fields: [] }]), "INVALID_ID");
    }
    expect(mockClient.put).not.toHaveBeenCalled();
  });

  it("refuses injected and malformed field ids before checking choices", async () => {
    for (const id of [...INJECTION_IDS, ...MALFORMED_IDS]) {
      await expectRefused(endpoints.replaceChoices(id as never, []), "INVALID_ID");
    }
    expect(mockClient.put).not.toHaveBeenCalled();
  });
});

describe("ticket custom field choices tool", () => {
  const tool = new TicketFieldChoiceTools().getTools()[0];

  it("is an admin tool with no acting agent", () => {
    expect(tool.name).toBe("happyfox_update_ticket_custom_field_choices");
    expect(TOOL_SCOPE_MAP[tool.name]).toEqual(["happyfox:admin"]);
    expect(TOOLS_REQUIRING_STAFF_ID[tool.name]).toBeUndefined();
    expect(tool.inputSchema.required).toEqual(["custom_field_id", "choices"]);
  });

  it("says the change is account-wide and deletes omitted choices", () => {
    expect(tool.description).toContain("account-wide");
    expect(tool.description).toContain("deletes every existing choice left out");
    expect(tool.description).toContain("happyfox://ticket-custom-fields");
  });

  it("mirrors the documented choice shape", () => {
    const choices = tool.inputSchema.properties.choices;
    expect(choices.minItems).toBe(1);
    expect(choices.items.required).toEqual(["id", "text"]);
    expect(choices.items.properties.id.type).toEqual(["integer", "string", "null"]);
    expect(choices.items.properties.dependant_fields.type).toBe("array");
    expect(choices.items.properties.dependant_fields.items).toEqual({});
    expect(choices.items.properties.dependant_fields.description).toContain("Required for an existing choice");
  });
});

describe("ticket custom field choices through the registry", () => {
  const admin: AuthContext = { credentials: AUTH, staffId: 7, scopes: ["happyfox:admin"] };
  const registry = new ToolRegistry();

  beforeEach(async () => {
    resetFetchMock();
    await referenceCache.invalidate(AUTH, "ticket-custom-fields");
  });

  afterEach(() => {
    fetchMock.deactivate();
  });

  it("sends the documented PUT and drops the cached field definitions", async () => {
    await referenceCache.set(AUTH, "ticket-custom-fields", [{ id: 1, choices: [{ id: 13, text: "Option 3" }] }]);
    mockHappyFoxPut("/ticket_custom_field/1/", { id: 1, choices: [{ id: 14, text: "Options 4" }] });

    await registry.callToolWithAuth(
      "happyfox_update_ticket_custom_field_choices", { custom_field_id: 1, ...DOC_PAYLOAD }, admin
    );

    const request = lastHappyFoxRequest();
    expect([request.method, request.apiPath, request.url.search]).toEqual(["PUT", "/ticket_custom_field/1/", ""]);
    expect(request.json()).toEqual(DOC_PAYLOAD);
    expect(await referenceCache.get(AUTH, "ticket-custom-fields")).toBeNull();
  });

  it("drops the cached definitions when the change fails too", async () => {
    await referenceCache.set(AUTH, "ticket-custom-fields", [{ id: 1 }]);
    mockHappyFoxPut("/ticket_custom_field/1/", { error: "Only choices can be updated" }, 400);

    await expect(registry.callToolWithAuth(
      "happyfox_update_ticket_custom_field_choices", { custom_field_id: 1, ...DOC_PAYLOAD }, admin
    )).rejects.toMatchObject({ name: "ToolExecutionError", statusCode: 400, message: "Only choices can be updated" });
    expect(await referenceCache.get(AUTH, "ticket-custom-fields")).toBeNull();
  });

  it("sends a lost PUT once and says to re-read the field before repeating it", async () => {
    await referenceCache.set(AUTH, "ticket-custom-fields", [{ id: 1 }]);
    fetchMock
      .get("https://testaccount.happyfox.com")
      .intercept({ path: "/api/1.1/json/ticket_custom_field/1/", method: "PUT" })
      .replyWithError(Object.assign(new Error("Connection reset"), { code: "ECONNRESET" }));

    const error = await registry.callToolWithAuth(
      "happyfox_update_ticket_custom_field_choices", { custom_field_id: 1, ...DOC_PAYLOAD }, admin
    ).catch(e => e);

    expect(error).toMatchObject({ name: "ToolExecutionError", statusCode: 0, errorCode: "NETWORK_ERROR" });
    expect(error.message).toContain("HappyFox may still have applied this write");
    expect(error.message).toContain("Re-read happyfox://ticket-custom-fields");
    expect(fetchMock.requests()).toHaveLength(1);
    expect(await referenceCache.get(AUTH, "ticket-custom-fields")).toBeNull();
  });

  it("needs happyfox:admin", async () => {
    const readWrite: AuthContext = { ...admin, scopes: ["happyfox:read", "happyfox:write"] };

    await expect(registry.callToolWithAuth(
      "happyfox_update_ticket_custom_field_choices", { custom_field_id: 1, ...DOC_PAYLOAD }, readWrite
    )).rejects.toBeInstanceOf(InsufficientScopeError);
    expect(fetchMock.requests()).toHaveLength(0);
  });
});
