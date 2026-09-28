import { MCPTool, HappyFoxAuth, AuthContext, ToolNotFoundError, ToolExecutionError, InsufficientScopeError } from '../../types';
import { HappyFoxAPIError } from '../../happyfox/client';
import { TicketTools } from './tickets';
import { ContactTools } from './contacts';
import { AssetTools } from './assets';
import {
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

    this.registerToolModule(new TicketTools());
    this.registerToolModule(new ContactTools());
    this.registerToolModule(new AssetTools());
  }

  private registerToolModule(module: any) {
    const tools = module.getTools();
    for (const tool of tools) {
      this.tools.set(tool.name, tool);
      this.toolHandlers.set(tool.name, module[tool.handler].bind(module));
    }
  }

  /** Only the tools the granted scopes permit; an empty scope list yields none. */
  async listTools(scopes: string[]): Promise<MCPTool[]> {
    return filterToolsByScopes(Array.from(this.tools.values()), scopes);
  }

  /** Call a tool with scope enforcement and staff_id injection. */
  async callToolWithAuth(name: string, args: any, authContext: AuthContext): Promise<any> {
    const handler = this.toolHandlers.get(name);
    if (!handler) {
      throw new ToolNotFoundError(name);
    }

    // Not a tool execution error: the transport turns this into HTTP 403 +
    // WWW-Authenticate so the client can step up.
    const requiredScopes = getRequiredScopes(name) ?? [];
    if (!requiredScopes.some(scope => authContext.scopes.includes(scope))) {
      throw new InsufficientScopeError(
        `Insufficient scope. Tool '${name}' requires scope: ${requiredScopes.join(' or ')}`,
        requiredScopes
      );
    }

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
