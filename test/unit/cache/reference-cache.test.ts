import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ReferenceCache, REFERENCE_TTL_SECONDS } from "../../../src/cache/reference-cache";
import { HappyFoxAuth } from "../../../src/types";

function account(overrides: Partial<HappyFoxAuth> = {}): HappyFoxAuth {
  return { apiKey: "key", authCode: "code", accountName: "testaccount", region: "us", ...overrides };
}

/** Hex SHA-256 of "key:code", the credential segment of every key for account(). */
const KEY_CODE_SHA256 = "6379a519ca784e325b4ee706a530b7ea4f1d111fa854e0cf7824c1b7018eb69a";

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

describe("ReferenceCache", () => {
  let cache: ReferenceCache;
  const us = account();
  const eu = account({ region: "eu" });

  beforeEach(() => {
    cache = new ReferenceCache();
  });

  describe("get and set", () => {
    it("returns cached data when found", async () => {
      const data = { id: 1, name: "Test Category" };
      await cache.set(us, "categories", data);

      const result = await cache.get<typeof data>(us, "categories");
      expect(result?.data).toEqual(data);
    });

    it("returns null on cache miss", async () => {
      const result = await cache.get(us, "nonexistent");
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

      await cache.set(us, "categories", complexData);

      const result = await cache.get<typeof complexData>(us, "categories");
      expect(result?.data).toEqual(complexData);
    });

    it("handles generic type parameter", async () => {
      interface Status {
        id: number;
        name: string;
        behavior: string;
      }

      const statuses: Status[] = [
        { id: 7, name: "New", behavior: "pending" },
        { id: 4, name: "Closed", behavior: "completed" }
      ];

      await cache.set(us, "statuses", statuses);

      const result = await cache.get<Status[]>(us, "statuses");
      expect(result?.data).toEqual(statuses);
      expect(result?.data[0].name).toBe("New");
    });

    it("isolates data by account name", async () => {
      const data1 = { categories: ["Support"] };
      const data2 = { categories: ["Sales"] };

      await cache.set(account({ accountName: "account1" }), "categories", data1);
      await cache.set(account({ accountName: "account2" }), "categories", data2);

      expect((await cache.get(account({ accountName: "account1" }), "categories"))?.data).toEqual(data1);
      expect((await cache.get(account({ accountName: "account2" }), "categories"))?.data).toEqual(data2);
    });

    it("isolates data by resource type", async () => {
      const categories = { data: "categories" };
      const statuses = { data: "statuses" };

      await cache.set(us, "categories", categories);
      await cache.set(us, "statuses", statuses);

      expect((await cache.get(us, "categories"))?.data).toEqual(categories);
      expect((await cache.get(us, "statuses"))?.data).toEqual(statuses);
    });

    it("isolates data by region", async () => {
      const usData = { region: "us", categories: ["US Support"] };
      const euData = { region: "eu", categories: ["EU Support"] };

      await cache.set(us, "categories", usData);
      await cache.set(eu, "categories", euData);

      expect((await cache.get(us, "categories"))?.data).toEqual(usData);
      expect((await cache.get(eu, "categories"))?.data).toEqual(euData);
    });

    it("isolates a custom-domain account from its subdomain", async () => {
      const custom = account({ apiHost: "support.example.com" });
      await cache.set(us, "statuses", { host: "subdomain" });
      await cache.set(custom, "statuses", { host: "custom" });

      expect((await cache.get(us, "statuses"))?.data).toEqual({ host: "subdomain" });
      expect((await cache.get(custom, "statuses"))?.data).toEqual({ host: "custom" });
    });

    it("handles empty arrays", async () => {
      const emptyArray: any[] = [];
      await cache.set(us, "empty-test", emptyArray);

      const result = await cache.get<any[]>(us, "empty-test");
      expect(result?.data).toEqual([]);
    });

    it("handles empty objects", async () => {
      const emptyObject = {};
      await cache.set(us, "empty-test", emptyObject);

      const result = await cache.get<object>(us, "empty-test");
      expect(result?.data).toEqual({});
    });

    it("never serves an entry filled with one API key to another key on the same account", async () => {
      await cache.set(us, "staff", [{ id: 1 }]);

      expect(await cache.get(account({ apiKey: "disabled-key" }), "staff")).toBeNull();
      expect(await cache.get(account({ authCode: "other-code" }), "staff")).toBeNull();
      expect((await cache.get(us, "staff"))?.data).toEqual([{ id: 1 }]);
    });
  });

  describe("lifetime", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("reports the full lifetime on a fresh entry", async () => {
      vi.useFakeTimers({ now: new Date("2026-09-01T00:00:00Z"), toFake: ["Date"] });
      await cache.set(us, "lifetime-fresh", [1]);

      expect((await cache.get(us, "lifetime-fresh"))?.ttlMs).toBe(REFERENCE_TTL_SECONDS * 1000);
    });

    it("reports only what is left of the lifetime on a later hit", async () => {
      vi.useFakeTimers({ now: new Date("2026-09-01T00:00:00Z"), toFake: ["Date"] });
      await cache.set(us, "lifetime-aged", [1]);
      vi.setSystemTime(new Date("2026-09-01T00:10:00Z"));

      expect((await cache.get(us, "lifetime-aged"))?.ttlMs).toBe(5 * 60 * 1000);
    });

    it("honors a per-resource lifetime, in seconds", async () => {
      vi.useFakeTimers({ now: new Date("2026-09-01T00:00:00Z"), toFake: ["Date"] });
      await cache.set(us, "lifetime-short", [1], 60);

      expect((await cache.get(us, "lifetime-short"))?.ttlMs).toBe(60_000);
      vi.setSystemTime(new Date("2026-09-01T00:01:00Z"));
      expect(await cache.get(us, "lifetime-short")).toBeNull();
    });

    it("stores the lifetime as the entry's Cache-Control max-age", async () => {
      const keyed = new ReferenceCache();
      const put = vi.fn().mockResolvedValue(undefined);
      vi.spyOn(keyed as any, "getCache").mockResolvedValue({ match: vi.fn(), put, delete: vi.fn() });

      await keyed.set(us, "categories", [1], 60);

      expect((put.mock.calls[0][1] as Response).headers.get("Cache-Control")).toBe("max-age=60");
    });

    it("treats an entry without a recorded expiry as a miss", async () => {
      const raw = await caches.open("happyfox-reference-cache");
      const keyed = new ReferenceCache();
      const url = await (keyed as any).getCacheUrl(us, "legacy-entry");
      await raw.put(url, new Response(JSON.stringify([{ id: 1 }]), {
        headers: { "Content-Type": "application/json", "Cache-Control": "max-age=900" },
      }));

      expect(await keyed.get(us, "legacy-entry")).toBeNull();
    });
  });

  describe("invalidate", () => {
    it("drops the entry so the next read misses", async () => {
      await cache.set(us, "contact-groups", [{ id: 1, name: "Old" }]);

      await cache.invalidate(us, "contact-groups");

      expect(await cache.get(us, "contact-groups")).toBeNull();
    });

    it("leaves other resources and other accounts cached", async () => {
      await cache.set(us, "contact-groups", [{ id: 1 }]);
      await cache.set(us, "statuses", [{ id: 2 }]);
      await cache.set(eu, "contact-groups", [{ id: 3 }]);

      await cache.invalidate(us, "contact-groups");

      expect((await cache.get(us, "statuses"))?.data).toEqual([{ id: 2 }]);
      expect((await cache.get(eu, "contact-groups"))?.data).toEqual([{ id: 3 }]);
    });

    it("deletes exactly the key get and set use", async () => {
      const keyed = new ReferenceCache();
      const del = vi.fn().mockResolvedValue(true);
      vi.spyOn(keyed as any, "getCache").mockResolvedValue({ match: vi.fn(), put: vi.fn(), delete: del });

      await keyed.invalidate(us, "contact-groups");

      expect(String(del.mock.calls[0][0])).toBe(
        `https://cache.happyfox.local/testaccount.happyfox.com/${KEY_CODE_SHA256}/contact-groups`
      );
    });

    it("swallows a failed delete", async () => {
      const keyed = new ReferenceCache();
      vi.spyOn(keyed as any, "getCache").mockResolvedValue({
        match: vi.fn(), put: vi.fn(), delete: vi.fn().mockRejectedValue(new Error("boom")),
      });
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      await expect(keyed.invalidate(us, "contact-groups")).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledWith("Failed to invalidate cached contact-groups for testaccount (us)");
      warn.mockRestore();
    });

    it("touches no entry for an invalid account or resource name", async () => {
      const keyed = new ReferenceCache();
      const del = vi.fn().mockResolvedValue(true);
      vi.spyOn(keyed as any, "getCache").mockResolvedValue({ match: vi.fn(), put: vi.fn(), delete: del });
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      await keyed.invalidate(account({ region: "us/../eu" as any }), "staff");
      await keyed.invalidate(us, "../staff");

      expect(del).not.toHaveBeenCalled();
      warn.mockRestore();
    });
  });

  describe("cache key", () => {
    async function keysUsed(auth: HappyFoxAuth, resource: string): Promise<string[]> {
      const keyed = new ReferenceCache();
      const put = vi.fn().mockResolvedValue(undefined);
      const match = vi.fn().mockResolvedValue(undefined);
      vi.spyOn(keyed as any, "getCache").mockResolvedValue({ match, put, delete: vi.fn() });
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      await keyed.set(auth, resource, { any: "data" });
      await keyed.get(auth, resource);
      warn.mockRestore();
      return [...put.mock.calls, ...match.mock.calls].map(([url]) => String(url));
    }

    it("is the API host the client calls, then a SHA-256 of the credentials, then the resource", async () => {
      expect(KEY_CODE_SHA256).toBe(await sha256Hex("key:code"));
      expect(await keysUsed(us, "categories")).toEqual([
        `https://cache.happyfox.local/testaccount.happyfox.com/${KEY_CODE_SHA256}/categories`,
        `https://cache.happyfox.local/testaccount.happyfox.com/${KEY_CODE_SHA256}/categories`,
      ]);
      expect((await keysUsed(eu, "staff"))[0])
        .toBe(`https://cache.happyfox.local/testaccount.happyfox.net/${KEY_CODE_SHA256}/staff`);
      expect((await keysUsed(account({ apiHost: "support.example.com" }), "staff"))[0])
        .toBe(`https://cache.happyfox.local/support.example.com/${KEY_CODE_SHA256}/staff`);
      expect((await keysUsed(account({ apiKey: "other" }), "staff"))[0])
        .toBe(`https://cache.happyfox.local/testaccount.happyfox.com/${await sha256Hex("other:code")}/staff`);
    });

    it("never contains the API key or auth code", async () => {
      const secret = account({ apiKey: "secret-api-key", authCode: "secret-auth-code" });
      for (const url of await keysUsed(secret, "staff")) {
        expect(url).not.toContain("secret-api-key");
        expect(url).not.toContain("secret-auth-code");
      }
    });

    it.each([
      ["us/../eu", "acme"],
      ["../eu/victim/staff#", "attacker"],
      ["EU", "acme"],
      ["", "acme"],
    ])("touches no cache entry for region %j", async (region, accountName) => {
      expect(await keysUsed(account({ region: region as any, accountName }), "staff")).toEqual([]);
    });

    it.each(["../eu/victim", "acme/../victim", "acme#", "acme.happyfox.net"])(
      "touches no cache entry for account name %j",
      async (accountName) => {
        expect(await keysUsed(account({ accountName }), "staff")).toEqual([]);
      }
    );

    it.each(["../staff", "staff#", "Staff", "staff/x"])("touches no cache entry for resource %j", async (resource) => {
      expect(await keysUsed(us, resource)).toEqual([]);
    });

    it("never lets a crafted region read or overwrite another tenant's slot", async () => {
      const victim = account({ accountName: "victim", region: "eu" });
      await cache.set(victim, "staff", [{ id: 1, name: "Victim Agent" }]);

      const attacker = account({ accountName: "attacker", region: "../eu/victim/staff#" as any });
      expect(await cache.get(attacker, "categories")).toBeNull();
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      await cache.set(attacker, "categories", [{ id: 99, name: "Injected" }]);
      warn.mockRestore();

      const traversal = account({ accountName: "victim", region: "us/../eu" as any });
      expect(await cache.get(traversal, "staff")).toBeNull();
      expect((await cache.get(victim, "staff"))?.data).toEqual([{ id: 1, name: "Victim Agent" }]);
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

      const result = await errorCache.get(us, "categories");

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
      await expect(errorCache.set(us, "categories", { data: "test" })).resolves.toBeUndefined();

      // Should have logged a warning (with region in message)
      expect(warnSpy).toHaveBeenCalledWith("Failed to cache categories for testaccount (us)");

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

      const result = await errorCache.get(us, "categories");

      expect(result).toBeNull();
    });
  });
});
