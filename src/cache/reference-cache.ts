/** HappyFox reference data cached in the Cloudflare Cache API. */
export class ReferenceCache {
  private cache: Cache | null = null;
  private cacheName = 'happyfox-reference-cache';
  private ttl = 900; // 15 minutes in seconds

  private async getCache(): Promise<Cache> {
    if (!this.cache) {
      this.cache = await caches.open(this.cacheName);
    }
    return this.cache;
  }

  /** Region is part of the key to prevent cross-pollution between US/EU data. */
  private getCacheUrl(accountName: string, region: string, resource: string): URL {
    return new URL(`https://cache.happyfox.local/${region}/${accountName}/${resource}`);
  }

  async get<T>(accountName: string, region: string, resource: string): Promise<T | null> {
    try {
      const cache = await this.getCache();
      const url = this.getCacheUrl(accountName, region, resource);
      const response = await cache.match(url);

      if (!response) {
        return null;
      }

      return await response.json() as T;
    } catch {
      // Cache miss or error - return null to trigger fresh fetch
      return null;
    }
  }

  async set<T>(accountName: string, region: string, resource: string, data: T): Promise<void> {
    try {
      const cache = await this.getCache();
      const url = this.getCacheUrl(accountName, region, resource);

      const response = new Response(JSON.stringify(data), {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': `max-age=${this.ttl}`
        }
      });

      await cache.put(url, response);
    } catch {
      // Cache write failure is non-fatal - just log and continue
      console.warn(`Failed to cache ${resource} for ${accountName} (${region})`);
    }
  }
}

export const referenceCache = new ReferenceCache();
