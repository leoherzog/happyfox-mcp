import { MCPRequest, MCPResponse, MCPError, MCPMessage, AuthContext, ToolNotFoundError, ToolExecutionError, ResourceNotFoundError, MCP_PROTOCOL_VERSION } from '../types';
import { ToolRegistry } from './tools/registry';
import { ResourceRegistry } from './resources/registry';
import packageJson from '../../package.json';

export class MCPServer {
  private authContext: AuthContext;
  private toolRegistry: ToolRegistry;
  private resourceRegistry: ResourceRegistry;

  constructor(authContext: AuthContext) {
    this.authContext = authContext;
    this.toolRegistry = new ToolRegistry();
    this.resourceRegistry = new ResourceRegistry();
  }

  // Type guard to check if message is a request (has id) vs notification (no id)
  // Per JSON-RPC 2.0: requests MUST have 'id' member (can be null, string, or number)
  // Notifications MUST NOT have 'id' member at all
  private isRequest(message: MCPMessage): message is MCPRequest {
    return 'id' in message;
  }

  // Validate that id is a valid JSON-RPC 2.0 type (string, number, or null)
  // Per spec, objects and arrays are NOT valid id types
  private isValidId(id: unknown): id is string | number | null {
    return id === null || typeof id === 'string' || typeof id === 'number';
  }

  async handleMessage(message: MCPMessage): Promise<MCPResponse | null> {
    try {
      // Handle notifications (no id, no response)
      if (!this.isRequest(message)) {
        switch (message.method) {
          case 'initialized':
          case 'notifications/initialized':
            // Notifications don't receive responses per JSON-RPC 2.0
            return null;
          default:
            // Unknown notification - silently ignore per spec
            return null;
        }
      }

      // Validate id type per JSON-RPC 2.0 spec (must be string, number, or null)
      if (!this.isValidId(message.id)) {
        throw this.createError(-32600, 'Invalid Request: id must be a string, number, or null');
      }

      // Handle requests (must have id, must respond)
      const request = message as MCPRequest;
      switch (request.method) {
        case 'initialize':
          return this.handleInitialize(request);

        case 'tools/list':
          return this.handleToolsList(request);

        case 'tools/call':
          return await this.handleToolCall(request);

        case 'resources/list':
          return this.handleResourcesList(request);

        case 'resources/read':
          return await this.handleResourceRead(request);

        case 'completion/complete':
          return this.handleCompletion(request);

        default:
          throw this.createError(-32601, 'Method not found');
      }
    } catch (error) {
      // Get the id from the message if it's a request, null otherwise (per JSON-RPC 2.0 spec)
      const id = this.isRequest(message) ? message.id : null;

      // Check if it's our MCPError (plain object with code and message)
      if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
        return {
          jsonrpc: '2.0',
          error: error as MCPError,
          id
        };
      }
      return {
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal error',
          data: error instanceof Error ? error.message : String(error)
        },
        id
      };
    }
  }

  private handleInitialize(request: MCPRequest): MCPResponse {
    // Read client's requested protocol version
    const clientVersion = request.params?.protocolVersion as string | undefined;

    // MCP 2025-11-25: Only accept the current protocol version (no backwards compat)
    if (clientVersion !== MCP_PROTOCOL_VERSION) {
      throw this.createError(
        -32602,
        `Unsupported protocol version: ${clientVersion || 'none'}. This server only supports ${MCP_PROTOCOL_VERSION}`,
        { supported: [MCP_PROTOCOL_VERSION], requested: clientVersion }
      );
    }

    return {
      jsonrpc: '2.0',
      result: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {
          tools: {},
          resources: {}
        },
        serverInfo: {
          name: 'happyfox-mcp',
          version: packageJson.version
        }
      },
      id: request.id
    };
  }

  private async handleToolsList(request: MCPRequest): Promise<MCPResponse> {
    const cursor = request.params?.cursor as string | undefined;

    // Validate cursor if provided
    let startIndex = 0;
    if (cursor !== undefined) {
      const parsed = parseInt(cursor, 10);
      if (isNaN(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
        throw this.createError(-32602, 'Invalid cursor: must be a non-negative integer');
      }
      startIndex = parsed;
    }

    // Filter tools by granted scopes
    const allTools = await this.toolRegistry.listTools(this.authContext.scopes);

    // Simple pagination: decode cursor as start index, page size of 50
    const pageSize = 50;
    const endIndex = Math.min(startIndex + pageSize, allTools.length);
    const pagedTools = allTools.slice(startIndex, endIndex);

    const result: any = { tools: pagedTools };

    // Include nextCursor if there are more items
    if (endIndex < allTools.length) {
      result.nextCursor = String(endIndex);
    }

    return {
      jsonrpc: '2.0',
      result,
      id: request.id
    };
  }

  private async handleToolCall(request: MCPRequest): Promise<MCPResponse> {
    // Auth is validated by OAuth layer - no need for legacy header checks

    const { name, arguments: args } = request.params || {};

    if (!name) {
      throw this.createError(-32602, 'Missing required parameter: name');
    }

    try {
      // Use OAuth-aware tool call with scope enforcement and staff_id injection
      const result = await this.toolRegistry.callToolWithAuth(name, args || {}, this.authContext);

      return {
        jsonrpc: '2.0',
        result: {
          content: [
            {
              type: 'text',
              text: typeof result === 'string' ? result : JSON.stringify(result, null, 2)
            }
          ]
        },
        id: request.id
      };
    } catch (error) {
      // ToolNotFoundError is a protocol error - throw to be handled as JSON-RPC error
      if (error instanceof ToolNotFoundError) {
        throw this.createError(-32602, error.message);
      }

      // ToolExecutionError returns as tool result with isError: true
      if (error instanceof ToolExecutionError) {
        const result: any = {
          content: [
            {
              type: 'text',
              text: `Error: ${error.message}`
            }
          ],
          isError: true
        };

        // Include API error details if available
        if (error.statusCode !== undefined || error.errorCode !== undefined) {
          result._meta = {
            ...(error.statusCode !== undefined && { statusCode: error.statusCode }),
            ...(error.errorCode !== undefined && { errorCode: error.errorCode })
          };
        }

        return {
          jsonrpc: '2.0',
          result,
          id: request.id
        };
      }

      // Unknown errors - return as tool error with isError: true
      return {
        jsonrpc: '2.0',
        result: {
          content: [
            {
              type: 'text',
              text: `Error: ${error instanceof Error ? error.message : String(error)}`
            }
          ],
          isError: true
        },
        id: request.id
      };
    }
  }

  private async handleResourcesList(request: MCPRequest): Promise<MCPResponse> {
    // Check read scope for resource listing (consistent with resources/read)
    if (!this.authContext.scopes.includes('happyfox:read')) {
      throw this.createError(-32600, 'Insufficient permissions. Resource access requires happyfox:read scope.');
    }

    const cursor = request.params?.cursor as string | undefined;

    // Validate cursor if provided
    let startIndex = 0;
    if (cursor !== undefined) {
      const parsed = parseInt(cursor, 10);
      if (isNaN(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
        throw this.createError(-32602, 'Invalid cursor: must be a non-negative integer');
      }
      startIndex = parsed;
    }

    const allResources = await this.resourceRegistry.listResources();

    // Simple pagination: decode cursor as start index, page size of 50
    const pageSize = 50;
    const endIndex = Math.min(startIndex + pageSize, allResources.length);
    const pagedResources = allResources.slice(startIndex, endIndex);

    const result: any = { resources: pagedResources };

    // Include nextCursor if there are more items
    if (endIndex < allResources.length) {
      result.nextCursor = String(endIndex);
    }

    return {
      jsonrpc: '2.0',
      result,
      id: request.id
    };
  }

  private async handleResourceRead(request: MCPRequest): Promise<MCPResponse> {
    // Auth is validated by OAuth layer - check read scope for resources
    if (!this.authContext.scopes.includes('happyfox:read')) {
      throw this.createError(-32600, 'Insufficient permissions. Resource access requires happyfox:read scope.');
    }

    const { uri } = request.params || {};

    if (!uri) {
      throw this.createError(-32602, 'Missing required parameter: uri');
    }

    try {
      const content = await this.resourceRegistry.readResource(uri, this.authContext.credentials);
      return {
        jsonrpc: '2.0',
        result: { contents: [content] },
        id: request.id
      };
    } catch (error) {
      if (error instanceof ResourceNotFoundError) {
        throw this.createError(-32602, error.message);
      }
      throw error;
    }
  }

  private handleCompletion(request: MCPRequest): MCPResponse {
    // Completion is not implemented - return empty results
    return {
      jsonrpc: '2.0',
      result: {
        completion: {
          values: [],
          total: 0,
          hasMore: false
        }
      },
      id: request.id
    };
  }

  private createError(code: number, message: string, data?: any): MCPError {
    return {
      code,
      message,
      ...(data !== undefined && { data })
    };
  }
}
