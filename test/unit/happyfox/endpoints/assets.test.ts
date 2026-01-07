import { describe, it, expect, beforeEach } from "vitest";
import { AssetEndpoints } from "../../../../src/happyfox/endpoints/assets";
import { createMockClient } from "../../../helpers/client-mock";

describe("AssetEndpoints", () => {
  let mockClient: ReturnType<typeof createMockClient>;
  let endpoints: AssetEndpoints;

  beforeEach(() => {
    mockClient = createMockClient();
    endpoints = new AssetEndpoints(mockClient as any);
  });

  describe("listAssets", () => {
    it("sets default pagination", async () => {
      (mockClient.get as any).mockResolvedValue({ data: [] });

      await endpoints.listAssets();

      expect(mockClient.get).toHaveBeenCalledWith("/assets/", {
        page: 1,
        size: 50
      });
    });

    it("caps size at 50", async () => {
      (mockClient.get as any).mockResolvedValue({ data: [] });

      await endpoints.listAssets({ size: 100 });

      expect(mockClient.get).toHaveBeenCalledWith("/assets/", expect.objectContaining({
        size: 50
      }));
    });

    it("allows size less than 50", async () => {
      (mockClient.get as any).mockResolvedValue({ data: [] });

      await endpoints.listAssets({ size: 10 });

      expect(mockClient.get).toHaveBeenCalledWith("/assets/", expect.objectContaining({
        size: 10
      }));
    });

    it("includes asset_type filter when provided", async () => {
      (mockClient.get as any).mockResolvedValue({ data: [] });

      await endpoints.listAssets({ asset_type: 5 });

      expect(mockClient.get).toHaveBeenCalledWith("/assets/", expect.objectContaining({
        asset_type: 5
      }));
    });

    it("omits asset_type when not provided", async () => {
      (mockClient.get as any).mockResolvedValue({ data: [] });

      await endpoints.listAssets({});

      const calledWith = (mockClient.get as any).mock.calls[0][1];
      expect(calledWith).not.toHaveProperty("asset_type");
    });

    it("includes pagination with asset_type", async () => {
      (mockClient.get as any).mockResolvedValue({ data: [] });

      await endpoints.listAssets({ page: 2, size: 25, asset_type: 3 });

      expect(mockClient.get).toHaveBeenCalledWith("/assets/", {
        page: 2,
        size: 25,
        asset_type: 3
      });
    });
  });

  describe("getAsset", () => {
    it("fetches asset by ID", async () => {
      (mockClient.get as any).mockResolvedValue({ id: 123 });

      await endpoints.getAsset(123);

      expect(mockClient.get).toHaveBeenCalledWith("/asset/123/");
    });
  });

  describe("createAsset", () => {
    it("passes asset_type as query parameter", async () => {
      (mockClient.post as any).mockResolvedValue({ id: 1 });

      await endpoints.createAsset(5, { name: "Test Asset" });

      expect(mockClient.post).toHaveBeenCalledWith(
        "/assets/",
        { name: "Test Asset" },
        { asset_type: 5 }
      );
    });

    it("includes display_id when provided", async () => {
      (mockClient.post as any).mockResolvedValue({ id: 1 });

      await endpoints.createAsset(5, {
        name: "Test Asset",
        display_id: "ASSET-001"
      });

      expect(mockClient.post).toHaveBeenCalledWith(
        "/assets/",
        { name: "Test Asset", display_id: "ASSET-001" },
        { asset_type: 5 }
      );
    });

    it("handles contact_ids array", async () => {
      (mockClient.post as any).mockResolvedValue({ id: 1 });

      await endpoints.createAsset(5, {
        name: "Test Asset",
        contact_ids: [10, 20, 30]
      });

      expect(mockClient.post).toHaveBeenCalledWith(
        "/assets/",
        { name: "Test Asset", contact_ids: [10, 20, 30] },
        { asset_type: 5 }
      );
    });

    it("handles contacts array (new contacts) with phone type mapping", async () => {
      (mockClient.post as any).mockResolvedValue({ id: 1 });

      await endpoints.createAsset(5, {
        name: "Test Asset",
        contacts: [
          { name: "Contact 1", email: "c1@example.com" },
          { name: "Contact 2", email: "c2@example.com", phones: [{ number: "555-1234", type: "mobile" }] }
        ]
      });

      expect(mockClient.post).toHaveBeenCalledWith(
        "/assets/",
        {
          name: "Test Asset",
          contacts: [
            { name: "Contact 1", email: "c1@example.com", phones: undefined },
            { name: "Contact 2", email: "c2@example.com", phones: [{ number: "555-1234", type: "mo", is_primary: true }] }
          ]
        },
        { asset_type: 5 }
      );
    });

    it("spreads custom_fields into formData", async () => {
      (mockClient.post as any).mockResolvedValue({ id: 1 });

      await endpoints.createAsset(5, {
        name: "Test Asset",
        custom_fields: {
          "a-cf-1": "value1",
          "a-cf-2": "value2"
        }
      });

      expect(mockClient.post).toHaveBeenCalledWith(
        "/assets/",
        {
          name: "Test Asset",
          "a-cf-1": "value1",
          "a-cf-2": "value2"
        },
        { asset_type: 5 }
      );
    });

    it("handles all fields together", async () => {
      (mockClient.post as any).mockResolvedValue({ id: 1 });

      await endpoints.createAsset(5, {
        name: "Full Asset",
        display_id: "ASSET-999",
        contact_ids: [1, 2],
        contacts: [{ name: "New", email: "new@example.com" }],
        custom_fields: { "a-cf-1": "test" }
      });

      expect(mockClient.post).toHaveBeenCalledWith(
        "/assets/",
        {
          name: "Full Asset",
          display_id: "ASSET-999",
          contact_ids: [1, 2],
          contacts: [{ name: "New", email: "new@example.com" }],
          "a-cf-1": "test"
        },
        { asset_type: 5 }
      );
    });
  });

  describe("updateAsset", () => {
    it("updates asset with PUT method", async () => {
      (mockClient.put as any).mockResolvedValue({ id: 123 });

      await endpoints.updateAsset(123, { name: "Updated Name" });

      expect(mockClient.put).toHaveBeenCalledWith("/asset/123/", {
        name: "Updated Name"
      });
    });

    it("only includes provided fields", async () => {
      (mockClient.put as any).mockResolvedValue({ id: 123 });

      await endpoints.updateAsset(123, { name: "New Name" });

      const calledWith = (mockClient.put as any).mock.calls[0][1];
      expect(calledWith).toEqual({ name: "New Name" });
      expect(calledWith).not.toHaveProperty("display_id");
    });

    it("handles all update fields", async () => {
      (mockClient.put as any).mockResolvedValue({ id: 123 });

      await endpoints.updateAsset(123, {
        name: "Updated",
        display_id: "NEW-ID",
        contact_ids: [5, 6],
        contacts: [{ name: "Contact", email: "c@example.com" }],
        custom_fields: { "a-cf-1": "updated" }
      });

      expect(mockClient.put).toHaveBeenCalledWith("/asset/123/", {
        name: "Updated",
        display_id: "NEW-ID",
        contact_ids: [5, 6],
        contacts: [{ name: "Contact", email: "c@example.com" }],
        "a-cf-1": "updated"
      });
    });

    it("spreads custom_fields into formData", async () => {
      (mockClient.put as any).mockResolvedValue({ id: 123 });

      await endpoints.updateAsset(123, {
        custom_fields: {
          "a-cf-1": "value1",
          "a-cf-2": "value2"
        }
      });

      const calledWith = (mockClient.put as any).mock.calls[0][1];
      expect(calledWith["a-cf-1"]).toBe("value1");
      expect(calledWith["a-cf-2"]).toBe("value2");
    });
  });

  describe("deleteAsset", () => {
    it("includes deleted_by as required parameter", async () => {
      (mockClient.delete as any).mockResolvedValue({});

      await endpoints.deleteAsset(123, 5);

      expect(mockClient.delete).toHaveBeenCalledWith("/asset/123/", {
        deleted_by: 5
      });
    });

    it("passes correct asset ID", async () => {
      (mockClient.delete as any).mockResolvedValue({});

      await endpoints.deleteAsset(456, 10);

      expect(mockClient.delete).toHaveBeenCalledWith("/asset/456/", {
        deleted_by: 10
      });
    });
  });

  describe("listAssetCustomFields", () => {
    it("fetches asset custom fields for a specific asset type", async () => {
      (mockClient.get as any).mockResolvedValue([]);

      await endpoints.listAssetCustomFields(5);

      expect(mockClient.get).toHaveBeenCalledWith("/asset_custom_fields/", { asset_type: 5 });
    });
  });

  describe("getAssetCustomField", () => {
    it("fetches custom field by ID", async () => {
      (mockClient.get as any).mockResolvedValue({ id: 1 });

      await endpoints.getAssetCustomField(1);

      expect(mockClient.get).toHaveBeenCalledWith("/asset_custom_fields/1/");
    });
  });
});
