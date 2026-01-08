/**
 * Reference data cache using Cloudflare Cache API
 * Caches frequently-accessed HappyFox reference data to reduce API calls
 */

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

  /**
   * Generate a cache URL for a given account, region, and resource
   * Region is included to prevent cross-pollution between US/EU data
   */
  private getCacheUrl(accountName: string, region: string, resource: string): URL {
    return new URL(`https://cache.happyfox.local/${region}/${accountName}/${resource}`);
  }

  /**
   * Get cached data for a resource
   */
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

  /**
   * Store data in cache
   */
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

  /**
   * Invalidate cached data for a resource
   */
  async invalidate(accountName: string, region: string, resource: string): Promise<void> {
    try {
      const cache = await this.getCache();
      const url = this.getCacheUrl(accountName, region, resource);
      await cache.delete(url);
    } catch {
      // Invalidation failure is non-fatal
    }
  }

  /**
   * Invalidate all cached data for an account in a specific region
   */
  async invalidateAll(accountName: string, region: string): Promise<void> {
    const resources = [
      'categories',
      'statuses',
      'ticket-custom-fields',
      'contact-custom-fields',
      'staff',
      'contact-groups',
      'asset-types'
    ];

    await Promise.all(
      resources.map(resource => this.invalidate(accountName, region, resource))
    );
  }
}

// Singleton instance for use across the application
export const referenceCache = new ReferenceCache();
