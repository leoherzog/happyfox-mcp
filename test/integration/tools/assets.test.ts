import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { SELF, fetchMock } from "cloudflare:test";
import { toolCallRequest } from "../../helpers/json-rpc";
import { getSessionToken, createSessionAuthHeaders } from "../../fixtures/auth";
import { mockHappyFoxGet, mockHappyFoxPost, mockHappyFoxPut, mockHappyFoxDelete, resetFetchMock } from "../../helpers/fetch-mock-helpers";

describe("Asset Tools", () => {
  let sessionId: string;

  beforeAll(async () => {
    resetFetchMock();
    sessionId = await getSessionToken();
  });

  beforeEach(() => {
    resetFetchMock();
  });

  afterEach(() => {
    // Don't assert pending interceptors - some tests may fail before API is called
  });

  describe("happyfox_list_assets", () => {
    it("returns assets list", async () => {
      mockHappyFoxGet("/assets/", {
        data: [
          { id: 1, name: "Laptop 001", asset_type: { name: "Laptop" } },
          { id: 2, name: "Monitor 001", asset_type: { name: "Monitor" } }
        ],
        page_info: { count: 2, page: 1, pages: 1 }
      });

      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: createSessionAuthHeaders(sessionId),
        body: JSON.stringify(toolCallRequest("happyfox_list_assets", {}))
      });

      const body = await response.json() as Record<string, unknown>;
      const result = body.result as Record<string, unknown>;

      expect(result.isError).toBeUndefined();

      const content = result.content as Array<Record<string, unknown>>;
      const data = JSON.parse(content[0].text as string);
      expect(data.data).toHaveLength(2);
    });

    it("supports filtering by asset type", async () => {
      mockHappyFoxGet("/assets/", {
        data: [{ id: 1, name: "Laptop 001" }],
        page_info: { count: 1 }
      });

      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: createSessionAuthHeaders(sessionId),
        body: JSON.stringify(toolCallRequest("happyfox_list_assets", {
          asset_type: "1"
        }))
      });

      expect(response.status).toBe(200);
    });
  });

  describe("happyfox_get_asset", () => {
    it("returns asset details", async () => {
      mockHappyFoxGet("/asset/1/", {
        id: 1,
        name: "Laptop 001",
        asset_type: { id: 1, name: "Laptop" },
        serial_number: "SN123456",
        contact: { id: 10, name: "John Doe" }
      });

      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: createSessionAuthHeaders(sessionId),
        body: JSON.stringify(toolCallRequest("happyfox_get_asset", { asset_id: "1" }))
      });

      const body = await response.json() as Record<string, unknown>;
      const result = body.result as Record<string, unknown>;

      expect(result.isError).toBeUndefined();

      const content = result.content as Array<Record<string, unknown>>;
      const data = JSON.parse(content[0].text as string);
      expect(data.id).toBe(1);
      expect(data.name).toBe("Laptop 001");
    });
  });

  describe("happyfox_create_asset", () => {
    it("creates a new asset", async () => {
      mockHappyFoxPost("/assets/", {
        id: 100,
        name: "New Asset",
        asset_type: { id: 1, name: "Laptop" }
      });

      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: createSessionAuthHeaders(sessionId),
        body: JSON.stringify(toolCallRequest("happyfox_create_asset", {
          name: "New Asset",
          asset_type: "1"
        }))
      });

      const body = await response.json() as Record<string, unknown>;
      const result = body.result as Record<string, unknown>;

      expect(result.isError).toBeUndefined();
    });

    it("creates asset with contact", async () => {
      mockHappyFoxPost("/assets/", {
        id: 101,
        name: "Asset With Contact",
        contact: { id: 5, name: "Jane Doe" }
      });

      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: createSessionAuthHeaders(sessionId),
        body: JSON.stringify(toolCallRequest("happyfox_create_asset", {
          name: "Asset With Contact",
          asset_type: "1",
          contact_id: "5"
        }))
      });

      const body = await response.json() as Record<string, unknown>;
      const result = body.result as Record<string, unknown>;

      expect(result.isError).toBeUndefined();
    });
  });

  describe("happyfox_update_asset", () => {
    it("updates asset details", async () => {
      mockHappyFoxPut("/asset/1/", {
        id: 1,
        name: "Updated Asset Name"
      });

      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: createSessionAuthHeaders(sessionId),
        body: JSON.stringify(toolCallRequest("happyfox_update_asset", {
          asset_id: "1",
          name: "Updated Asset Name"
        }))
      });

      const body = await response.json() as Record<string, unknown>;
      const result = body.result as Record<string, unknown>;

      expect(result.isError).toBeUndefined();
    });
  });

  describe("happyfox_delete_asset", () => {
    it("deletes an asset", async () => {
      // API: DELETE /asset/<id>/?deleted_by=<staff_id>
      mockHappyFoxDelete("/asset/1/", { success: true });

      const response = await SELF.fetch("https://worker.test/", {
        method: "POST",
        headers: createSessionAuthHeaders(sessionId),
        body: JSON.stringify(toolCallRequest("happyfox_delete_asset", {
          asset_id: "1",
          staff_id: "1"
        }))
      });

      const body = await response.json() as Record<string, unknown>;
      const result = body.result as Record<string, unknown>;

      expect(result.isError).toBeUndefined();
    });
  });

});
