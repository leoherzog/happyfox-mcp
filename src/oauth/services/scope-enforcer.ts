/**
 * Scope Enforcer Service
 *
 * Manages OAuth scope-to-tool mapping, scope enforcement, and staff_id auto-injection.
 */

import { MCPTool } from '../../types';
import { HappyFoxScope } from '../types';

/**
 * Tool-to-scope mapping
 * Each tool requires at least one of its listed scopes
 */
export const TOOL_SCOPE_MAP: Record<string, HappyFoxScope[]> = {
  // Read operations (happyfox:read)
  'happyfox_list_tickets': ['happyfox:read'],
  'happyfox_get_ticket': ['happyfox:read'],
  'happyfox_list_contacts': ['happyfox:read'],
  'happyfox_get_contact': ['happyfox:read'],
  'happyfox_get_contact_group': ['happyfox:read'],
  'happyfox_list_assets': ['happyfox:read'],
  'happyfox_get_asset': ['happyfox:read'],
  'happyfox_list_asset_custom_fields': ['happyfox:read'],
  'happyfox_get_asset_custom_field': ['happyfox:read'],

  // Write operations (happyfox:write)
  'happyfox_create_ticket': ['happyfox:write'],
  'happyfox_create_tickets_bulk': ['happyfox:write'],
  'happyfox_add_staff_reply': ['happyfox:write'],
  'happyfox_add_private_note': ['happyfox:write'],
  'happyfox_add_contact_reply': ['happyfox:write'],
  'happyfox_forward_ticket': ['happyfox:write'],
  'happyfox_update_ticket_tags': ['happyfox:write'],
  'happyfox_update_ticket_custom_fields': ['happyfox:write'],
  'happyfox_subscribe_to_ticket': ['happyfox:write'],
  'happyfox_unsubscribe_from_ticket': ['happyfox:write'],
  'happyfox_create_contact': ['happyfox:write'],
  'happyfox_update_contact': ['happyfox:write'],
  'happyfox_create_contact_group': ['happyfox:write'],
  'happyfox_update_contact_group': ['happyfox:write'],
  'happyfox_add_contacts_to_group': ['happyfox:write'],
  'happyfox_remove_contacts_from_group': ['happyfox:write'],
  'happyfox_create_asset': ['happyfox:write'],
  'happyfox_update_asset': ['happyfox:write'],

  // Admin operations (happyfox:admin)
  'happyfox_delete_ticket': ['happyfox:admin'],
  'happyfox_move_ticket_category': ['happyfox:admin'],
  'happyfox_delete_asset': ['happyfox:admin'],
};

/**
 * Tools that require a staff_id-like parameter
 * Maps tool name to the parameter name used for staff ID
 */
export const TOOLS_REQUIRING_STAFF_ID: Record<string, string> = {
  // Ticket tools using 'staff_id'
  'happyfox_add_staff_reply': 'staff_id',
  'happyfox_add_private_note': 'staff_id',
  'happyfox_forward_ticket': 'staff_id',
  'happyfox_delete_ticket': 'staff_id',
  'happyfox_move_ticket_category': 'staff_id',
  'happyfox_update_ticket_tags': 'staff_id',
  'happyfox_subscribe_to_ticket': 'staff_id',
  'happyfox_unsubscribe_from_ticket': 'staff_id',

  // Asset tools using different parameter names
  'happyfox_create_asset': 'created_by',
  'happyfox_update_asset': 'updated_by',
  'happyfox_delete_asset': 'deleted_by',
};

/**
 * Check if granted scopes include required scopes for a tool
 *
 * @param grantedScopes - Scopes granted to the OAuth token
 * @param toolName - Name of the tool to check
 * @returns true if user has at least one required scope
 */
export function hasRequiredScopes(
  grantedScopes: string[],
  toolName: string
): boolean {
  const requiredScopes = TOOL_SCOPE_MAP[toolName];

  // Unknown tool - deny by default
  if (!requiredScopes) {
    return false;
  }

  // Check if any required scope is granted
  return requiredScopes.some(scope => grantedScopes.includes(scope));
}

/**
 * Get the required scopes for a tool
 *
 * @param toolName - Name of the tool
 * @returns Array of required scopes, or undefined if tool is unknown
 */
export function getRequiredScopes(toolName: string): HappyFoxScope[] | undefined {
  return TOOL_SCOPE_MAP[toolName];
}

/**
 * Filter tools list by granted scopes
 * Only returns tools the user has permission to use
 *
 * @param tools - Full list of available tools
 * @param grantedScopes - Scopes granted to the OAuth token
 * @returns Filtered list of permitted tools
 */
export function filterToolsByScopes(
  tools: MCPTool[],
  grantedScopes: string[]
): MCPTool[] {
  return tools.filter(tool => hasRequiredScopes(grantedScopes, tool.name));
}

/**
 * Inject staff_id into tool arguments if not already provided
 *
 * @param toolName - Name of the tool being called
 * @param args - Original tool arguments
 * @param defaultStaffId - Staff ID to inject if not provided
 * @returns Arguments with staff_id injected if needed
 */
export function injectStaffId(
  toolName: string,
  args: Record<string, any>,
  defaultStaffId: number
): Record<string, any> {
  const paramName = TOOLS_REQUIRING_STAFF_ID[toolName];

  // Tool doesn't require staff_id
  if (!paramName) {
    return args;
  }

  // Staff ID already provided - don't override
  if (args[paramName] !== undefined && args[paramName] !== null) {
    return args;
  }

  // Inject the default staff ID
  return {
    ...args,
    [paramName]: defaultStaffId,
  };
}
