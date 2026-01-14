import { describe, it, expect, beforeEach, vi } from 'vitest';
import { validateAndResolveStaff } from '../../../../src/oauth/services/happyfox-validator';
import { HappyFoxAuth } from '../../../../src/types';
import { resetFetchMock, mockHappyFoxGet, mockNetworkError } from '../../../helpers/fetch-mock-helpers';
import { fetchMock } from 'cloudflare:test';

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
        { id: 1, name: 'John Doe', email: 'john@example.com', is_active: true },
        { id: 2, name: 'Jane Smith', email: 'jane@example.com', is_active: true },
      ];
      mockHappyFoxGet('/staff/', staffList);

      const result = await validateAndResolveStaff(testCredentials, 'john@example.com');

      expect(result.valid).toBe(true);
      expect(result.staffId).toBe(1);
      expect(result.staffName).toBe('John Doe');
    });

    it('matches email case-insensitively', async () => {
      const staffList = [
        { id: 1, name: 'John Doe', email: 'John@Example.COM', is_active: true },
      ];
      mockHappyFoxGet('/staff/', staffList);

      const result = await validateAndResolveStaff(testCredentials, 'john@example.com');

      expect(result.valid).toBe(true);
      expect(result.staffId).toBe(1);
    });

    it('trims whitespace from email', async () => {
      const staffList = [
        { id: 1, name: 'John Doe', email: 'john@example.com', is_active: true },
      ];
      mockHappyFoxGet('/staff/', staffList);

      const result = await validateAndResolveStaff(testCredentials, '  john@example.com  ');

      expect(result.valid).toBe(true);
      expect(result.staffId).toBe(1);
    });

    it('returns staffId and staffName', async () => {
      const staffList = [
        { id: 42, name: 'Alice Wonder', email: 'alice@example.com', is_active: true },
      ];
      mockHappyFoxGet('/staff/', staffList);

      const result = await validateAndResolveStaff(testCredentials, 'alice@example.com');

      expect(result).toEqual({
        valid: true,
        staffId: 42,
        staffName: 'Alice Wonder',
      });
    });

    it('handles undefined is_active as active', async () => {
      const staffList = [
        { id: 1, name: 'John Doe', email: 'john@example.com' }, // no is_active field
      ];
      mockHappyFoxGet('/staff/', staffList);

      const result = await validateAndResolveStaff(testCredentials, 'john@example.com');

      expect(result.valid).toBe(true);
      expect(result.staffId).toBe(1);
    });

    it('handles is_active: true', async () => {
      const staffList = [
        { id: 1, name: 'John Doe', email: 'john@example.com', is_active: true },
      ];
      mockHappyFoxGet('/staff/', staffList);

      const result = await validateAndResolveStaff(testCredentials, 'john@example.com');

      expect(result.valid).toBe(true);
    });
  });

  describe('validation failures', () => {
    it('returns error when staff member not found', async () => {
      const staffList = [
        { id: 1, name: 'John Doe', email: 'john@example.com', is_active: true },
      ];
      mockHappyFoxGet('/staff/', staffList);

      const result = await validateAndResolveStaff(testCredentials, 'unknown@example.com');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('No staff member found with email: unknown@example.com');
      expect(result.staffId).toBeUndefined();
    });

    it('returns error when staff member is inactive', async () => {
      const staffList = [
        { id: 1, name: 'John Doe', email: 'john@example.com', is_active: false },
      ];
      mockHappyFoxGet('/staff/', staffList);

      const result = await validateAndResolveStaff(testCredentials, 'john@example.com');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Staff member john@example.com is inactive');
    });

    it('returns error for non-array API response', async () => {
      mockHappyFoxGet('/staff/', { error: 'not an array' });

      const result = await validateAndResolveStaff(testCredentials, 'test@example.com');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Unexpected response from HappyFox API');
    });

    it('handles staff with null email', async () => {
      const staffList = [
        { id: 1, name: 'John Doe', email: null },
        { id: 2, name: 'Jane Smith', email: 'jane@example.com', is_active: true },
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
        { id: 1, name: 'John Doe', email: '', is_active: true },
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
      expect(result.error).toBe('Account not found. Check account subdomain.');
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
        { id: 1, name: 'John Doe', email: 'john@example.com', is_active: true },
        { id: 2, name: 'Jane Smith', email: 'jane@example.com', is_active: true },
        { id: 3, name: 'Bob Wilson', email: 'bob@example.com', is_active: true },
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
          is_active: true,
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
        { id: 1, name: 'EU User', email: 'eu@example.com', is_active: true },
      ];
      mockHappyFoxGet('/staff/', staffList, 200, 'eu');

      const result = await validateAndResolveStaff(euCredentials, 'eu@example.com');

      expect(result.valid).toBe(true);
      expect(result.staffId).toBe(1);
    });

  });
});
