import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  validateAndResolveStaff,
  permissionWarnings,
  checkStaffStatus,
} from '../../../../src/oauth/services/happyfox-validator';
import { HappyFoxAuth } from '../../../../src/types';
import {
  resetFetchMock,
  mockHappyFoxGet,
  mockHappyFoxRaw,
  mockNetworkError,
  lastHappyFoxRequest,
  sentHappyFoxRequests,
} from '../../../helpers/fetch-mock-helpers';
import { fetchMock } from '../../../helpers/fetch-mock';

/** A staff record shaped like the Docs/360 §2 example. */
function documentedStaff(overrides: Record<string, unknown> = {}) {
  return {
    name: 'George - Admin',
    is_account_admin: false,
    email: 'george@happyfox-test.com',
    role: { name: 'Administrator', id: 1 },
    active: true,
    id: 14,
    categories: [3, 4],
    permissions: ['edit_subject', 'move_tickets', 'manage_contacts', 'manage_assets', 'delete_tickets'],
    ...overrides,
  };
}

describe('validateAndResolveStaff', () => {
  const testCredentials: HappyFoxAuth = {
    apiKey: 'test-api-key',
    authCode: 'test-auth-code',
    accountName: 'testaccount',
    region: 'us',
  };

  beforeEach(() => {
    resetFetchMock();
  });

  describe('successful validation', () => {
    it('finds staff member by exact email match', async () => {
      const staffList = [
        { id: 1, name: 'John Doe', email: 'john@example.com', active: true },
        { id: 2, name: 'Jane Smith', email: 'jane@example.com', active: true },
      ];
      mockHappyFoxGet('/staff/', staffList);

      const result = await validateAndResolveStaff(testCredentials, 'john@example.com');

      expect(result.valid).toBe(true);
      expect(result.staffId).toBe(1);
      expect(result.staffName).toBe('John Doe');
    });

    it('matches email case-insensitively', async () => {
      const staffList = [
        { id: 1, name: 'John Doe', email: 'John@Example.COM', active: true },
      ];
      mockHappyFoxGet('/staff/', staffList);

      const result = await validateAndResolveStaff(testCredentials, 'john@example.com');

      expect(result.valid).toBe(true);
      expect(result.staffId).toBe(1);
    });

    it('trims whitespace from email', async () => {
      const staffList = [
        { id: 1, name: 'John Doe', email: 'john@example.com', active: true },
      ];
      mockHappyFoxGet('/staff/', staffList);

      const result = await validateAndResolveStaff(testCredentials, '  john@example.com  ');

      expect(result.valid).toBe(true);
      expect(result.staffId).toBe(1);
    });

    it('returns staffId and staffName', async () => {
      const staffList = [
        { id: 42, name: 'Alice Wonder', email: 'alice@example.com', active: true },
      ];
      mockHappyFoxGet('/staff/', staffList);

      const result = await validateAndResolveStaff(testCredentials, 'alice@example.com');

      expect(result).toEqual({
        valid: true,
        staffId: 42,
        staffName: 'Alice Wonder',
      });
    });

    it('treats a record without active as active', async () => {
      const staffList = [
        { id: 1, name: 'John Doe', email: 'john@example.com' },
      ];
      mockHappyFoxGet('/staff/', staffList);

      const result = await validateAndResolveStaff(testCredentials, 'john@example.com');

      expect(result.valid).toBe(true);
      expect(result.staffId).toBe(1);
    });

    it('handles active: true', async () => {
      const staffList = [
        { id: 1, name: 'John Doe', email: 'john@example.com', active: true },
      ];
      mockHappyFoxGet('/staff/', staffList);

      const result = await validateAndResolveStaff(testCredentials, 'john@example.com');

      expect(result.valid).toBe(true);
    });
  });

  describe('validation failures', () => {
    it('returns error when staff member not found', async () => {
      const staffList = [
        { id: 1, name: 'John Doe', email: 'john@example.com', active: true },
      ];
      mockHappyFoxGet('/staff/', staffList);

      const result = await validateAndResolveStaff(testCredentials, 'unknown@example.com');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('No staff member found with email: unknown@example.com');
      expect(result.staffId).toBeUndefined();
    });

    it('returns error when staff member is inactive (Docs/360 `active: false`)', async () => {
      const staffList = [
        { id: 1, name: 'John Doe', email: 'john@example.com', active: false },
      ];
      mockHappyFoxGet('/staff/', staffList);

      const result = await validateAndResolveStaff(testCredentials, 'john@example.com');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Staff member john@example.com is inactive');
    });

    it('returns error for non-array API response', async () => {
      mockHappyFoxGet('/staff/', { data: 'not an array' });

      const result = await validateAndResolveStaff(testCredentials, 'test@example.com');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Unexpected response from HappyFox API');
    });

    it('handles staff with null email', async () => {
      const staffList = [
        { id: 1, name: 'John Doe', email: null },
        { id: 2, name: 'Jane Smith', email: 'jane@example.com', active: true },
      ];
      mockHappyFoxGet('/staff/', staffList);

      const result = await validateAndResolveStaff(testCredentials, 'john@example.com');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('No staff member found');
    });

    it('handles staff with undefined email', async () => {
      const staffList = [
        { id: 1, name: 'John Doe' }, // email is undefined
      ];
      mockHappyFoxGet('/staff/', staffList);

      const result = await validateAndResolveStaff(testCredentials, 'john@example.com');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('No staff member found');
    });

    it('handles staff with empty string email', async () => {
      const staffList = [
        { id: 1, name: 'John Doe', email: '', active: true },
      ];
      mockHappyFoxGet('/staff/', staffList);

      const result = await validateAndResolveStaff(testCredentials, 'john@example.com');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('No staff member found');
    });
  });

  describe('API errors', () => {
    it('returns specific error for 401 Unauthorized', async () => {
      mockHappyFoxGet('/staff/', { error: 'Unauthorized' }, 401);

      const result = await validateAndResolveStaff(testCredentials, 'test@example.com');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid API Key or Auth Code');
    });

    it('returns specific error for 403 Forbidden', async () => {
      mockHappyFoxGet('/staff/', { error: 'Forbidden' }, 403);

      const result = await validateAndResolveStaff(testCredentials, 'test@example.com');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Access denied. Check API permissions.');
    });

    it('returns specific error for 404 Not Found', async () => {
      mockHappyFoxGet('/staff/', { error: 'Not Found' }, 404);

      const result = await validateAndResolveStaff(testCredentials, 'test@example.com');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Account not found. Check the account subdomain, region and custom domain.');
    });

    it('names the redirect target and the region instead of blaming the credentials', async () => {
      mockHappyFoxRaw('GET', '/staff/', 301, '', { Location: 'https://testaccount.happyfox.net/api/1.1/json/staff/' });

      const result = await validateAndResolveStaff(testCredentials, 'test@example.com');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('testaccount.happyfox.net');
      expect(result.error).toContain('region');
      expect(result.error).not.toContain('Invalid API Key');
    });

    it('returns error message for other API errors', async () => {
      mockHappyFoxGet('/staff/', { error: 'Server Error' }, 500);

      const result = await validateAndResolveStaff(testCredentials, 'test@example.com');

      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('returns error message for network failures', async () => {
      mockNetworkError('/staff/');

      const result = await validateAndResolveStaff(testCredentials, 'test@example.com');

      expect(result.valid).toBe(false);
      // Network errors are wrapped by HappyFoxClient as HappyFoxAPIError
      expect(result.error).toContain('Network error');
    });
  });

  describe('edge cases', () => {
    it('finds correct staff member among multiple', async () => {
      const staffList = [
        { id: 1, name: 'John Doe', email: 'john@example.com', active: true },
        { id: 2, name: 'Jane Smith', email: 'jane@example.com', active: true },
        { id: 3, name: 'Bob Wilson', email: 'bob@example.com', active: true },
      ];
      mockHappyFoxGet('/staff/', staffList);

      const result = await validateAndResolveStaff(testCredentials, 'jane@example.com');

      expect(result.valid).toBe(true);
      expect(result.staffId).toBe(2);
      expect(result.staffName).toBe('Jane Smith');
    });

    it('handles empty staff list', async () => {
      mockHappyFoxGet('/staff/', []);

      const result = await validateAndResolveStaff(testCredentials, 'test@example.com');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('No staff member found');
    });

    it('handles staff member with role', async () => {
      const staffList = [
        {
          id: 1,
          name: 'Admin User',
          email: 'admin@example.com',
          active: true,
          role: { id: 1, name: 'Administrator' },
        },
      ];
      mockHappyFoxGet('/staff/', staffList);

      const result = await validateAndResolveStaff(testCredentials, 'admin@example.com');

      expect(result.valid).toBe(true);
      expect(result.staffId).toBe(1);
    });

    it('handles EU region', async () => {
      const euCredentials: HappyFoxAuth = {
        ...testCredentials,
        region: 'eu',
      };
      const staffList = [
        { id: 1, name: 'EU User', email: 'eu@example.com', active: true },
      ];
      mockHappyFoxGet('/staff/', staffList, 200, 'eu');

      const result = await validateAndResolveStaff(euCredentials, 'eu@example.com');

      expect(result.valid).toBe(true);
      expect(result.staffId).toBe(1);
    });

  });
});

describe('validateAndResolveStaff - documented staff record', () => {
  const credentials: HappyFoxAuth = {
    apiKey: 'test-api-key',
    authCode: 'test-auth-code',
    accountName: 'testaccount',
    region: 'us',
  };

  beforeEach(() => {
    resetFetchMock();
  });

  it('sends GET /api/1.1/json/staff/ with no query to the account host', async () => {
    mockHappyFoxGet('/staff/', [documentedStaff()]);

    await validateAndResolveStaff(credentials, 'george@happyfox-test.com');

    const request = lastHappyFoxRequest();
    expect(request.method).toBe('GET');
    expect(request.url.origin).toBe('https://testaccount.happyfox.com');
    expect(request.apiPath).toBe('/staff/');
    expect(request.url.search).toBe('');
  });

  it('probes once, without retrying a transport failure', async () => {
    fetchMock.get('https://testaccount.happyfox.com')
      .intercept({ path: '/api/1.1/json/staff/', method: 'GET' })
      .replyWithError(new TypeError('fetch failed'));

    const result = await validateAndResolveStaff(credentials, 'george@happyfox-test.com');

    expect(result).toEqual({ valid: false, error: 'Request failed: fetch failed' });
    expect(sentHappyFoxRequests()).toHaveLength(1);
  });

  describe('on a custom domain', () => {
    const custom: HappyFoxAuth = { ...credentials, apiHost: 'support.example.com' };

    function reply(status: number, body: string, headers: Record<string, string> = {}) {
      fetchMock.get('https://support.example.com')
        .intercept({ path: '/api/1.1/json/staff/', method: 'GET' })
        .reply(status, body, { headers });
    }

    it.each([
      [500, JSON.stringify({ error: 'upstream secret' }), { 'Content-Type': 'application/json' }],
      [418, 'upstream secret', { 'Content-Type': 'text/plain' }],
      [301, '', { Location: 'https://upstream-secret.example.org/' }],
      [200, 'upstream secret', { 'Content-Type': 'text/plain' }],
    ])('summarises an HTTP %i answer without echoing it', async (status, body, headers) => {
      reply(status, body, headers);

      const result = await validateAndResolveStaff(custom, 'george@happyfox-test.com');

      expect(result).toEqual({
        valid: false,
        error: `The custom domain did not answer like a HappyFox account (HTTP ${status}).`,
      });
      expect(sentHappyFoxRequests()).toHaveLength(1);
    });

    it('says the domain could not be reached after one transport failure', async () => {
      fetchMock.get('https://support.example.com')
        .intercept({ path: '/api/1.1/json/staff/', method: 'GET' })
        .replyWithError(Object.assign(new Error('upstream secret'), { code: 'ECONNRESET' }));

      const result = await validateAndResolveStaff(custom, 'george@happyfox-test.com');

      expect(result).toEqual({ valid: false, error: 'The custom domain could not be reached.' });
      expect(sentHappyFoxRequests()).toHaveLength(1);
    });

    it('keeps the fixed credential message for a 401', async () => {
      reply(401, JSON.stringify({ error: 'upstream secret' }), { 'Content-Type': 'application/json' });

      const result = await validateAndResolveStaff(custom, 'george@happyfox-test.com');

      expect(result).toEqual({ valid: false, error: 'Invalid API Key or Auth Code' });
    });
  });

  it('sends the lookup to the custom domain when one is set', async () => {
    fetchMock.get('https://support.example.com')
      .intercept({ path: '/api/1.1/json/staff/', method: 'GET' })
      .reply(200, JSON.stringify([documentedStaff()]), { headers: { 'Content-Type': 'application/json' } });

    const result = await validateAndResolveStaff({ ...credentials, apiHost: 'support.example.com' }, 'george@happyfox-test.com');

    expect(result.valid).toBe(true);
    expect(lastHappyFoxRequest().url.origin).toBe('https://support.example.com');
  });

  it('returns the agent id, name and role permissions', async () => {
    mockHappyFoxGet('/staff/', [documentedStaff()]);

    const result = await validateAndResolveStaff(credentials, 'george@happyfox-test.com');

    expect(result).toEqual({
      valid: true,
      staffId: 14,
      staffName: 'George - Admin',
      permissions: ['edit_subject', 'move_tickets', 'manage_contacts', 'manage_assets', 'delete_tickets'],
    });
  });

  it('reads active, not an undocumented is_active', async () => {
    mockHappyFoxGet('/staff/', [documentedStaff({ active: false, is_active: true })]);

    const result = await validateAndResolveStaff(credentials, 'george@happyfox-test.com');

    expect(result.valid).toBe(false);
    expect(result.error).toBe('Staff member george@happyfox-test.com is inactive');
  });

  it('prefers the active record when an email repeats', async () => {
    mockHappyFoxGet('/staff/', [
      documentedStaff({ id: 3, name: 'Old George', active: false }),
      documentedStaff({ id: 14, name: 'George - Admin', active: true }),
    ]);

    const result = await validateAndResolveStaff(credentials, 'george@happyfox-test.com');

    expect(result.valid).toBe(true);
    expect(result.staffId).toBe(14);
    expect(result.staffName).toBe('George - Admin');
  });

  it('rejects an email held only by inactive agents', async () => {
    mockHappyFoxGet('/staff/', [
      documentedStaff({ id: 3, active: false }),
      documentedStaff({ id: 14, active: false }),
    ]);

    const result = await validateAndResolveStaff(credentials, 'george@happyfox-test.com');

    expect(result.valid).toBe(false);
    expect(result.error).toContain('inactive');
  });

  it('omits permissions when the record carries none', async () => {
    const { permissions: _omitted, ...withoutPermissions } = documentedStaff();
    mockHappyFoxGet('/staff/', [withoutPermissions]);

    const result = await validateAndResolveStaff(credentials, 'george@happyfox-test.com');

    expect(result.valid).toBe(true);
    expect(result).not.toHaveProperty('permissions');
  });

  it.each([0, -1, '14', 1.5, null])('rejects a matched record whose id is %j', async (id) => {
    mockHappyFoxGet('/staff/', [documentedStaff({ id })]);

    const result = await validateAndResolveStaff(credentials, 'george@happyfox-test.com');

    expect(result.valid).toBe(false);
    expect(result.error).toBe('Unexpected response from HappyFox API');
  });

  it('refuses an invalid region without calling HappyFox', async () => {
    const result = await validateAndResolveStaff(
      { ...credentials, region: 'us/../eu' as any },
      'george@happyfox-test.com'
    );

    expect(result.valid).toBe(false);
    expect(result.error).toContain('Invalid HappyFox account');
    expect(sentHappyFoxRequests()).toHaveLength(0);
  });
});

describe('permissionWarnings', () => {
  const none: string[] = [];

  it('warns about moving tickets and deleting assets under happyfox:admin', () => {
    const warnings = permissionWarnings(['happyfox:admin'], none);

    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('Moving tickets to another category');
    expect(warnings[1]).toContain('Manage Assets');
  });

  it('accepts either documented move permission', () => {
    expect(permissionWarnings(['happyfox:admin'], ['move_tickets', 'manage_assets'])).toEqual([]);
    expect(permissionWarnings(['happyfox:admin'], ['move_ticket_to_any_category', 'manage_assets'])).toEqual([]);
  });

  it('warns only about the permission the role lacks', () => {
    const warnings = permissionWarnings(['happyfox:admin'], ['move_tickets']);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Deleting assets');
  });

  it('says nothing for scopes that expose no permission-gated tool', () => {
    expect(permissionWarnings(['happyfox:read', 'happyfox:write'], none)).toEqual([]);
  });

  it('says nothing when HappyFox sent no permissions', () => {
    expect(permissionWarnings(['happyfox:admin'], undefined)).toEqual([]);
  });
});

describe('checkStaffStatus', () => {
  const credentials: HappyFoxAuth = {
    apiKey: 'test-api-key',
    authCode: 'test-auth-code',
    accountName: 'testaccount',
    region: 'us',
  };

  beforeEach(() => {
    resetFetchMock();
  });

  it('matches the agent by id with GET /staff/', async () => {
    mockHappyFoxGet('/staff/', [documentedStaff({ id: 3 }), documentedStaff({ id: 14, email: 'renamed@example.com' })]);

    expect(await checkStaffStatus(credentials, 14)).toBe('active');
    expect(lastHappyFoxRequest().method).toBe('GET');
    expect(lastHappyFoxRequest().apiPath).toBe('/staff/');
  });

  it('reports a deactivated agent', async () => {
    mockHappyFoxGet('/staff/', [documentedStaff({ active: false })]);
    expect(await checkStaffStatus(credentials, 14)).toBe('inactive');
  });

  it('reports a deleted agent', async () => {
    mockHappyFoxGet('/staff/', [documentedStaff({ id: 3 })]);
    expect(await checkStaffStatus(credentials, 14)).toBe('missing');
  });

  it.each([401, 403])('reports credentials HappyFox refuses with %i', async (status) => {
    mockHappyFoxGet('/staff/', { error: 'Unauthorized' }, status);
    expect(await checkStaffStatus(credentials, 14)).toBe('rejected');
  });

  it('reports unknown for a server error', async () => {
    mockHappyFoxGet('/staff/', { error: 'Server Error' }, 500);
    expect(await checkStaffStatus(credentials, 14)).toBe('unknown');
  });

  it('reports unknown for a non-list body', async () => {
    mockHappyFoxGet('/staff/', { staff: [] });
    expect(await checkStaffStatus(credentials, 14)).toBe('unknown');
  });

  it('reports unknown after one transport failure, without retrying', async () => {
    fetchMock.get('https://testaccount.happyfox.com')
      .intercept({ path: '/api/1.1/json/staff/', method: 'GET' })
      .replyWithError(new TypeError('fetch failed'));

    expect(await checkStaffStatus(credentials, 14)).toBe('unknown');
    expect(sentHappyFoxRequests()).toHaveLength(1);
  });
});
