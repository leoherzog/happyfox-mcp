import { MCPTool, HappyFoxAuth, ToolNotFoundError, ToolExecutionError } from '../../types';
import { HappyFoxAPIError } from '../../happyfox/client';
import { TicketTools } from './tickets';
import { ContactTools } from './contacts';
import { AssetTools } from './assets';

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

  async listTools(): Promise<MCPTool[]> {
    return Array.from(this.tools.values());
  }

  async callTool(name: string, args: any, auth: HappyFoxAuth): Promise<any> {
    const handler = this.toolHandlers.get(name);
    if (!handler) {
      // Protocol error - tool not found
      throw new ToolNotFoundError(name);
    }

    try {
      return await handler(args, auth);
    } catch (error) {
      // Preserve HappyFox API error details
      if (error instanceof HappyFoxAPIError) {
        throw new ToolExecutionError(error.message, error.statusCode, error.code);
      }
      // Tool execution error - will be returned with isError: true
      throw new ToolExecutionError(error instanceof Error ? error.message : String(error));
    }
  }
}
