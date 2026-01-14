/**
 * HappyFox Validator Service
 *
 * Validates HappyFox credentials and resolves staff ID from email during OAuth consent.
 */

import { HappyFoxClient, HappyFoxAPIError } from '../../happyfox/client';
import { HappyFoxAuth } from '../../types';
import { StaffValidationResult } from '../types';

// Staff member structure from HappyFox API
interface HappyFoxStaff {
  id: number;
  name: string;
  email: string;
  role?: {
    id: number;
    name: string;
  };
  is_active?: boolean;
}

/**
 * Validate HappyFox credentials and resolve staff ID from email
 *
 * @param credentials - HappyFox API credentials to validate
 * @param userEmail - Email address to look up in staff list
 * @returns Validation result with staff ID if successful
 */
export async function validateAndResolveStaff(
  credentials: HappyFoxAuth,
  userEmail: string
): Promise<StaffValidationResult> {
  const client = new HappyFoxClient(credentials);

  try {
    // Fetch staff list to validate credentials and find user
    const staffList = await client.get<HappyFoxStaff[]>('/staff/');

    if (!Array.isArray(staffList)) {
      return {
        valid: false,
        error: 'Unexpected response from HappyFox API',
      };
    }

    // Find staff member by email (case-insensitive)
    const normalizedEmail = userEmail.toLowerCase().trim();
    const staffMember = staffList.find(
      (staff) => staff.email?.toLowerCase().trim() === normalizedEmail
    );

    if (!staffMember) {
      return {
        valid: false,
        error: `No staff member found with email: ${userEmail}`,
      };
    }

    // Check if staff member is active
    if (staffMember.is_active === false) {
      return {
        valid: false,
        error: `Staff member ${staffMember.email} is inactive`,
      };
    }

    return {
      valid: true,
      staffId: staffMember.id,
      staffName: staffMember.name,
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
          error: 'Account not found. Check account subdomain.',
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
