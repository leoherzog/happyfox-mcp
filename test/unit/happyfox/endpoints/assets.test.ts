import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AssetEndpoints, AssetInput } from "../../../../src/happyfox/endpoints/assets";
import { HappyFoxClient } from "../../../../src/happyfox/client";
import { AssetTools } from "../../../../src/mcp/tools/assets";
import { ToolRegistry } from "../../../../src/mcp/tools/registry";
import { TOOL_SCOPE_MAP, TOOLS_REQUIRING_STAFF_ID } from "../../../../src/oauth/services/scope-enforcer";
import { AuthContext, HappyFoxAuth } from "../../../../src/types";
import { createMockClient } from "../../../helpers/client-mock";
import { INJECTION_IDS, MALFORMED_IDS } from "../../../helpers/invalid-ids";
import {
  fetchMock,
  resetFetchMock,
  mockHappyFoxGet,
  mockHappyFoxPost,
  mockHappyFoxPut,
  mockHappyFoxDelete,
  lastHappyFoxRequest
} from "../../../helpers/fetch-mock-helpers";

const AUTH: HappyFoxAuth = { apiKey: "k", authCode: "c", accountName: "testaccount", region: "us" };

/** The smallest asset Docs/1201 §3 accepts. */
const BASE_ASSET: AssetInput = { name: "Test Asset", display_id: "ASSET-001", created_by: 7 };

/** The example payload of Docs/1201 §3, minus the new contact. */
const DOC_CREATE_PAYLOAD = {
  name: "Macbook pro v1",
  display_id: "macbook_pro_v1",
  contact_ids: ["1"],
  contact_group_ids: ["1"],
  created_by: 1,
  custom_fields: {
    "1": "1",
    "2": "Macbook Pro - 2020",
    "3": "This is the most recent version of the available Macbook Pro",
    "4": "C034234ZHY",
    "5": 4,
    "6": [3, 4],
    "7": "2020-11-15"
  }
};

/** A paginated list body as Docs/1201 §6 documents it. */
const CUSTOM_FIELD_PAGE = {
  page_info: { count: 1, last_index: 1, page_count: 1, start_index: 1, end_index: 1 },
  data: [{ id: 45, type: "text", asset_type: { id: 1, name: "General" }, name: "Serial Number", choices: null }]
};

describe("AssetEndpoints", () => {
  let mockClient: ReturnType<typeof createMockClient>;
  let endpoints: AssetEndpoints;

  beforeEach(() => {
    mockClient = createMockClient();
    endpoints = new AssetEndpoints(mockClient as any);
    (mockClient.get as any).mockResolvedValue({ page_info: {}, data: [] });
    (mockClient.post as any).mockResolvedValue({ id: 1 });
    (mockClient.put as any).mockResolvedValue({ id: 123 });
    (mockClient.delete as any).mockResolvedValue({});
  });

  afterEach(() => {
    fetchMock.deactivate();
  });

  /** The body of the only POST sent. */
  function postedBody(): any {
    expect(mockClient.post).toHaveBeenCalledTimes(1);
    return (mockClient.post as any).mock.calls[0][1];
  }

  /** The body of the only PUT sent. */
  function putBody(): any {
    expect(mockClient.put).toHaveBeenCalledTimes(1);
    return (mockClient.put as any).mock.calls[0][1];
  }

  function expectNothingSent() {
    expect(mockClient.get).not.toHaveBeenCalled();
    expect(mockClient.post).not.toHaveBeenCalled();
    expect(mockClient.put).not.toHaveBeenCalled();
    expect(mockClient.delete).not.toHaveBeenCalled();
  }

  describe("listAssets", () => {
    it("sets default pagination", async () => {
      await endpoints.listAssets();

      expect(mockClient.get).toHaveBeenCalledWith("/assets/", { page: 1, size: 50 });
    });

    it("caps size at 50, the Docs/1201 §1 maximum", async () => {
      await endpoints.listAssets({ size: 100 });

      expect(mockClient.get).toHaveBeenCalledWith("/assets/", expect.objectContaining({ size: 50 }));
    });

    it("allows size less than 50", async () => {
      await endpoints.listAssets({ size: 10 });

      expect(mockClient.get).toHaveBeenCalledWith("/assets/", expect.objectContaining({ size: 10 }));
    });

    it("sends asset_type as a number", async () => {
      await endpoints.listAssets({ page: 2, size: 25, asset_type: "3" });

      expect(mockClient.get).toHaveBeenCalledWith("/assets/", { page: 2, size: 25, asset_type: 3 });
    });

    it("omits asset_type when not provided", async () => {
      await endpoints.listAssets({});

      expect((mockClient.get as any).mock.calls[0][1]).not.toHaveProperty("asset_type");
    });

    it.each([
      [{ page: 0 }, "page"],
      [{ page: 1.5 }, "page"],
      [{ size: -1 }, "size"],
      [{ size: "ten" }, "size"]
    ])("rejects %j before any request", async (params, param) => {
      await expect(endpoints.listAssets(params as any)).rejects.toMatchObject({
        statusCode: 400,
        code: "INVALID_ARGUMENT",
        message: expect.stringContaining(param)
      });
      expectNothingSent();
    });

    it("rejects an asset_type that is not a numeric id", async () => {
      await expect(endpoints.listAssets({ asset_type: "General" })).rejects.toMatchObject({ code: "INVALID_ID" });
      expectNothingSent();
    });

    it("sends GET /assets/ with page, size and asset_type on the wire", async () => {
      resetFetchMock();
      mockHappyFoxGet("/assets/", { page_info: {}, data: [] });

      await new AssetEndpoints(new HappyFoxClient(AUTH)).listAssets({ asset_type: 3 });

      const request = lastHappyFoxRequest();
      expect(request.method).toBe("GET");
      expect(request.apiPath).toBe("/assets/");
      expect(Object.fromEntries(request.query)).toEqual({ page: "1", size: "50", asset_type: "3" });
    });
  });

  describe("getAsset", () => {
    it("fetches asset by ID", async () => {
      await endpoints.getAsset(123);

      expect(mockClient.get).toHaveBeenCalledWith("/asset/123/");
    });
  });

  describe("createAsset", () => {
    it("sends name, display_id and created_by, with asset_type as a query parameter", async () => {
      await endpoints.createAsset(5, BASE_ASSET);

      expect(mockClient.post).toHaveBeenCalledWith(
        "/assets/",
        { name: "Test Asset", display_id: "ASSET-001", created_by: 7 },
        { asset_type: 5 }
      );
    });

    it("sends ids given as digit strings as numbers", async () => {
      await endpoints.createAsset("5", { ...BASE_ASSET, created_by: "9", contact_ids: ["10", 20] });

      expect(postedBody()).toMatchObject({ created_by: 9, contact_ids: [10, 20] });
      expect((mockClient.post as any).mock.calls[0][2]).toEqual({ asset_type: 5 });
    });

    it.each([undefined, null, ""])("requires asset_type_id (%j) rather than fall back to the first asset type", async (type) => {
      await expect(endpoints.createAsset(type as any, BASE_ASSET)).rejects.toMatchObject({
        statusCode: 400,
        code: "INVALID_ARGUMENT",
        message: expect.stringContaining("asset_type_id is required")
      });
      expectNothingSent();
    });

    it("rejects an asset_type_id that is not a numeric id", async () => {
      for (const type of [...INJECTION_IDS, "General", 0, 1.5]) {
        await expect(endpoints.createAsset(type as any, BASE_ASSET)).rejects.toMatchObject({
          code: "INVALID_ID",
          message: expect.stringContaining("asset_type_id")
        });
      }
      expectNothingSent();
    });

    it("requires display_id, as the Docs/1201 §3 400 example shows", async () => {
      const { display_id: _omitted, ...withoutDisplayId } = BASE_ASSET;

      await expect(endpoints.createAsset(5, withoutDisplayId as AssetInput)).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        message: "display_id is required, as a non-empty string."
      });
      expectNothingSent();
    });

    it("requires name", async () => {
      await expect(endpoints.createAsset(5, { ...BASE_ASSET, name: " " })).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        message: "name is required, as a non-empty string."
      });
      expectNothingSent();
    });

    it("allows a name of up to 200 characters, counted as characters rather than UTF-16 units (Docs/1201 §3)", async () => {
      await endpoints.createAsset(5, { ...BASE_ASSET, name: "💻".repeat(200) });

      expect(postedBody().name).toBe("💻".repeat(200));
    });

    it("rejects a name longer than 200 characters", async () => {
      await expect(endpoints.createAsset(5, { ...BASE_ASSET, name: "x".repeat(201) })).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        message: "name has 201 characters; HappyFox allows at most 200."
      });
      expectNothingSent();
    });

    it("requires the acting agent in created_by", async () => {
      const { created_by: _omitted, ...withoutAgent } = BASE_ASSET;

      await expect(endpoints.createAsset(5, withoutAgent as AssetInput)).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        message: expect.stringContaining("created_by is required")
      });
      await expect(endpoints.createAsset(5, { ...BASE_ASSET, created_by: "me" })).rejects.toMatchObject({
        code: "INVALID_ID",
        message: expect.stringContaining("created_by")
      });
      expectNothingSent();
    });

    it("links existing contacts and contact groups (Docs/1201 §3)", async () => {
      await endpoints.createAsset(5, { ...BASE_ASSET, contact_ids: [10, 20], contact_group_ids: ["1", 2] });

      expect(postedBody()).toEqual({ ...BASE_ASSET, contact_ids: [10, 20], contact_group_ids: [1, 2] });
    });

    it("rejects contact_group_ids that are not numeric ids", async () => {
      await expect(endpoints.createAsset(5, { ...BASE_ASSET, contact_group_ids: ["APAC Region"] })).rejects.toMatchObject({
        code: "INVALID_ID",
        message: expect.stringContaining("contact_group_ids[0]")
      });
      await expect(endpoints.createAsset(5, { ...BASE_ASSET, contact_group_ids: 1 as any })).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        message: expect.stringContaining("contact_group_ids")
      });
      expectNothingSent();
    });

    it("nests custom field values under custom_fields keyed by bare field id (Docs/1201 §3)", async () => {
      await endpoints.createAsset(5, {
        ...BASE_ASSET,
        custom_fields: { "1": "1", "5": 4, "6": [3, "4"], "7": "2020-11-15" }
      });

      expect(postedBody()).toEqual({
        name: "Test Asset",
        display_id: "ASSET-001",
        created_by: 7,
        custom_fields: { "1": "1", "5": 4, "6": [3, 4], "7": "2020-11-15" }
      });
    });

    it("sends no custom_fields for an empty object", async () => {
      await endpoints.createAsset(5, { ...BASE_ASSET, custom_fields: {} });

      expect(postedBody()).not.toHaveProperty("custom_fields");
    });

    it.each(["a-cf-1", "t-cf-1", "c-cf-1", "name", "created_by", "01", "0", "1.5"])(
      "rejects the custom_fields key %j, so nothing is smuggled beside the field ids",
      async (key) => {
        await expect(endpoints.createAsset(5, { ...BASE_ASSET, custom_fields: { [key]: "x" } })).rejects.toMatchObject({
          statusCode: 400,
          code: "INVALID_ARGUMENT",
          message: expect.stringContaining(`custom_fields key ${JSON.stringify(key)}`)
        });
        expectNothingSent();
      }
    );

    it.each([
      [12.5, "integers only"],
      [["Laptop"], "list of option ids"],
      [[0], "list of option ids"],
      [null, "expected a string"],
      [true, "expected a string"],
      [{ id: 1 }, "expected a string"]
    ])("rejects the custom field value %j", async (value, message) => {
      await expect(endpoints.createAsset(5, { ...BASE_ASSET, custom_fields: { "56": value } })).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        message: expect.stringContaining(message)
      });
      expectNothingSent();
    });

    it("rejects custom_fields that is not an object", async () => {
      await expect(endpoints.createAsset(5, { ...BASE_ASSET, custom_fields: [["1", "x"]] as any })).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        message: expect.stringContaining("keyed by custom field id")
      });
    });

    describe("new contacts", () => {
      it("sends only name, email and typed phones for each contact", async () => {
        await endpoints.createAsset(5, {
          ...BASE_ASSET,
          contacts: [
            { name: "Contact 1", email: "c1@example.com", is_login_enabled: true } as any,
            { name: "Contact 2", email: "c2@example.com", phones: [{ number: "555-1234", type: "mobile", is_primary: true }] }
          ]
        });

        expect(postedBody().contacts).toEqual([
          { name: "Contact 1", email: "c1@example.com" },
          { name: "Contact 2", email: "c2@example.com", phones: [{ type: "mo", number: "555-1234", is_primary: true }] }
        ]);
      });

      it("accepts a phone-only contact and sends its email as null, as Docs/1092 §4 requires", async () => {
        await endpoints.createAsset(5, { ...BASE_ASSET, contacts: [{ name: "Phone Only", phones: [{ number: "555" }] }] });

        expect(postedBody().contacts).toEqual([{ name: "Phone Only", email: null, phones: [{ number: "555" }] }]);
      });

      it("requires email or phones", async () => {
        await expect(endpoints.createAsset(5, { ...BASE_ASSET, contacts: [{ name: "Nobody", email: null }] })).rejects.toMatchObject({
          code: "INVALID_ARGUMENT",
          message: "contacts[0].email or contacts[0].phones is required."
        });
        expectNothingSent();
      });

      it("requires name (Docs/1201 §3)", async () => {
        await expect(endpoints.createAsset(5, {
          ...BASE_ASSET,
          contacts: [{ name: "A", email: "a@example.com" }, { email: "b@example.com" } as any]
        })).rejects.toMatchObject({ code: "INVALID_ARGUMENT", message: "contacts[1].name is required, as a non-empty string." });
        expectNothingSent();
      });

      it("reports a malformed phone by its position instead of crashing", async () => {
        await expect(endpoints.createAsset(5, {
          ...BASE_ASSET,
          contacts: [{ name: "A", phones: [{ type: "mobile" } as any] }]
        })).rejects.toMatchObject({ code: "INVALID_ARGUMENT", message: expect.stringContaining("contacts[0].phones[0].number") });

        await expect(endpoints.createAsset(5, {
          ...BASE_ASSET,
          contacts: [{ name: "A", phones: [{ number: "1", type: "fax" }] }]
        })).rejects.toMatchObject({ code: "INVALID_ARGUMENT", message: expect.stringContaining("contacts[0].phones[0].type") });
        expectNothingSent();
      });

      it("refuses a phone id on a new contact instead of dropping it", async () => {
        await expect(endpoints.createAsset(5, {
          ...BASE_ASSET,
          contacts: [{ name: "A", phones: [{ number: "1", type: "work", id: 31 } as any] }]
        })).rejects.toMatchObject({
          code: "INVALID_ARGUMENT",
          message: expect.stringContaining("contacts[0].phones[0].id is not accepted here")
        });
        expectNothingSent();
      });

      it("rejects contacts that is not a list of objects", async () => {
        await expect(endpoints.createAsset(5, { ...BASE_ASSET, contacts: { name: "A" } as any })).rejects.toMatchObject({
          code: "INVALID_ARGUMENT",
          message: "Invalid contacts: expected a list of contacts."
        });
        await expect(endpoints.createAsset(5, { ...BASE_ASSET, contacts: ["a@example.com"] as any })).rejects.toMatchObject({
          code: "INVALID_ARGUMENT",
          message: "Invalid contacts[0]: expected a contact object."
        });
        expectNothingSent();
      });
    });

    it("posts the Docs/1201 §3 example payload to /assets/?asset_type=<id> on the wire", async () => {
      resetFetchMock();
      mockHappyFoxPost("/assets/", { id: 13 });

      await new AssetEndpoints(new HappyFoxClient(AUTH)).createAsset(2, {
        ...DOC_CREATE_PAYLOAD,
        contacts: [{ name: "John", email: "john@example.com" }]
      });

      const request = lastHappyFoxRequest();
      expect(request.method).toBe("POST");
      expect(request.apiPath).toBe("/assets/");
      expect(Object.fromEntries(request.query)).toEqual({ asset_type: "2" });
      expect(request.json()).toEqual({
        ...DOC_CREATE_PAYLOAD,
        contact_ids: [1],
        contact_group_ids: [1],
        contacts: [{ name: "John", email: "john@example.com" }]
      });
    });
  });

  describe("updateAsset", () => {
    it("sends the changes and updated_by with PUT", async () => {
      await endpoints.updateAsset(123, { name: "Updated Name", updated_by: 7 });

      expect(mockClient.put).toHaveBeenCalledWith("/asset/123/", { name: "Updated Name", updated_by: 7 });
    });

    it("sends only the fields given", async () => {
      await endpoints.updateAsset(123, { display_id: "NEW-ID", updated_by: 7 });

      expect(putBody()).toEqual({ display_id: "NEW-ID", updated_by: 7 });
    });

    it("sends every documented update field (Docs/1201 §4)", async () => {
      await endpoints.updateAsset(123, {
        name: "Updated",
        display_id: "NEW-ID",
        contact_ids: [5, 6],
        contact_group_ids: [1],
        contacts: [{ name: "Contact", email: "c@example.com" }],
        custom_fields: { "45": "GCJ1353", "56": 12 },
        updated_by: "7"
      });

      expect(putBody()).toEqual({
        name: "Updated",
        display_id: "NEW-ID",
        contact_ids: [5, 6],
        contact_group_ids: [1],
        contacts: [{ name: "Contact", email: "c@example.com" }],
        custom_fields: { "45": "GCJ1353", "56": 12 },
        updated_by: 7
      });
    });

    it("sends an empty link list as given", async () => {
      await endpoints.updateAsset(123, { contact_group_ids: [], updated_by: 7 });

      expect(putBody()).toEqual({ contact_group_ids: [], updated_by: 7 });
    });

    it("types phones of new contacts, so a phone without a type is sent without one", async () => {
      await endpoints.updateAsset(123, { contacts: [{ name: "A", phones: [{ number: "555" }] }], updated_by: 7 });

      expect(putBody().contacts).toEqual([{ name: "A", email: null, phones: [{ number: "555" }] }]);
    });

    it("requires a field to change besides updated_by", async () => {
      for (const changes of [{ updated_by: 7 }, { custom_fields: {}, contacts: [], updated_by: 7 }]) {
        await expect(endpoints.updateAsset(123, changes)).rejects.toMatchObject({
          code: "INVALID_ARGUMENT",
          message: expect.stringContaining("Give at least one field to change")
        });
      }
      expectNothingSent();
    });

    it("requires the acting agent in updated_by", async () => {
      await expect(endpoints.updateAsset(123, { name: "N" } as any)).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        message: expect.stringContaining("updated_by is required")
      });
      expectNothingSent();
    });

    it("keeps the 200-character name limit and rejects an empty name or display id", async () => {
      await expect(endpoints.updateAsset(123, { name: "x".repeat(201), updated_by: 7 })).rejects.toMatchObject({
        message: "name has 201 characters; HappyFox allows at most 200."
      });
      await expect(endpoints.updateAsset(123, { name: "", updated_by: 7 })).rejects.toMatchObject({
        message: "Invalid name: expected a non-empty string."
      });
      await expect(endpoints.updateAsset(123, { display_id: 5 as any, updated_by: 7 })).rejects.toMatchObject({
        message: "Invalid display_id: expected a non-empty string."
      });
      expectNothingSent();
    });

    it("rejects prefixed custom field keys", async () => {
      await expect(endpoints.updateAsset(123, { custom_fields: { "a-cf-1": "x" }, updated_by: 7 })).rejects.toMatchObject({
        code: "INVALID_ARGUMENT"
      });
      expectNothingSent();
    });

    it("puts the Docs/1201 §4 example request to /asset/<id>/ on the wire", async () => {
      resetFetchMock();
      mockHappyFoxPut("/asset/2/", { id: 2 });

      await new AssetEndpoints(new HappyFoxClient(AUTH)).updateAsset(2, {
        name: "Macbook pro 2019 15' inch Retina",
        updated_by: 1,
        contact_ids: [2],
        contact_group_ids: [1]
      });

      const request = lastHappyFoxRequest();
      expect(request.method).toBe("PUT");
      expect(request.apiPath).toBe("/asset/2/");
      expect(request.query.toString()).toBe("");
      expect(request.json()).toEqual({
        name: "Macbook pro 2019 15' inch Retina",
        updated_by: 1,
        contact_ids: [2],
        contact_group_ids: [1]
      });
    });
  });

  describe("deleteAsset", () => {
    it("sends deleted_by as a query parameter (Docs/1201 §5)", async () => {
      await endpoints.deleteAsset(123, 5);

      expect(mockClient.delete).toHaveBeenCalledWith("/asset/123/", { deleted_by: 5 });
    });

    it("sends a deleted_by given as a digit string as a number", async () => {
      await endpoints.deleteAsset("456", "10");

      expect(mockClient.delete).toHaveBeenCalledWith("/asset/456/", { deleted_by: 10 });
    });

    it("requires deleted_by", async () => {
      await expect(endpoints.deleteAsset(123, undefined as any)).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        message: expect.stringContaining("deleted_by is required")
      });
      await expect(endpoints.deleteAsset(123, "5&deleted_by=1")).rejects.toMatchObject({ code: "INVALID_ID" });
      expectNothingSent();
    });

    it("sends DELETE /asset/<id>/?deleted_by=<staff id> with no body on the wire", async () => {
      resetFetchMock();
      mockHappyFoxDelete("/asset/123/", {});

      await new AssetEndpoints(new HappyFoxClient(AUTH)).deleteAsset(123, 5);

      const request = lastHappyFoxRequest();
      expect(request.method).toBe("DELETE");
      expect(request.apiPath).toBe("/asset/123/");
      expect(request.query.toString()).toBe("deleted_by=5");
      expect(request.body).toBeUndefined();
    });
  });

  describe("listAssetCustomFields", () => {
    it("fetches one page of an asset type's custom fields, 50 per page by default", async () => {
      (mockClient.get as any).mockResolvedValue(CUSTOM_FIELD_PAGE);

      await expect(endpoints.listAssetCustomFields({ asset_type_id: 5 })).resolves.toEqual(CUSTOM_FIELD_PAGE);

      expect(mockClient.get).toHaveBeenCalledWith("/asset_custom_fields/", { page: 1, size: 50, asset_type: 5 });
    });

    it("passes page and size, capping size at 50 (Docs/1201 §6)", async () => {
      await endpoints.listAssetCustomFields({ asset_type_id: "5", page: 2, size: 80 });

      expect(mockClient.get).toHaveBeenCalledWith("/asset_custom_fields/", { page: 2, size: 50, asset_type: 5 });
    });

    it("never sends an absent asset_type", async () => {
      await endpoints.listAssetCustomFields({});

      expect(mockClient.get).toHaveBeenCalledWith("/asset_custom_fields/", { page: 1, size: 50 });
    });

    it("sends asset_type, size and page as query parameters on the wire", async () => {
      resetFetchMock();
      mockHappyFoxGet("/asset_custom_fields/", CUSTOM_FIELD_PAGE);

      await new AssetEndpoints(new HappyFoxClient(AUTH)).listAssetCustomFields({ asset_type_id: 1, page: 2, size: 10 });

      const request = lastHappyFoxRequest();
      expect(request.method).toBe("GET");
      expect(request.apiPath).toBe("/asset_custom_fields/");
      expect(Object.fromEntries(request.query)).toEqual({ page: "2", size: "10", asset_type: "1" });
    });
  });

  describe("getAssetCustomField", () => {
    it("fetches custom field by ID from the singular path (Docs/1201 §7)", async () => {
      await endpoints.getAssetCustomField(1);

      expect(mockClient.get).toHaveBeenCalledWith("/asset_custom_field/1/");
    });
  });

  describe("getAssetType", () => {
    it("fetches one asset type from /asset_type/<id>/ (Docs/1201 §9)", async () => {
      await endpoints.getAssetType("2");

      expect(mockClient.get).toHaveBeenCalledWith("/asset_type/2/");
    });
  });

  describe("id validation", () => {
    const calls: Array<[string, string, (id: any) => Promise<unknown>]> = [
      ["getAsset", "asset_id", id => endpoints.getAsset(id)],
      ["updateAsset", "asset_id", id => endpoints.updateAsset(id, { custom_fields: { choices: [] }, updated_by: 7 })],
      ["deleteAsset", "asset_id", id => endpoints.deleteAsset(id, 7)],
      ["getAssetCustomField", "custom_field_id", id => endpoints.getAssetCustomField(id)],
      ["getAssetType", "asset_type_id", id => endpoints.getAssetType(id)]
    ];

    it.each(calls)("%s rejects injected and malformed ids before any request", async (_name, param, call) => {
      for (const id of [...INJECTION_IDS, ...MALFORMED_IDS]) {
        await expect(call(id)).rejects.toMatchObject({
          statusCode: 400,
          code: "INVALID_ID",
          message: expect.stringContaining(param)
        });
      }
      expectNothingSent();
    });

    it("accepts an asset id given as a digit string", async () => {
      await endpoints.getAsset("123");
      expect(mockClient.get).toHaveBeenCalledWith("/asset/123/");
    });
  });
});

describe("asset tool schemas", () => {
  const tools = new Map(new AssetTools().getTools().map(tool => [tool.name, tool]));
  const schema = (name: string) => tools.get(name)!.inputSchema;
  const description = (name: string) => tools.get(name)!.description;

  it("requires asset_type_id, name and display_id on create (Docs/1201 §3)", () => {
    expect(schema("happyfox_create_asset").required).toEqual(["asset_type_id", "name", "display_id"]);
    expect(schema("happyfox_update_asset").required).toEqual(["asset_id"]);
  });

  it("caps name at 200 characters", () => {
    for (const name of ["happyfox_create_asset", "happyfox_update_asset"]) {
      expect(schema(name).properties.name.maxLength, name).toBe(200);
    }
  });

  it("offers contact_ids and contact_group_ids on create and update (Docs/1201 §3-4)", () => {
    for (const name of ["happyfox_create_asset", "happyfox_update_asset"]) {
      expect(schema(name).properties.contact_group_ids.items.pattern, name).toBe("^[0-9]+$");
      expect(schema(name).properties.contact_group_ids.description, name).toContain("happyfox://contact-groups");
      expect(schema(name).properties.contact_ids.items.pattern, name).toBe("^[0-9]+$");
    }
    expect(schema("happyfox_update_asset").properties.contact_ids.description).toContain("happyfox_get_asset");
  });

  it("keys custom fields by bare id and states the asset value rules", () => {
    for (const name of ["happyfox_create_asset", "happyfox_update_asset"]) {
      const customFields = schema(name).properties.custom_fields;
      expect(customFields.propertyNames.pattern, name).toBe("^[1-9][0-9]*$");
      expect(customFields.description, name).not.toContain("a-cf-");
      for (const rule of ["happyfox_list_asset_custom_fields", "an integer (no decimals)", "list of option ids", "YYYY-MM-DD"]) {
        expect(customFields.description, name).toContain(rule);
      }
    }
  });

  it("takes option ids only from the choices lists (Docs/1201 §2, §6-7)", () => {
    const update = schema("happyfox_update_asset").properties.custom_fields.description;
    expect(update).toContain("Option ids come only from `choices`");
    expect(update).not.toMatch(/option ids come from [^.]*happyfox_get_asset\b/i);
  });

  it("gives new contacts the same typed shape on create and update", () => {
    const create = schema("happyfox_create_asset").properties.contacts;
    const update = schema("happyfox_update_asset").properties.contacts;
    expect(update.items).toEqual(create.items);
    expect(create.items.required).toEqual(["name"]);
    expect(create.items.properties.email.type).toEqual(["string", "null"]);
    expect(create.items.properties.phones.items.required).toEqual(["number"]);
    expect(create.items.properties.phones.items.properties.type.enum).toEqual(["mobile", "work", "main", "home", "other"]);
  });

  it("names the Manage all Contacts permission for new contacts (Docs/1201 §3-4)", () => {
    expect(schema("happyfox_create_asset").properties.contacts.description).toContain("Manage all Contacts");
    expect(schema("happyfox_create_asset").properties.contacts.description).toContain("created_by");
    expect(schema("happyfox_update_asset").properties.contacts.description).toContain("updated_by");
  });

  it("names the active agent and Manage Assets requirement on delete (Docs/1201 §5)", () => {
    expect(description("happyfox_delete_asset")).toContain("active agent");
    expect(description("happyfox_delete_asset")).toContain("Manage Assets");
  });

  it("injects the acting agent where Docs/1201 expects it", () => {
    expect(TOOLS_REQUIRING_STAFF_ID.happyfox_create_asset).toBe("created_by");
    expect(TOOLS_REQUIRING_STAFF_ID.happyfox_update_asset).toBe("updated_by");
    expect(TOOLS_REQUIRING_STAFF_ID.happyfox_delete_asset).toBe("deleted_by");
    for (const [name, param] of [
      ["happyfox_create_asset", "created_by"],
      ["happyfox_update_asset", "updated_by"],
      ["happyfox_delete_asset", "deleted_by"]
    ]) {
      expect(schema(name).properties[param].description, name).toContain("Defaults to the agent who authorized");
      expect(schema(name).properties[param].description, name).toContain("role permissions");
    }
  });

  it("pages asset custom fields with a documented default size (Docs/1201 §6)", () => {
    const list = schema("happyfox_list_asset_custom_fields").properties;
    expect(list.page.minimum).toBe(1);
    expect(list.size.maximum).toBe(50);
    expect(list.size.description).toContain("default 50");
  });

  it("identifies assets by the numeric id, not the display id", () => {
    for (const name of ["happyfox_get_asset", "happyfox_update_asset", "happyfox_delete_asset"]) {
      expect(schema(name).properties.asset_id.pattern, name).toBe("^[0-9]+$");
      expect(schema(name).properties.asset_id.description, name).toContain("Not its display_id");
    }
  });

  it("offers get_asset_type under happyfox:read", () => {
    expect(schema("happyfox_get_asset_type").required).toEqual(["asset_type_id"]);
    expect(TOOL_SCOPE_MAP.happyfox_get_asset_type).toEqual(["happyfox:read"]);
  });

  it("gives every asset tool a scope", () => {
    for (const name of tools.keys()) expect(TOOL_SCOPE_MAP[name], name).toBeDefined();
  });

  it("offers no attachment parameters", () => {
    const names = (s: any): string[] => Object.entries(s?.properties ?? {})
      .flatMap(([name, property]: [string, any]) => [name, ...names(property), ...names(property.items)]);
    for (const tool of tools.values()) {
      expect(names(tool.inputSchema).filter(name => /attachment/i.test(name)), tool.name).toEqual([]);
    }
  });
});

describe("asset tools through the registry", () => {
  const context: AuthContext = { credentials: AUTH, staffId: 7, scopes: ["happyfox:read", "happyfox:write", "happyfox:admin"] };
  const registry = new ToolRegistry();

  beforeEach(() => {
    resetFetchMock();
  });

  afterEach(() => {
    fetchMock.deactivate();
  });

  it("fills created_by in the create body with the consenting agent", async () => {
    mockHappyFoxPost("/assets/", { id: 13 });

    await registry.callToolWithAuth(
      "happyfox_create_asset", { asset_type_id: 1, name: "Laptop", display_id: "LT-1" }, context
    );

    const request = lastHappyFoxRequest();
    expect(request.query.toString()).toBe("asset_type=1");
    expect(request.json()).toEqual({ name: "Laptop", display_id: "LT-1", created_by: 7 });
  });

  it("fills updated_by in the update body", async () => {
    mockHappyFoxPut("/asset/9/", { id: 9 });

    await registry.callToolWithAuth("happyfox_update_asset", { asset_id: "9", display_id: "LT-9" }, context);

    expect(lastHappyFoxRequest().json()).toEqual({ display_id: "LT-9", updated_by: 7 });
  });

  it("fills deleted_by in the delete query and keeps an explicitly named agent", async () => {
    mockHappyFoxDelete("/asset/9/", {});
    mockHappyFoxDelete("/asset/9/", {});

    await registry.callToolWithAuth("happyfox_delete_asset", { asset_id: 9 }, context);
    expect(lastHappyFoxRequest().query.toString()).toBe("deleted_by=7");

    await registry.callToolWithAuth("happyfox_delete_asset", { asset_id: 9, deleted_by: 3 }, context);
    expect(lastHappyFoxRequest().query.toString()).toBe("deleted_by=3");
  });

  it("reads one asset type", async () => {
    mockHappyFoxGet("/asset_type/1/", { id: 1, name: "General", description: null, settings: {} });

    await expect(registry.callToolWithAuth("happyfox_get_asset_type", { asset_type_id: 1 }, context))
      .resolves.toMatchObject({ id: 1, name: "General" });
    expect(lastHappyFoxRequest().apiPath).toBe("/asset_type/1/");
  });
});
