import { describe, it, expect, beforeEach } from 'vitest';
import { ResourceRegistry } from '../../../../src/mcp/resources/registry';
import { ResourceNotFoundError, HappyFoxAuth } from '../../../../src/types';
import { resetFetchMock, mockHappyFoxGet } from '../../../helpers/fetch-mock-helpers';
import { referenceCache } from '../../../../src/cache/reference-cache';

describe('ResourceRegistry', () => {
  let registry: ResourceRegistry;
  const testAuth: HappyFoxAuth = {
    apiKey: 'test-api-key',
    authCode: 'test-auth-code',
    accountName: 'testaccount',
    region: 'us',
  };

  beforeEach(async () => {
    resetFetchMock();
    registry = new ResourceRegistry();
    // Clear cache before each test
    await referenceCache.invalidateAll(testAuth.accountName, testAuth.region);
  });

  describe('constructor', () => {
    it('initializes all 7 resources', async () => {
      const resources = await registry.listResources();
      expect(resources).toHaveLength(7);
    });
  });

  describe('listResources', () => {
    it('returns array of all resources', async () => {
      const resources = await registry.listResources();
      expect(Array.isArray(resources)).toBe(true);
      expect(resources.length).toBeGreaterThan(0);
    });

    it('each resource has uri, name, and mimeType', async () => {
      const resources = await registry.listResources();
      for (const resource of resources) {
        expect(resource).toHaveProperty('uri');
        expect(resource).toHaveProperty('name');
        expect(resource).toHaveProperty('mimeType');
      }
    });

    it('includes expected resource URIs', async () => {
      const resources = await registry.listResources();
      const uris = resources.map(r => r.uri);

      expect(uris).toContain('happyfox://categories');
      expect(uris).toContain('happyfox://statuses');
      expect(uris).toContain('happyfox://ticket-custom-fields');
      expect(uris).toContain('happyfox://contact-custom-fields');
      expect(uris).toContain('happyfox://staff');
      expect(uris).toContain('happyfox://contact-groups');
      expect(uris).toContain('happyfox://asset-types');
    });

    it('all resources have application/json mimeType', async () => {
      const resources = await registry.listResources();
      for (const resource of resources) {
        expect(resource.mimeType).toBe('application/json');
      }
    });
  });

  describe('readResource', () => {
    describe('invalid URI', () => {
      it('throws ResourceNotFoundError for unknown URI', async () => {
        await expect(registry.readResource('happyfox://unknown', testAuth))
          .rejects.toThrow(ResourceNotFoundError);
      });

      it('throws ResourceNotFoundError for invalid URI format', async () => {
        await expect(registry.readResource('invalid-uri', testAuth))
          .rejects.toThrow(ResourceNotFoundError);
      });
    });

    describe('categories resource', () => {
      it('fetches categories from API', async () => {
        const mockData = [{ id: 1, name: 'Support' }, { id: 2, name: 'Sales' }];
        mockHappyFoxGet('/categories/', mockData);

        const result = await registry.readResource('happyfox://categories', testAuth);

        expect(result.uri).toBe('happyfox://categories');
        expect(result.mimeType).toBe('application/json');
        expect(JSON.parse(result.text)).toEqual(mockData);
      });
    });

    describe('statuses resource', () => {
      it('fetches statuses from API', async () => {
        const mockData = [{ id: 1, name: 'Open' }, { id: 2, name: 'Closed' }];
        mockHappyFoxGet('/statuses/', mockData);

        const result = await registry.readResource('happyfox://statuses', testAuth);

        expect(result.uri).toBe('happyfox://statuses');
        expect(JSON.parse(result.text)).toEqual(mockData);
      });
    });

    describe('ticket-custom-fields resource', () => {
      it('fetches ticket custom fields from API', async () => {
        const mockData = [{ id: 1, name: 'Priority Level' }];
        mockHappyFoxGet('/ticket_custom_fields/', mockData);

        const result = await registry.readResource('happyfox://ticket-custom-fields', testAuth);

        expect(result.uri).toBe('happyfox://ticket-custom-fields');
        expect(JSON.parse(result.text)).toEqual(mockData);
      });
    });

    describe('contact-custom-fields resource', () => {
      it('fetches contact custom fields from API', async () => {
        const mockData = [{ id: 1, name: 'Company Size' }];
        mockHappyFoxGet('/user_custom_fields/', mockData);

        const result = await registry.readResource('happyfox://contact-custom-fields', testAuth);

        expect(result.uri).toBe('happyfox://contact-custom-fields');
        expect(JSON.parse(result.text)).toEqual(mockData);
      });
    });

    describe('staff resource', () => {
      it('fetches staff from API', async () => {
        const mockData = [{ id: 1, name: 'John Doe', email: 'john@example.com' }];
        mockHappyFoxGet('/staff/', mockData);

        const result = await registry.readResource('happyfox://staff', testAuth);

        expect(result.uri).toBe('happyfox://staff');
        expect(JSON.parse(result.text)).toEqual(mockData);
      });
    });

    describe('contact-groups resource', () => {
      it('fetches contact groups from API', async () => {
        const mockData = [{ id: 1, name: 'VIP Customers' }];
        mockHappyFoxGet('/contact_groups/', mockData);

        const result = await registry.readResource('happyfox://contact-groups', testAuth);

        expect(result.uri).toBe('happyfox://contact-groups');
        expect(JSON.parse(result.text)).toEqual(mockData);
      });
    });

    describe('asset-types resource', () => {
      it('fetches asset types from API', async () => {
        const mockData = [{ id: 1, name: 'Laptop' }, { id: 2, name: 'Monitor' }];
        mockHappyFoxGet('/asset_types/', mockData);

        const result = await registry.readResource('happyfox://asset-types', testAuth);

        expect(result.uri).toBe('happyfox://asset-types');
        expect(JSON.parse(result.text)).toEqual(mockData);
      });
    });

    describe('response format', () => {
      it('returns content with correct structure', async () => {
        const mockData = [{ id: 1, name: 'Test' }];
        mockHappyFoxGet('/categories/', mockData);

        const result = await registry.readResource('happyfox://categories', testAuth);

        expect(result).toHaveProperty('uri');
        expect(result).toHaveProperty('mimeType');
        expect(result).toHaveProperty('text');
      });

      it('returns JSON stringified with 2-space indentation', async () => {
        const mockData = [{ id: 1, name: 'Test' }];
        mockHappyFoxGet('/categories/', mockData);

        const result = await registry.readResource('happyfox://categories', testAuth);

        expect(result.text).toBe(JSON.stringify(mockData, null, 2));
      });
    });

    describe('region handling', () => {
      it('handles EU region', async () => {
        const euAuth: HappyFoxAuth = {
          ...testAuth,
          region: 'eu',
        };
        const mockData = [{ id: 1, name: 'EU Category' }];
        mockHappyFoxGet('/categories/', mockData, 200, 'eu');

        // Clear EU cache
        await referenceCache.invalidateAll(euAuth.accountName, euAuth.region);

        const result = await registry.readResource('happyfox://categories', euAuth);

        expect(JSON.parse(result.text)).toEqual(mockData);
      });
    });

    describe('caching', () => {
      it('caches data after fetch', async () => {
        const mockData = [{ id: 1, name: 'Cached' }];
        mockHappyFoxGet('/categories/', mockData);

        // First request - fetches from API
        await registry.readResource('happyfox://categories', testAuth);

        // Data should now be in cache
        const cachedData = await referenceCache.get(testAuth.accountName, testAuth.region, 'categories');
        expect(cachedData).toEqual(mockData);
      });

      it('uses cached data on subsequent requests', async () => {
        const mockData = [{ id: 1, name: 'Cached' }];

        // Pre-populate cache
        await referenceCache.set(testAuth.accountName, testAuth.region, 'categories', mockData);

        // Request should use cache, not make API call
        const result = await registry.readResource('happyfox://categories', testAuth);

        expect(JSON.parse(result.text)).toEqual(mockData);
      });
    });
  });
});
