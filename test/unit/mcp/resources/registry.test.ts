import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ResourceRegistry } from '../../../../src/mcp/resources/registry';
import { ResourceNotFoundError, HappyFoxAuth, SERVER_INSTRUCTIONS } from '../../../../src/types';
import {
  resetFetchMock,
  mockHappyFoxGet,
  mockHappyFoxRaw,
  mockRateLimitResponse,
  sentHappyFoxRequests,
  lastHappyFoxRequest,
} from '../../../helpers/fetch-mock-helpers';
import { referenceCache } from '../../../../src/cache/reference-cache';

/** Every resource and the GET path Docs/ give for it. */
const ARRAY_RESOURCES: Array<[string, string]> = [
  ['happyfox://categories', '/categories/'],
  ['happyfox://statuses', '/statuses/'],
  ['happyfox://priorities', '/priorities/'],
  ['happyfox://ticket-custom-fields', '/ticket_custom_fields/'],
  ['happyfox://contact-custom-fields', '/user_custom_fields/'],
  ['happyfox://staff', '/staff/'],
  ['happyfox://contact-groups', '/contact_groups/'],
];

/** The knowledge base exports and the GET path Docs/360 §6 gives each. */
const KB_RESOURCES: Array<[string, string]> = [
  ['happyfox://kb-articles', '/kb/articles/'],
  ['happyfox://kb-internal-articles', '/kb/internal-articles/'],
  ['happyfox://kb-sections', '/kb/sections/'],
];

/** One page of GET /reports/ in the envelope Docs/1088 §1 documents. */
function reportPage(rows: Array<{ id: number }>, page_count: number) {
  return { last_index: rows.length, rows, page_count, start_index: 1, end_index: rows.length };
}

/** One page of GET /asset_types/ in the envelope Docs/1201 §8 documents. */
function assetTypePage(data: unknown[], page_count: number) {
  return {
    page_info: { count: data.length, page_count, last_index: data.length, start_index: 1, end_index: data.length },
    data,
  };
}

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
    // The Cache API is shared across tests in this file; drop what a prior test cached.
    for (const resource of await registry.listResources()) {
      const key = resource.uri.replace('happyfox://', '');
      await referenceCache.invalidate(testAuth, key);
      await referenceCache.invalidate({ ...testAuth, region: 'eu' }, key);
    }
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('initializes all 12 resources', async () => {
      const resources = await registry.listResources();
      expect(resources).toHaveLength(12);
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
      expect(uris).toContain('happyfox://priorities');
      expect(uris).toContain('happyfox://reports');
      expect(uris).toContain('happyfox://kb-articles');
      expect(uris).toContain('happyfox://kb-internal-articles');
      expect(uris).toContain('happyfox://kb-sections');
    });

    it('gives every resource a cache key the reference cache accepts', async () => {
      for (const resource of await registry.listResources()) {
        expect(resource.uri).toMatch(/^happyfox:\/\/[a-z0-9-]+$/);
      }
    });

    it('points the knowledge base exports at the single-item tools', async () => {
      const resources = await registry.listResources();
      const description = (uri: string) => resources.find(r => r.uri === uri)!.description;

      expect(description('happyfox://kb-articles')).toContain('happyfox_get_kb_article');
      expect(description('happyfox://kb-sections')).toContain('happyfox_get_kb_section');
      expect(description('happyfox://reports')).toContain('happyfox_get_report_');
    });

    it('says in every description how old the data can be', async () => {
      for (const resource of await registry.listResources()) {
        expect(resource.description).toMatch(/up to 15 minutes old|at most 1 minute/);
      }
    });

    it('warns that ticket custom field choices can change at any time', async () => {
      const resources = await registry.listResources();
      const fields = resources.find(r => r.uri === 'happyfox://ticket-custom-fields')!;

      expect(fields.description).toContain('at most 1 minute');
      expect(fields.description).toContain('re-read it before sending choice ids');
    });

    it('describes contact custom fields in their own documented shape and both key prefixes', async () => {
      const resources = await registry.listResources();
      const fields = resources.find(r => r.uri === 'happyfox://contact-custom-fields')!.description!;

      // Docs/1092 §13: `order`, and no categories or compulsory_on_* flags.
      expect(fields).toContain('order');
      expect(fields).not.toMatch(/categories|compulsory_on|shaped like/);
      expect(fields).toContain('c-cf-<id> for contacts and ticket creation');
      expect(fields).toContain('ccf-<id> for staff replies, private notes and property updates');
    });

    it('points contact groups at the live single-group tool', async () => {
      const resources = await registry.listResources();
      const groups = resources.find(r => r.uri === 'happyfox://contact-groups')!;

      expect(groups.description).toContain('happyfox_get_contact_group');
    });

    it('is named in full by the server/discover instructions', async () => {
      for (const resource of await registry.listResources()) {
        expect(SERVER_INSTRUCTIONS).toContain(resource.uri);
      }
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
        // Docs/360 §1
        const mockData = [
          { prepopulate_cc: 'AR', description: '', time_spent_mandatory: true, public: true, id: 3, name: 'Arturia' },
          { prepopulate_cc: 'AR', description: '', time_spent_mandatory: true, public: true, id: 4, name: 'Company Employees' },
        ];
        mockHappyFoxGet('/categories/', mockData);

        const { content: result } = await registry.readResource('happyfox://categories', testAuth);

        expect(result.uri).toBe('happyfox://categories');
        expect(result.mimeType).toBe('application/json');
        expect(JSON.parse(result.text)).toEqual(mockData);
      });
    });

    describe('statuses resource', () => {
      it('fetches statuses from API', async () => {
        // Docs/360 §3
        const mockData = [
          { name: 'On hold', color: '120D58', order: 1, default: false, behavior: 'pending', id: 6 },
          { name: 'Closed', color: '99CC00', order: 2, default: false, behavior: 'completed', id: 4 },
        ];
        mockHappyFoxGet('/statuses/', mockData);

        const { content: result } = await registry.readResource('happyfox://statuses', testAuth);

        expect(result.uri).toBe('happyfox://statuses');
        expect(JSON.parse(result.text)).toEqual(mockData);
      });
    });

    describe('ticket-custom-fields resource', () => {
      it('fetches ticket custom fields from API', async () => {
        // Docs/360 §4
        const mockData = [{
          name: 'Request Survey',
          depends_on_choice: null,
          required: false,
          compulsory_on_completed: true,
          choices: [{ text: 'No', id: 2, dependant_fields: [] }, { text: 'Yes', id: 1, dependant_fields: [] }],
          compulsory_on_move: false,
          type: 'choice',
          id: 61,
          categories: [{ category: 3, order: 1 }, { category: 4, order: 2 }],
          visible_to_staff_only: false,
        }];
        mockHappyFoxGet('/ticket_custom_fields/', mockData);

        const { content: result } = await registry.readResource('happyfox://ticket-custom-fields', testAuth);

        expect(result.uri).toBe('happyfox://ticket-custom-fields');
        expect(JSON.parse(result.text)).toEqual(mockData);
      });
    });

    describe('contact-custom-fields resource', () => {
      it('fetches contact custom fields from API', async () => {
        // Docs/1092 §13
        const mockData = [
          { name: 'Account Number', depends_on_choice: null, required: true, id: 4, choices: null, type: 'text', order: 1, visible_to_staff_only: false },
          {
            name: 'Region ID', depends_on_choice: null, required: false, id: 5,
            choices: [{ text: 'APAC', id: 3, dependant_fields: [] }, { text: 'Europe', id: 2, dependant_fields: [] }],
            type: 'choice', order: 2, visible_to_staff_only: false,
          },
        ];
        mockHappyFoxGet('/user_custom_fields/', mockData);

        const { content: result } = await registry.readResource('happyfox://contact-custom-fields', testAuth);

        expect(result.uri).toBe('happyfox://contact-custom-fields');
        expect(JSON.parse(result.text)).toEqual(mockData);
      });
    });

    describe('staff resource', () => {
      it('fetches staff from API', async () => {
        // Docs/360 §2, with the permissions list shortened
        const mockData = [{
          name: 'George - Admin',
          is_account_admin: false,
          email: 'george@happyfox-test.com',
          role: { name: 'Administrator', id: 1 },
          active: true,
          id: 14,
          categories: [3, 4],
          permissions: ['edit_subject', 'move_tickets', 'manage_assets'],
        }];
        mockHappyFoxGet('/staff/', mockData);

        const { content: result } = await registry.readResource('happyfox://staff', testAuth);

        expect(result.uri).toBe('happyfox://staff');
        expect(JSON.parse(result.text)).toEqual(mockData);
      });
    });

    describe('contact-groups resource', () => {
      it('fetches contact groups from API', async () => {
        // Docs/1092 §8
        const mockData = [
          { tagged_domains: 'example.com', id: 1, name: 'test group', description: 'example description' },
          { tagged_domains: '', id: 2, name: 'test1 group', description: '' },
        ];
        mockHappyFoxGet('/contact_groups/', mockData);

        const { content: result } = await registry.readResource('happyfox://contact-groups', testAuth);

        expect(result.uri).toBe('happyfox://contact-groups');
        expect(JSON.parse(result.text)).toEqual(mockData);
      });
    });

    describe('priorities resource', () => {
      it('fetches GET /priorities/ with no query', async () => {
        const mockData = [
          { default: true, id: 5, name: 'No Priority', order: 1 },
          { default: false, id: 3, name: 'High', order: 3 },
        ];
        mockHappyFoxGet('/priorities/', mockData);

        const { content: result } = await registry.readResource('happyfox://priorities', testAuth);

        expect(result.uri).toBe('happyfox://priorities');
        expect(JSON.parse(result.text)).toEqual(mockData);
        const sent = lastHappyFoxRequest();
        expect(sent.method).toBe('GET');
        expect(sent.apiPath).toBe('/priorities/');
        expect(sent.url.search).toBe('');
      });
    });

    describe('asset-types resource', () => {
      it('returns the data of a single-page envelope as one array', async () => {
        const types = [{ id: 1, name: 'General' }, { id: 2, name: 'Device' }];
        mockHappyFoxGet('/asset_types/', assetTypePage(types, 1));

        const { content: result } = await registry.readResource('happyfox://asset-types', testAuth);

        expect(result.uri).toBe('happyfox://asset-types');
        expect(JSON.parse(result.text)).toEqual(types);
        expect(sentHappyFoxRequests()).toHaveLength(1);
        expect(sentHappyFoxRequests()[0].url.search).toBe('');
      });

      it('fetches every page and merges them in order', async () => {
        mockHappyFoxGet('/asset_types/', assetTypePage([{ id: 1 }, { id: 2 }], 3));
        mockHappyFoxGet('/asset_types/?page=2', assetTypePage([{ id: 3 }, { id: 4 }], 3));
        mockHappyFoxGet('/asset_types/?page=3', assetTypePage([{ id: 5 }], 3));

        const { content } = await registry.readResource('happyfox://asset-types', testAuth);

        expect(JSON.parse(content.text)).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }]);
        expect(sentHappyFoxRequests().map(r => [r.method, r.apiPath, r.url.search])).toEqual([
          ['GET', '/asset_types/', ''],
          ['GET', '/asset_types/', '?page=2'],
          ['GET', '/asset_types/', '?page=3'],
        ]);
      });

      it('caches the merged list, not the first page', async () => {
        mockHappyFoxGet('/asset_types/', assetTypePage([{ id: 1 }], 2));
        mockHappyFoxGet('/asset_types/?page=2', assetTypePage([{ id: 2 }], 2));

        await registry.readResource('happyfox://asset-types', testAuth);

        expect((await referenceCache.get(testAuth, 'asset-types'))?.data).toEqual([{ id: 1 }, { id: 2 }]);
      });

      it('rejects and does not cache a body without the page_info envelope', async () => {
        mockHappyFoxGet('/asset_types/', [{ id: 1, name: 'General' }]);

        await expect(registry.readResource('happyfox://asset-types', testAuth))
          .rejects.toMatchObject({ name: 'HappyFoxAPIError', code: 'INVALID_RESPONSE' });
        expect(await referenceCache.get(testAuth, 'asset-types')).toBeNull();
      });

      it('rejects and does not cache when a later page is malformed', async () => {
        mockHappyFoxGet('/asset_types/', assetTypePage([{ id: 1 }], 2));
        mockHappyFoxGet('/asset_types/?page=2', { page_info: {} });

        await expect(registry.readResource('happyfox://asset-types', testAuth))
          .rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
        expect(await referenceCache.get(testAuth, 'asset-types')).toBeNull();
      });

      it('refuses, rather than duplicates, a later page that repeats the first', async () => {
        mockHappyFoxGet('/asset_types/', assetTypePage([{ id: 1 }, { id: 2 }], 2));
        mockHappyFoxGet('/asset_types/?page=2', assetTypePage([{ id: 1 }, { id: 2 }], 2));

        await expect(registry.readResource('happyfox://asset-types', testAuth)).rejects.toMatchObject({
          name: 'HappyFoxAPIError',
          code: 'INVALID_RESPONSE',
          message: expect.stringContaining('page 2 of GET /asset_types/ with asset types already listed')
        });
        expect(await referenceCache.get(testAuth, 'asset-types')).toBeNull();
      });

      it('refuses an implausible page count instead of truncating', async () => {
        mockHappyFoxGet('/asset_types/', assetTypePage([{ id: 1 }], 51));

        await expect(registry.readResource('happyfox://asset-types', testAuth))
          .rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
        expect(sentHappyFoxRequests()).toHaveLength(1);
      });
    });

    describe('reports resource (Docs/1088 §1)', () => {
      it('returns the rows of a single page as one array', async () => {
        const rows = [
          { description: '', name: 'Test report', id: 7 },
          { description: 'All tickets that are created in the last week', name: 'Tickets created in last one week', id: 3 },
        ];
        mockHappyFoxGet('/reports/', { last_index: 7, rows, page_count: 1, start_index: 1, end_index: 7 });

        const { content, ttlMs } = await registry.readResource('happyfox://reports', testAuth);

        expect(JSON.parse(content.text)).toEqual(rows);
        expect(ttlMs).toBe(900_000);
        expect(sentHappyFoxRequests().map(r => [r.method, r.apiPath, r.url.search])).toEqual([['GET', '/reports/', '']]);
      });

      it('fetches every page and merges them in order', async () => {
        mockHappyFoxGet('/reports/', reportPage([{ id: 1 }, { id: 2 }], 2));
        mockHappyFoxGet('/reports/?page=2', reportPage([{ id: 3 }], 2));

        const { content } = await registry.readResource('happyfox://reports', testAuth);

        expect(JSON.parse(content.text)).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
        expect(sentHappyFoxRequests().map(r => r.url.search)).toEqual(['', '?page=2']);
        expect((await referenceCache.get(testAuth, 'reports'))?.data).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
      });

      it('refuses, rather than duplicates, a later page that repeats the first', async () => {
        mockHappyFoxGet('/reports/', reportPage([{ id: 1 }, { id: 2 }], 2));
        mockHappyFoxGet('/reports/?page=2', reportPage([{ id: 1 }, { id: 2 }], 2));

        await expect(registry.readResource('happyfox://reports', testAuth))
          .rejects.toMatchObject({ name: 'HappyFoxAPIError', code: 'INVALID_RESPONSE' });
        expect(await referenceCache.get(testAuth, 'reports')).toBeNull();
      });

      it('rejects and does not cache a body without rows', async () => {
        mockHappyFoxGet('/reports/', [{ id: 1 }]);

        await expect(registry.readResource('happyfox://reports', testAuth))
          .rejects.toMatchObject({ code: 'INVALID_RESPONSE', statusCode: 200 });
        expect(await referenceCache.get(testAuth, 'reports')).toBeNull();
      });

      it('refuses an implausible page count instead of truncating', async () => {
        mockHappyFoxGet('/reports/', reportPage([{ id: 1 }], 51));

        await expect(registry.readResource('happyfox://reports', testAuth))
          .rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
        expect(sentHappyFoxRequests()).toHaveLength(1);
      });
    });

    describe('knowledge base resources (Docs/360 §6)', () => {
      it.each(KB_RESOURCES)('%s sends GET %s with no query and returns the export as sent', async (uri, path) => {
        const body = { articles: [{ id: 5, title: 'Reset a password' }] };
        mockHappyFoxGet(path, body);

        const { content, ttlMs } = await registry.readResource(uri, testAuth);

        expect(JSON.parse(content.text)).toEqual(body);
        expect(ttlMs).toBe(900_000);
        const sent = lastHappyFoxRequest();
        expect([sent.method, sent.apiPath, sent.url.search]).toEqual(['GET', path, '']);
      });

      it.each(KB_RESOURCES)('%s accepts a JSON array as well', async (uri, path) => {
        mockHappyFoxGet(path, [{ id: 1 }]);

        const { content } = await registry.readResource(uri, testAuth);

        expect(JSON.parse(content.text)).toEqual([{ id: 1 }]);
      });

      it.each(KB_RESOURCES)('%s neither returns nor caches a bare JSON value', async (uri, path) => {
        mockHappyFoxGet(path, 'ok');

        await expect(registry.readResource(uri, testAuth))
          .rejects.toMatchObject({ code: 'INVALID_RESPONSE', statusCode: 200 });
        expect(await referenceCache.get(testAuth, uri.replace('happyfox://', ''))).toBeNull();
      });
    });

    describe('documented shape', () => {
      it.each(ARRAY_RESOURCES)('%s sends GET %s with no query', async (uri, path) => {
        mockHappyFoxGet(path, []);

        await registry.readResource(uri, testAuth);

        const sent = lastHappyFoxRequest();
        expect(sent.method).toBe('GET');
        expect(sent.apiPath).toBe(path);
        expect(sent.url.search).toBe('');
      });

      it.each(ARRAY_RESOURCES)('%s neither returns nor caches a JSON object where Docs/ show an array', async (uri, path) => {
        mockHappyFoxGet(path, { unexpected: true });

        await expect(registry.readResource(uri, testAuth))
          .rejects.toMatchObject({ name: 'HappyFoxAPIError', code: 'INVALID_RESPONSE', statusCode: 200 });
        expect(await referenceCache.get(testAuth, uri.replace('happyfox://', ''))).toBeNull();
      });

      it('neither returns nor caches an error response', async () => {
        mockHappyFoxGet('/statuses/', { error: 'Service Unavailable' }, 503);

        await expect(registry.readResource('happyfox://statuses', testAuth))
          .rejects.toMatchObject({ code: 'API_ERROR', statusCode: 503 });
        expect(await referenceCache.get(testAuth, 'statuses')).toBeNull();
      });

      it('neither returns nor caches an error-only 200', async () => {
        mockHappyFoxGet('/staff/', { error: 'Something went wrong' });

        await expect(registry.readResource('happyfox://staff', testAuth))
          .rejects.toMatchObject({ code: 'API_ERROR' });
        expect(await referenceCache.get(testAuth, 'staff')).toBeNull();
      });

      it('neither returns nor caches a rate-limit lockout', async () => {
        mockRateLimitResponse('/categories/', 'GET', 'us', { 'Retry-After': '600' });

        await expect(registry.readResource('happyfox://categories', testAuth))
          .rejects.toMatchObject({ code: 'RATE_LIMIT_EXCEEDED', statusCode: 429 });
        expect(await referenceCache.get(testAuth, 'categories')).toBeNull();
      });
    });

    describe('response format', () => {
      it('returns content with correct structure', async () => {
        const mockData = [{ id: 1, name: 'Test' }];
        mockHappyFoxGet('/categories/', mockData);

        const { content: result } = await registry.readResource('happyfox://categories', testAuth);

        expect(result).toHaveProperty('uri');
        expect(result).toHaveProperty('mimeType');
        expect(result).toHaveProperty('text');
      });

      it('returns JSON stringified with 2-space indentation', async () => {
        const mockData = [{ id: 1, name: 'Test' }];
        mockHappyFoxGet('/categories/', mockData);

        const { content: result } = await registry.readResource('happyfox://categories', testAuth);

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

        const { content: result } = await registry.readResource('happyfox://categories', euAuth);

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
        const cached = await referenceCache.get(testAuth, 'categories');
        expect(cached?.data).toEqual(mockData);
      });

      it('neither returns nor caches a non-JSON 200', async () => {
        mockHappyFoxRaw('GET', '/categories/', 200, '<!DOCTYPE html><title>Login</title>', { 'Content-Type': 'text/html' });

        await expect(registry.readResource('happyfox://categories', testAuth))
          .rejects.toMatchObject({ code: 'INVALID_RESPONSE', statusCode: 200 });
        expect(await referenceCache.get(testAuth, 'categories')).toBeNull();
      });

      it('uses cached data on subsequent requests', async () => {
        const mockData = [{ id: 1, name: 'Cached' }];

        // Pre-populate cache
        await referenceCache.set(testAuth, 'categories', mockData);

        // Request should use cache, not make API call
        const { content: result } = await registry.readResource('happyfox://categories', testAuth);

        expect(JSON.parse(result.text)).toEqual(mockData);
        expect(sentHappyFoxRequests()).toHaveLength(0);
      });

      it('reports the full 15-minute lifetime on a fresh fetch', async () => {
        mockHappyFoxGet('/categories/', []);

        const { ttlMs } = await registry.readResource('happyfox://categories', testAuth);

        expect(ttlMs).toBe(900_000);
      });

      it('reports only the remaining lifetime when served from cache', async () => {
        vi.useFakeTimers({ now: new Date('2026-09-01T00:00:00Z'), toFake: ['Date'] });
        mockHappyFoxGet('/statuses/', [{ id: 1 }]);
        await registry.readResource('happyfox://statuses', testAuth);

        vi.setSystemTime(new Date('2026-09-01T00:14:00Z'));
        const { ttlMs } = await registry.readResource('happyfox://statuses', testAuth);

        expect(ttlMs).toBe(60_000);
        expect(sentHappyFoxRequests()).toHaveLength(1);
      });

      it('caches ticket custom fields for 1 minute, then refetches', async () => {
        vi.useFakeTimers({ now: new Date('2026-09-01T00:00:00Z'), toFake: ['Date'] });
        mockHappyFoxGet('/ticket_custom_fields/', [{ id: 61, choices: [{ id: 11, text: 'Option 3' }] }]);

        const first = await registry.readResource('happyfox://ticket-custom-fields', testAuth);
        expect(first.ttlMs).toBe(60_000);

        vi.setSystemTime(new Date('2026-09-01T00:01:00Z'));
        mockHappyFoxGet('/ticket_custom_fields/', [{ id: 61, choices: [{ id: 13, text: 'Option 4' }] }]);
        const second = await registry.readResource('happyfox://ticket-custom-fields', testAuth);

        expect(JSON.parse(second.content.text)[0].choices[0].id).toBe(13);
        expect(sentHappyFoxRequests()).toHaveLength(2);
      });

      it('refetches after the entry is invalidated', async () => {
        mockHappyFoxGet('/contact_groups/', [{ id: 1, name: 'Old' }]);
        await registry.readResource('happyfox://contact-groups', testAuth);

        await referenceCache.invalidate(testAuth, 'contact-groups');
        mockHappyFoxGet('/contact_groups/', [{ id: 1, name: 'Old' }, { id: 2, name: 'VIP' }]);
        const { content } = await registry.readResource('happyfox://contact-groups', testAuth);

        expect(JSON.parse(content.text)).toHaveLength(2);
      });

      it('does not serve one API key\'s cached copy to another key', async () => {
        mockHappyFoxGet('/staff/', [{ id: 1 }]);
        await registry.readResource('happyfox://staff', testAuth);

        mockHappyFoxGet('/staff/', { error: 'Unauthorized' }, 401);
        await expect(registry.readResource('happyfox://staff', { ...testAuth, apiKey: 'disabled-key' }))
          .rejects.toMatchObject({ statusCode: 401 });
      });
    });
  });
});
