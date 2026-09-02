import { MCPTool, HappyFoxAuth, AuthContext, ToolNotFoundError, ToolExecutionError, InsufficientScopeError } from '../../types';
import { HappyFoxAPIError } from '../../happyfox/client';
import { TicketTools } from './tickets';
import { ContactTools } from './contacts';
import { AssetTools } from './assets';
import {
  hasRequiredScopes,
  filterToolsByScopes,
  injectStaffId,
  getRequiredScopes,
} from '../../oauth/services/scope-enforcer';

export class ToolRegistry {
  private tools: Map<string, MCPTool>;
  private toolHandlers: Map<string, (args: any, auth: HappyFoxAuth) => Promise<any>>;

  constructor() {
    this.tools = new Map();
    this.toolHandlers = new Map();

    // Initialize tool modules
    const ticketTools = new TicketTools();
    const contactTools = new ContactTools();
    const assetTools = new AssetTools();

    // Register all tools
    this.registerToolModule(ticketTools);
    this.registerToolModule(contactTools);
    this.registerToolModule(assetTools);
  }

  private registerToolModule(module: any) {
    const tools = module.getTools();
    for (const tool of tools) {
      this.tools.set(tool.name, tool);
      this.toolHandlers.set(tool.name, module[tool.handler].bind(module));
    }
  }

  /**
   * List all tools, optionally filtered by granted scopes
   */
  async listTools(scopes?: string[]): Promise<MCPTool[]> {
    const allTools = Array.from(this.tools.values());

    if (scopes && scopes.length > 0) {
      return filterToolsByScopes(allTools, scopes);
    }

    return allTools;
  }

  /**
   * Call a tool with OAuth context (scope enforcement and staff_id injection)
   */
  async callToolWithAuth(name: string, args: any, authContext: AuthContext): Promise<any> {
    const handler = this.toolHandlers.get(name);
    if (!handler) {
      throw new ToolNotFoundError(name);
    }

    // Enforce scope permissions. Not a tool execution error: the transport turns
    // this into HTTP 403 + WWW-Authenticate so the client can step up.
    if (!hasRequiredScopes(authContext.scopes, name)) {
      const requiredScopes = getRequiredScopes(name) ?? [];
      throw new InsufficientScopeError(
        `Insufficient scope. Tool '${name}' requires scope: ${requiredScopes.join(' or ')}`,
        requiredScopes
      );
    }

    // Auto-inject staff_id if not provided
    const enrichedArgs = injectStaffId(name, args, authContext.staffId);

    try {
      return await handler(enrichedArgs, authContext.credentials);
    } catch (error) {
      if (error instanceof HappyFoxAPIError) {
        throw new ToolExecutionError(error.message, error.statusCode, error.code);
      }
      throw new ToolExecutionError(error instanceof Error ? error.message : String(error));
    }
  }
}
