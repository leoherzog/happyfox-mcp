import {
  MCPRequest,
  MCPResponse,
  MCPError,
  ResultMetaObject,
  AuthContext,
  ToolNotFoundError,
  ToolExecutionError,
  ResourceNotFoundError,
  InsufficientScopeError,
  METHOD_NOT_FOUND,
  INVALID_PARAMS,
  INTERNAL_ERROR,
  META_SERVER_INFO,
  SERVER_INFO,
  SERVER_INSTRUCTIONS,
  SUPPORTED_PROTOCOL_VERSIONS,
  CACHE_TTL_MS_DISCOVER,
  CACHE_TTL_MS_STANDARD,
  type MCPResult,
  type DiscoverResult,
  type ListToolsResult,
  type ListResourcesResult,
  type ReadResourceResult,
  type CallToolResult,
} from '../types';
import { ToolRegistry } from './tools/registry';
import { ResourceRegistry } from './resources/registry';

/**
 * MCP 2026-07-28 protocol layer: stateless, no handshake, no sessions.
 *
 * The transport (src/index.ts) validates headers and `params._meta` and 404s
 * unknown methods first, so every request here has a readable string/number id.
 */
export class MCPServer {
  private authContext: AuthContext;
  private toolRegistry: ToolRegistry;
  private resourceRegistry: ResourceRegistry;

  constructor(authContext: AuthContext) {
    this.authContext = authContext;
    this.toolRegistry = new ToolRegistry();
    this.resourceRegistry = new ResourceRegistry();
  }

  async handleRequest(request: MCPRequest): Promise<MCPResponse> {
    try {
      switch (request.method) {
        case 'server/discover':
          return this.handleDiscover(request);

        case 'tools/list':
          return await this.handleToolsList(request);

        case 'tools/call':
          return await this.handleToolCall(request);

        case 'resources/list':
          return await this.handleResourcesList(request);

        case 'resources/read':
          return await this.handleResourceRead(request);

        // Unreachable over HTTP (the transport 404s first); defense in depth
        // for direct callers.
        default:
          throw this.createError(METHOD_NOT_FOUND, `Method not found: ${request.method}`);
      }
    } catch (error) {
      // Scope failures are the transport's to report (HTTP 403 + challenge).
      if (error instanceof InsufficientScopeError) {
        throw error;
      }

      // id is always readable here - the transport already rejected malformed envelopes.
      if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
        return {
          jsonrpc: '2.0',
          error: error as MCPError,
          id: request.id
        };
      }
      return {
        jsonrpc: '2.0',
        error: {
          code: INTERNAL_ERROR,
          message: 'Internal error',
          data: error instanceof Error ? error.message : String(error)
        },
        id: request.id
      };
    }
  }

  /**
   * Build a successful response. Caller-supplied meta is merged first so
   * serverInfo can never be clobbered. `T` names the spec result shape so the
   * compiler enforces its required fields (ttlMs/cacheScope, content).
   */
  private success<T extends MCPResult>(
    request: MCPRequest,
    payload: Omit<T, 'resultType' | '_meta'>,
    meta?: ResultMetaObject
  ): MCPResponse {
    return {
      jsonrpc: '2.0',
      id: request.id,
      result: {
        resultType: 'complete',
        ...payload,
        _meta: { ...(meta ?? {}), [META_SERVER_INFO]: SERVER_INFO }
      }
    };
  }

  /** Cursor is a decimal start index; pages are 50 items. */
  private paginate<T>(items: T[], cursor: string | undefined): { page: T[]; nextCursor?: string } {
    let startIndex = 0;
    if (cursor !== undefined) {
      const parsed = parseInt(cursor, 10);
      if (isNaN(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
        throw this.createError(INVALID_PARAMS, 'Invalid cursor: must be a non-negative integer');
      }
      startIndex = parsed;
    }

    const endIndex = Math.min(startIndex + 50, items.length);
    return {
      page: items.slice(startIndex, endIndex),
      ...(endIndex < items.length && { nextCursor: String(endIndex) })
    };
  }

  /**
   * server/discover requires no OAuth scope: its bytes are identical for every
   * caller, hence cacheScope "public".
   */
  private handleDiscover(request: MCPRequest): MCPResponse {
    return this.success<DiscoverResult>(request, {
      supportedVersions: [...SUPPORTED_PROTOCOL_VERSIONS],
      capabilities: {
        // Bare empty objects: no listChanged (nothing delivers notifications),
        // no subscribe, no completions/prompts/logging.
        tools: {},
        resources: {}
      },
      instructions: SERVER_INSTRUCTIONS,
      ttlMs: CACHE_TTL_MS_DISCOVER,
      cacheScope: 'public'
    });
  }

  private async handleToolsList(request: MCPRequest): Promise<MCPResponse> {
    // Byte comparison, not localeCompare: the order must be stable across
    // requests regardless of locale.
    const allTools = (await this.toolRegistry.listTools(this.authContext.scopes))
      .slice()
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    const { page, nextCursor } = this.paginate(
      allTools,
      request.params.cursor as string | undefined
    );

    return this.success<ListToolsResult>(request, {
      tools: page,
      ...(nextCursor !== undefined && { nextCursor }),
      // Scope-filtered per caller, so the cache scope is private on every page.
      ttlMs: CACHE_TTL_MS_STANDARD,
      cacheScope: 'private'
    });
  }

  private async handleToolCall(request: MCPRequest): Promise<MCPResponse> {
    const { name, arguments: args } = request.params;

    if (!name) {
      throw this.createError(INVALID_PARAMS, 'Missing required parameter: name');
    }

    try {
      const result = await this.toolRegistry.callToolWithAuth(
        name as string,
        args || {},
        this.authContext
      );

      // tools/call results are NOT cacheable: no ttlMs, no cacheScope.
      return this.success<CallToolResult>(request, {
        content: [
          {
            type: 'text',
            text: typeof result === 'string' ? result : JSON.stringify(result, null, 2)
          }
        ]
      });
    } catch (error) {
      // A scope failure is the transport's to report (HTTP 403 + challenge).
      if (error instanceof InsufficientScopeError) {
        throw error;
      }

      if (error instanceof ToolNotFoundError) {
        throw this.createError(INVALID_PARAMS, error.message);
      }

      // A tool execution error is still a successful JSON-RPC result.
      if (error instanceof ToolExecutionError) {
        return this.success<CallToolResult>(
          request,
          {
            content: [
              {
                type: 'text',
                text: `Error: ${error.message}`
              }
            ],
            isError: true
          },
          // Unprefixed _meta keys are legal in 2026-07-28.
          {
            ...(error.statusCode !== undefined && { statusCode: error.statusCode }),
            ...(error.errorCode !== undefined && { errorCode: error.errorCode })
          }
        );
      }

      return this.success<CallToolResult>(request, {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`
          }
        ],
        isError: true
      });
    }
  }

  private async handleResourcesList(request: MCPRequest): Promise<MCPResponse> {
    // A caller without happyfox:read sees an empty list, never an error: the
    // set MAY vary by the authorization presented (mirrors handleToolsList).
    const allResources = this.authContext.scopes.includes('happyfox:read')
      ? await this.resourceRegistry.listResources()
      : [];

    const { page, nextCursor } = this.paginate(
      allResources,
      request.params.cursor as string | undefined
    );

    return this.success<ListResourcesResult>(request, {
      resources: page,
      ...(nextCursor !== undefined && { nextCursor }),
      // Per-HappyFox-account data: private on every page.
      ttlMs: CACHE_TTL_MS_STANDARD,
      cacheScope: 'private'
    });
  }

  private async handleResourceRead(request: MCPRequest): Promise<MCPResponse> {
    const { uri } = request.params;

    if (!uri) {
      throw this.createError(INVALID_PARAMS, 'Missing required parameter: uri');
    }

    // A scope denial is not a resources-feature error (-32602 means the
    // resource does not exist); the transport answers 403 + challenge.
    if (!this.authContext.scopes.includes('happyfox:read')) {
      throw new InsufficientScopeError(
        'Insufficient scope. Resource access requires happyfox:read.',
        ['happyfox:read']
      );
    }

    try {
      const content = await this.resourceRegistry.readResource(
        uri as string,
        this.authContext.credentials
      );
      return this.success<ReadResourceResult>(request, {
        contents: [content],
        ttlMs: CACHE_TTL_MS_STANDARD,
        cacheScope: 'private'
      });
    } catch (error) {
      if (error instanceof ResourceNotFoundError) {
        throw this.createError(INVALID_PARAMS, error.message, { uri });
      }
      throw error;
    }
  }

  private createError(code: number, message: string, data?: unknown): MCPError {
    return {
      code,
      message,
      ...(data !== undefined && { data })
    };
  }
}
