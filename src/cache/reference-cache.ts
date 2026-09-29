import { HappyFoxAuth } from '../types';
import { apiHostFor } from '../happyfox/host';

// Resource names are fixed identifiers such as "ticket-custom-fields", never caller input.
const RESOURCE_NAME = /^[a-z0-9-]+$/;

/** How long a reference entry is served, in seconds, unless its resource sets its own. */
export const REFERENCE_TTL_SECONDS = 900;

/** A cache hit and the milliseconds it has left before it expires. */
export interface CachedReference<T> {
  data: T;
  ttlMs: number;
}

/** The stored body: the data plus its absolute expiry, so a hit can report its remaining lifetime. */
interface StoredEntry {
  expiresAt: number;
  data: unknown;
}

function isStoredEntry(value: unknown): value is StoredEntry {
  return typeof value === 'object' && value !== null &&
    typeof (value as StoredEntry).expiresAt === 'number' && 'data' in value;
}

/** Hex SHA-256 of the API key and auth code, so an entry is only ever served to the key that filled it. */
async function credentialFingerprint(auth: HappyFoxAuth): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${auth.apiKey}:${auth.authCode}`));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * HappyFox reference data cached in the Cloudflare Cache API. Entries are keyed by the API host
 * the data came from and by the credentials that fetched it: no account's entry can be read or
 * written through another's key, and a disabled key stops being served on its next miss.
 * The Cache API is per data center, so a write or invalidation reaches only the local copy.
 */
export class ReferenceCache {
  private cache: Cache | null = null;
  private cacheName = 'happyfox-reference-cache';

  private async getCache(): Promise<Cache> {
    if (!this.cache) {
      this.cache = await caches.open(this.cacheName);
    }
    return this.cache;
  }

  /** @throws when the account is invalid or the resource name is not a plain identifier */
  private async getCacheUrl(auth: HappyFoxAuth, resource: string): Promise<URL> {
    if (!RESOURCE_NAME.test(resource)) {
      throw new Error(`Invalid reference cache resource: ${resource}`);
    }
    const host = apiHostFor(auth);
    return new URL(`https://cache.happyfox.local/${host}/${await credentialFingerprint(auth)}/${resource}`);
  }

  /** @returns the unexpired entry and its remaining lifetime, or null on a miss or any cache failure */
  async get<T>(auth: HappyFoxAuth, resource: string): Promise<CachedReference<T> | null> {
    try {
      const cache = await this.getCache();
      const response = await cache.match(await this.getCacheUrl(auth, resource));
      if (!response) {
        return null;
      }

      const entry: unknown = await response.json();
      if (!isStoredEntry(entry)) {
        return null;
      }
      const ttlMs = entry.expiresAt - Date.now();
      return ttlMs > 0 ? { data: entry.data as T, ttlMs } : null;
    } catch {
      return null;
    }
  }

  /** Store `data` for `ttlSeconds`. A failed write is logged and otherwise ignored. */
  async set<T>(auth: HappyFoxAuth, resource: string, data: T, ttlSeconds = REFERENCE_TTL_SECONDS): Promise<void> {
    try {
      const cache = await this.getCache();
      const url = await this.getCacheUrl(auth, resource);
      const entry: StoredEntry = { expiresAt: Date.now() + ttlSeconds * 1000, data };

      await cache.put(url, new Response(JSON.stringify(entry), {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': `max-age=${ttlSeconds}`
        }
      }));
    } catch {
      console.warn(`Failed to cache ${resource} for ${auth.accountName} (${auth.region})`);
    }
  }

  /**
   * Drop the entry for `resource` so the next read refetches it. Call after a write that
   * changes the resource. A failed delete is logged and otherwise ignored.
   */
  async invalidate(auth: HappyFoxAuth, resource: string): Promise<void> {
    try {
      const cache = await this.getCache();
      await cache.delete(await this.getCacheUrl(auth, resource));
    } catch {
      console.warn(`Failed to invalidate cached ${resource} for ${auth.accountName} (${auth.region})`);
    }
  }
}

export const referenceCache = new ReferenceCache();
