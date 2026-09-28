/**
 * OAuth scope-to-tool mapping, scope enforcement, and staff_id auto-injection.
 */

import { MCPTool } from '../../types';
import { HappyFoxScope } from '../types';

/** Each tool requires at least ONE of its listed scopes. */
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

/** Tool name -> the parameter that carries the acting staff member's id. */
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

/** An unknown tool is denied by default. */
function hasRequiredScopes(
  grantedScopes: string[],
  toolName: string
): boolean {
  const requiredScopes = TOOL_SCOPE_MAP[toolName];
  if (!requiredScopes) {
    return false;
  }

  return requiredScopes.some(scope => grantedScopes.includes(scope));
}

/** Undefined for an unknown tool. */
export function getRequiredScopes(toolName: string): HappyFoxScope[] | undefined {
  return TOOL_SCOPE_MAP[toolName];
}

export function filterToolsByScopes(
  tools: MCPTool[],
  grantedScopes: string[]
): MCPTool[] {
  return tools.filter(tool => hasRequiredScopes(grantedScopes, tool.name));
}

/** Fills in the acting staff id only when the caller did not supply one. */
export function injectStaffId(
  toolName: string,
  args: Record<string, any>,
  defaultStaffId: number
): Record<string, any> {
  const paramName = TOOLS_REQUIRING_STAFF_ID[toolName];
  if (!paramName) {
    return args;
  }

  if (args[paramName] !== undefined && args[paramName] !== null) {
    return args;
  }

  return {
    ...args,
    [paramName]: defaultStaffId,
  };
}
