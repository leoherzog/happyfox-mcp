import { describe, it, expect, beforeEach, vi } from "vitest";
import { ReferenceCache } from "../../../src/cache/reference-cache";

describe("ReferenceCache", () => {
  let cache: ReferenceCache;

  beforeEach(() => {
    cache = new ReferenceCache();
  });

  describe("get and set", () => {
    it("returns cached data when found", async () => {
      const data = { id: 1, name: "Test Category" };
      await cache.set("testaccount", "categories", data);

      const result = await cache.get<typeof data>("testaccount", "categories");
      expect(result).toEqual(data);
    });

    it("returns null on cache miss", async () => {
      const result = await cache.get("testaccount", "nonexistent");
      expect(result).toBeNull();
    });

    it("correctly serializes and deserializes JSON data", async () => {
      const complexData = {
        categories: [
          { id: 1, name: "Support", nested: { active: true } },
          { id: 2, name: "Sales", nested: { active: false } }
        ],
        total: 2,
        metadata: { timestamp: "2024-01-01" }
      };

      await cache.set("testaccount", "categories", complexData);

      const result = await cache.get<typeof complexData>("testaccount", "categories");
      expect(result).toEqual(complexData);
    });

    it("handles generic type parameter", async () => {
      interface Status {
        id: number;
        name: string;
        behavior: string;
      }

      const statuses: Status[] = [
        { id: 1, name: "Open", behavior: "pending" },
        { id: 2, name: "Closed", behavior: "resolved" }
      ];

      await cache.set("testaccount", "statuses", statuses);

      const result = await cache.get<Status[]>("testaccount", "statuses");
      expect(result).toEqual(statuses);
      expect(result?.[0].name).toBe("Open");
    });

    it("isolates data by account name", async () => {
      const data1 = { categories: ["Support"] };
      const data2 = { categories: ["Sales"] };

      await cache.set("account1", "categories", data1);
      await cache.set("account2", "categories", data2);

      const result1 = await cache.get("account1", "categories");
      const result2 = await cache.get("account2", "categories");

      expect(result1).toEqual(data1);
      expect(result2).toEqual(data2);
    });

    it("isolates data by resource type", async () => {
      const categories = { data: "categories" };
      const statuses = { data: "statuses" };

      await cache.set("testaccount", "categories", categories);
      await cache.set("testaccount", "statuses", statuses);

      const resultCategories = await cache.get("testaccount", "categories");
      const resultStatuses = await cache.get("testaccount", "statuses");

      expect(resultCategories).toEqual(categories);
      expect(resultStatuses).toEqual(statuses);
    });

    it("handles empty arrays", async () => {
      const emptyArray: any[] = [];
      await cache.set("testaccount", "empty-test", emptyArray);

      const result = await cache.get<any[]>("testaccount", "empty-test");
      expect(result).toEqual([]);
    });

    it("handles empty objects", async () => {
      const emptyObject = {};
      await cache.set("testaccount", "empty-test", emptyObject);

      const result = await cache.get<object>("testaccount", "empty-test");
      expect(result).toEqual({});
    });
  });

  describe("invalidate", () => {
    it("removes cached item", async () => {
      const data = { id: 1 };
      await cache.set("testaccount", "categories", data);

      // Verify it exists
      let result = await cache.get("testaccount", "categories");
      expect(result).toEqual(data);

      // Invalidate
      await cache.invalidate("testaccount", "categories");

      // Verify it's gone
      result = await cache.get("testaccount", "categories");
      expect(result).toBeNull();
    });

    it("handles invalidating non-existent key", async () => {
      // Should not throw
      await expect(cache.invalidate("testaccount", "nonexistent")).resolves.toBeUndefined();
    });

    it("only invalidates specific resource", async () => {
      await cache.set("testaccount", "categories", { id: 1 });
      await cache.set("testaccount", "statuses", { id: 2 });

      await cache.invalidate("testaccount", "categories");

      const categories = await cache.get("testaccount", "categories");
      const statuses = await cache.get("testaccount", "statuses");

      expect(categories).toBeNull();
      expect(statuses).toEqual({ id: 2 });
    });
  });

  describe("invalidateAll", () => {
    it("invalidates all known resource types", async () => {
      // Set up data for all resource types
      const resourceTypes = [
        "categories",
        "statuses",
        "ticket-custom-fields",
        "contact-custom-fields",
        "staff",
        "contact-groups",
        "asset-types"
      ];

      for (const resource of resourceTypes) {
        await cache.set("testaccount", resource, { type: resource });
      }

      // Verify they all exist
      for (const resource of resourceTypes) {
        const result = await cache.get("testaccount", resource);
        expect(result).toEqual({ type: resource });
      }

      // Invalidate all
      await cache.invalidateAll("testaccount");

      // Verify they're all gone
      for (const resource of resourceTypes) {
        const result = await cache.get("testaccount", resource);
        expect(result).toBeNull();
      }
    });

    it("only invalidates for specific account", async () => {
      await cache.set("account1", "categories", { account: 1 });
      await cache.set("account2", "categories", { account: 2 });

      await cache.invalidateAll("account1");

      const result1 = await cache.get("account1", "categories");
      const result2 = await cache.get("account2", "categories");

      expect(result1).toBeNull();
      expect(result2).toEqual({ account: 2 });
    });
  });

  describe("cache URL generation", () => {
    it("generates unique URLs for different accounts", async () => {
      // This is implicitly tested by the isolation tests above
      // But we can test that different accounts don't collide

      await cache.set("account-a", "categories", { data: "A" });
      await cache.set("account-b", "categories", { data: "B" });

      const resultA = await cache.get("account-a", "categories");
      const resultB = await cache.get("account-b", "categories");

      expect(resultA).not.toEqual(resultB);
    });

    it("generates unique URLs for different resources", async () => {
      await cache.set("testaccount", "resource-1", { data: 1 });
      await cache.set("testaccount", "resource-2", { data: 2 });

      const result1 = await cache.get("testaccount", "resource-1");
      const result2 = await cache.get("testaccount", "resource-2");

      expect(result1).not.toEqual(result2);
    });
  });

  describe("error handling", () => {
    it("returns null when cache.match throws an error", async () => {
      const errorCache = new ReferenceCache();

      // Mock getCache to return a cache that throws on match
      const mockCacheApi = {
        match: vi.fn().mockRejectedValue(new Error("Cache match failed")),
        put: vi.fn(),
        delete: vi.fn()
      };

      vi.spyOn(errorCache as any, "getCache").mockResolvedValue(mockCacheApi);

      const result = await errorCache.get("testaccount", "categories");

      expect(result).toBeNull();
    });

    it("continues gracefully when cache.put throws an error", async () => {
      const errorCache = new ReferenceCache();

      // Mock getCache to return a cache that throws on put
      const mockCacheApi = {
        match: vi.fn(),
        put: vi.fn().mockRejectedValue(new Error("Cache put failed")),
        delete: vi.fn()
      };

      vi.spyOn(errorCache as any, "getCache").mockResolvedValue(mockCacheApi);

      // Spy on console.warn
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      // Should not throw
      await expect(errorCache.set("testaccount", "categories", { data: "test" })).resolves.toBeUndefined();

      // Should have logged a warning
      expect(warnSpy).toHaveBeenCalledWith("Failed to cache categories for testaccount");

      warnSpy.mockRestore();
    });

    it("returns null when response.json() throws in get", async () => {
      const errorCache = new ReferenceCache();

      // Mock a response that throws on json()
      const mockResponse = {
        json: vi.fn().mockRejectedValue(new Error("Invalid JSON"))
      };

      const mockCacheApi = {
        match: vi.fn().mockResolvedValue(mockResponse),
        put: vi.fn(),
        delete: vi.fn()
      };

      vi.spyOn(errorCache as any, "getCache").mockResolvedValue(mockCacheApi);

      const result = await errorCache.get("testaccount", "categories");

      expect(result).toBeNull();
    });
  });
});
