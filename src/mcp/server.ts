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
 * MCP 2026-07-28 protocol layer.
 *
 * Stateless: there is no initialize handshake, no session, and no notification
 * handling. The transport (src/index.ts) validates headers and `params._meta`
 * and rejects unknown methods with HTTP 404 before dispatching here, so every
 * request reaching handleRequest has a readable string/number id.
 *
 * handleRequest resolves to a JSON-RPC response for every outcome but one:
 * InsufficientScopeError is rethrown, because an OAuth scope failure is an HTTP
 * 403 + WWW-Authenticate challenge (authorization spec, "Runtime Insufficient
 * Scope Errors"), not a JSON-RPC result, and only the transport can build that.
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

        default:
          // Unreachable over HTTP: the transport 404s unknown methods first.
          // Kept as defense in depth for direct callers.
          throw this.createError(METHOD_NOT_FOUND, `Method not found: ${request.method}`);
      }
    } catch (error) {
      // Scope failures are the transport's to report (HTTP 403 + challenge).
      if (error instanceof InsufficientScopeError) {
        throw error;
      }

      // The id is always readable here - the transport rejects malformed
      // envelopes - so error responses always echo it, and never send null.
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
   * Build a successful response. Every result carries `resultType: "complete"`
   * and `_meta[io.modelcontextprotocol/serverInfo]`. Caller-supplied meta (e.g.
   * statusCode/errorCode on tool execution errors) is merged first so serverInfo
   * can never be clobbered and the caller's keys are never lost.
   *
   * The type parameter names the spec result shape being built, so the compiler
   * enforces its required fields (`ttlMs`/`cacheScope` on the cacheable ones,
   * `content` on tools/call) instead of leaving them to tests alone.
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

  /**
   * server/discover - MANDATORY in 2026-07-28. Requires no OAuth scope: its
   * bytes are identical for every caller, hence cacheScope "public".
   */
  private handleDiscover(request: MCPRequest): MCPResponse {
    return this.success<DiscoverResult>(request, {
      supportedVersions: [...SUPPORTED_PROTOCOL_VERSIONS],
      capabilities: {
        // Bare empty objects: no listChanged (no subscriptions/listen stream to
        // deliver notifications on), no subscribe, no completions/prompts/logging.
        tools: {},
        resources: {}
      },
      instructions: SERVER_INSTRUCTIONS,
      ttlMs: CACHE_TTL_MS_DISCOVER,
      cacheScope: 'public'
    });
  }

  private async handleToolsList(request: MCPRequest): Promise<MCPResponse> {
    const cursor = request.params.cursor as string | undefined;

    // Validate cursor if provided
    let startIndex = 0;
    if (cursor !== undefined) {
      const parsed = parseInt(cursor, 10);
      if (isNaN(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
        throw this.createError(INVALID_PARAMS, 'Invalid cursor: must be a non-negative integer');
      }
      startIndex = parsed;
    }

    // Filter tools by granted scopes, then sort by name so the list is
    // deterministic across requests (byte comparison - localeCompare is
    // locale-dependent and would not be stable).
    const allTools = (await this.toolRegistry.listTools(this.authContext.scopes))
      .slice()
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    // Simple pagination: decode cursor as start index, page size of 50
    const pageSize = 50;
    const endIndex = Math.min(startIndex + pageSize, allTools.length);
    const pagedTools = allTools.slice(startIndex, endIndex);

    // Include nextCursor if there are more items
    const nextCursor = endIndex < allTools.length ? String(endIndex) : undefined;

    return this.success<ListToolsResult>(request, {
      tools: pagedTools,
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
      // Use OAuth-aware tool call with scope enforcement and staff_id injection
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
      // A scope failure is neither a protocol error nor a tool execution error:
      // it propagates to the transport, which answers 403 + WWW-Authenticate.
      if (error instanceof InsufficientScopeError) {
        throw error;
      }

      // ToolNotFoundError is a protocol error - throw to be handled as JSON-RPC error
      if (error instanceof ToolNotFoundError) {
        throw this.createError(INVALID_PARAMS, error.message);
      }

      // ToolExecutionError returns as tool result with isError: true. This is a
      // successful JSON-RPC result, so it still carries resultType: "complete".
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
          // Include API error details if available. Unprefixed _meta keys are
          // legal in 2026-07-28 (the prefix segment is optional).
          {
            ...(error.statusCode !== undefined && { statusCode: error.statusCode }),
            ...(error.errorCode !== undefined && { errorCode: error.errorCode })
          }
        );
      }

      // Unknown errors - return as tool error with isError: true
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
    const cursor = request.params.cursor as string | undefined;

    // Validate cursor if provided
    let startIndex = 0;
    if (cursor !== undefined) {
      const parsed = parseInt(cursor, 10);
      if (isNaN(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
        throw this.createError(INVALID_PARAMS, 'Invalid cursor: must be a non-negative integer');
      }
      startIndex = parsed;
    }

    // A server declaring the `resources` capability MUST answer resources/list
    // with the set available to this caller - which MAY be empty and MAY vary by
    // the authorization presented. A caller without happyfox:read sees nothing,
    // expressed as an empty array, never as an error (mirrors handleToolsList).
    const allResources = this.authContext.scopes.includes('happyfox:read')
      ? await this.resourceRegistry.listResources()
      : [];

    // Simple pagination: decode cursor as start index, page size of 50
    const pageSize = 50;
    const endIndex = Math.min(startIndex + pageSize, allResources.length);
    const pagedResources = allResources.slice(startIndex, endIndex);

    // Include nextCursor if there are more items
    const nextCursor = endIndex < allResources.length ? String(endIndex) : undefined;

    return this.success<ListResourcesResult>(request, {
      resources: pagedResources,
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

    // A scope denial is not a resources-feature error (-32602 is for a resource
    // that does not exist). It propagates to the transport as HTTP 403 with a
    // WWW-Authenticate insufficient_scope challenge naming the missing scope.
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
