import {
  MCPTool,
  HappyFoxAuth,
  AuthContext,
  ToolNotFoundError,
  ToolExecutionError,
  InsufficientScopeError,
  CredentialsRejectedError,
} from '../../types';
import { HappyFoxAPIError } from '../../happyfox/client';
import { TicketTools } from './tickets';
import { ContactTools } from './contacts';
import { AssetTools } from './assets';
import { ReportTools } from './reports';
import { KnowledgeBaseTools } from './knowledge-base';
import { TicketFieldChoiceTools } from './ticket-field-choices';
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
    this.registerToolModule(new ReportTools());
    this.registerToolModule(new KnowledgeBaseTools());
    this.registerToolModule(new TicketFieldChoiceTools());
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

  /**
   * Call a tool with scope enforcement and staff_id injection.
   * @throws CredentialsRejectedError when HappyFox answers 401; every other failure is a ToolExecutionError
   */
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
        // 401 means the stored key no longer works, so the client must re-authorize. A 403 can be the
        // agent's role, which re-consent would not fix, so it stays a tool result.
        if (error.statusCode === 401) {
          throw new CredentialsRejectedError(error.message);
        }
        throw new ToolExecutionError(error.message, error.statusCode, error.code);
      }
      throw new ToolExecutionError(error instanceof Error ? error.message : String(error));
    }
  }
}
