/**
 * HappyFox Validator Service
 *
 * Validates HappyFox credentials and resolves the consenting agent from GET /staff/
 * (Docs/360 §2) during OAuth consent, and re-reads that agent when a grant is refreshed.
 */

import { HappyFoxClient, HappyFoxAPIError } from '../../happyfox/client';
import { HappyFoxAuth } from '../../types';
import { StaffValidationResult } from '../types';
import { getRequiredScopes } from './scope-enforcer';

/** One record of GET /staff/, limited to the fields read here. */
interface HappyFoxStaff {
  id: number;
  name: string;
  email?: string | null;
  active?: boolean;
  permissions?: unknown;
}

/** A role permission the docs require of the acting agent; any one of `anyOf` satisfies it. */
interface RoleRequirement {
  tool: string;
  action: string;
  permission: string;
  anyOf: string[];
}

const ROLE_REQUIREMENTS: RoleRequirement[] = [
  // Docs/1039 §16 shows the required permission only as an image, so either move permission counts.
  {
    tool: 'happyfox_move_ticket_category',
    action: 'Moving tickets to another category',
    permission: 'a permission to move tickets',
    anyOf: ['move_tickets', 'move_ticket_to_any_category'],
  },
  // Docs/1201 §5: "Only an active agent who has Manage Assets permission can delete an asset".
  {
    tool: 'happyfox_delete_asset',
    action: 'Deleting assets',
    permission: 'the Manage Assets permission',
    anyOf: ['manage_assets'],
  },
];

/**
 * The error a consent probe of a custom domain reports. The domain can be any public host and the
 * caller is unauthenticated, so its answer is summarised, never echoed.
 */
function customHostError(error: HappyFoxAPIError): string {
  if (error.code === 'NETWORK_ERROR') return 'The custom domain could not be reached.';
  return `The custom domain did not answer like a HappyFox account (HTTP ${error.statusCode}).`;
}

/**
 * Validate HappyFox credentials and resolve the staff member with this email, with one GET /staff/
 * and no transport retries. When emails repeat, an active record wins; an email held only by
 * inactive agents is rejected.
 *
 * @param credentials - HappyFox API credentials to validate
 * @param userEmail - Email address to look up in staff list
 * @returns Validation result with staff ID and role permissions if successful
 */
export async function validateAndResolveStaff(
  credentials: HappyFoxAuth,
  userEmail: string
): Promise<StaffValidationResult> {
  try {
    const client = new HappyFoxClient(credentials, { maxRetries: 0 });
    const staffList = await client.get<HappyFoxStaff[]>('/staff/');

    if (!Array.isArray(staffList)) {
      return {
        valid: false,
        error: 'Unexpected response from HappyFox API',
      };
    }

    // Find staff member by email (case-insensitive)
    const normalizedEmail = userEmail.toLowerCase().trim();
    const matches = staffList.filter(
      (staff) => typeof staff?.email === 'string' && staff.email.toLowerCase().trim() === normalizedEmail
    );

    if (matches.length === 0) {
      return {
        valid: false,
        error: `No staff member found with email: ${userEmail}`,
      };
    }

    const staffMember = matches.find((staff) => staff.active !== false);
    if (!staffMember) {
      return {
        valid: false,
        error: `Staff member ${matches[0].email} is inactive`,
      };
    }

    if (!Number.isSafeInteger(staffMember.id) || staffMember.id < 1) {
      return {
        valid: false,
        error: 'Unexpected response from HappyFox API',
      };
    }

    return {
      valid: true,
      staffId: staffMember.id,
      staffName: staffMember.name,
      ...(Array.isArray(staffMember.permissions) && {
        permissions: staffMember.permissions.filter((p): p is string => typeof p === 'string'),
      }),
    };
  } catch (error) {
    if (error instanceof HappyFoxAPIError) {
      // Handle specific error codes
      if (error.statusCode === 401) {
        return {
          valid: false,
          error: 'Invalid API Key or Auth Code',
        };
      }
      if (error.statusCode === 403) {
        return {
          valid: false,
          error: 'Access denied. Check API permissions.',
        };
      }
      if (error.statusCode === 404) {
        return {
          valid: false,
          error: 'Account not found. Check the account subdomain, region and custom domain.',
        };
      }
      if (credentials.apiHost !== undefined && error.code !== 'RATE_LIMIT_EXCEEDED') {
        return {
          valid: false,
          error: customHostError(error),
        };
      }

      return {
        valid: false,
        error: error.message,
      };
    }

    // Network or other errors
    console.error('HappyFox validation error:', error);
    return {
      valid: false,
      error: 'Unable to connect to HappyFox. Please try again.',
    };
  }
}

/**
 * Warnings for requested scopes that expose tools the agent's HappyFox role cannot use.
 * Advisory only: consent never fails on permissions.
 *
 * @param scopes - the scopes being granted
 * @param permissions - the agent's `permissions` from GET /staff/; undefined yields no warnings
 * @returns one sentence per unmet requirement
 */
export function permissionWarnings(scopes: readonly string[], permissions: readonly string[] | undefined): string[] {
  if (!permissions) return [];

  return ROLE_REQUIREMENTS
    .filter(req => (getRequiredScopes(req.tool) ?? []).some(scope => scopes.includes(scope)))
    .filter(req => !req.anyOf.some(permission => permissions.includes(permission)))
    .map(req => `${req.action} needs ${req.permission} on your HappyFox role, which it lacks, so those calls will fail when made as you.`);
}

/** Outcome of re-reading a consented agent. */
export type StaffStatus = 'active' | 'inactive' | 'missing' | 'rejected' | 'unknown';

/**
 * Re-read one agent's record by id, without transport retries.
 * @returns 'rejected' when HappyFox refuses the credentials (401 or 403), 'missing' when no record
 *   has this id, 'unknown' when HappyFox could not be reached or did not answer with a staff list
 */
export async function checkStaffStatus(credentials: HappyFoxAuth, staffId: number): Promise<StaffStatus> {
  let staffList: unknown;
  try {
    staffList = await new HappyFoxClient(credentials, { maxRetries: 0 }).get('/staff/');
  } catch (error) {
    if (error instanceof HappyFoxAPIError && (error.statusCode === 401 || error.statusCode === 403)) {
      return 'rejected';
    }
    return 'unknown';
  }

  if (!Array.isArray(staffList)) return 'unknown';
  const staff = (staffList as HappyFoxStaff[]).find(record => record?.id === staffId);
  if (!staff) return 'missing';
  return staff.active === false ? 'inactive' : 'active';
}
