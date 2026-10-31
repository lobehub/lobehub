import { isDesktop } from '@lobechat/const';
import {
  McpCallNotStartedError,
  type McpElicitationContinuation,
  type McpElicitationHost,
  McpInputRequiredError,
} from '@lobechat/mcp-elicitation';
import {
  type CheckMcpInstallResult,
  ConnectorErrorCode,
  type CustomPluginMetadata,
  type LobeChatPluginApi,
  type ToolManifest,
  type ToolManifestSettings,
} from '@lobechat/types';
import { safeParseJSON } from '@lobechat/utils';
import { getMcpServerDescription } from '@lobechat/utils/mcpServerDescription';
import { type DeploymentOption } from '@lobehub/market-sdk';
import { ProtocolError, SdkError, SdkErrorCode } from '@modelcontextprotocol/client';
import { TRPCError } from '@trpc/server';
import retry from 'async-retry';
import debug from 'debug';

import {
  type MCPClientParams,
  type McpPrompt,
  type McpResource,
  type McpTool,
  type StdioMCPParams,
} from '@/libs/mcp';
import { MCPClient } from '@/libs/mcp';
import {
  getMCPConnectionErrorType,
  getMCPErrorLogMetadata,
  getMCPLogOrigin,
} from '@/libs/mcp/utils';

import { type ProcessContentBlocksFn } from './contentProcessor';
import { contentBlocksToString } from './contentProcessor';
import { mcpSystemDepsCheckService } from './deps';

const log = debug('lobe-mcp:service');

interface MCPConnectionLogMetadata {
  origin?: string;
  type: MCPClientParams['type'];
}

/**
 * MCP Tool call raw result type
 */
export interface MCPToolCallRawResult {
  content: any[];
  isError?: boolean;
}

/**
 * MCP Tool call processed result type
 */
export interface MCPToolCallProcessedResult {
  content: string;
  error?: Error;
  state: {
    content: any[];
    isError?: boolean;
  };
  success: boolean;
}

// Removed MCPConnection interface as it's no longer needed

const isMcpToolFailure = (error: unknown): error is ProtocolError | SdkError =>
  ProtocolError.isInstance(error) ||
  (SdkError.isInstance(error) &&
    (error.code === SdkErrorCode.RequestTimeout || error.code === SdkErrorCode.ConnectionClosed));

export class MCPService {
  // Store instances of the custom MCPClient, keyed by serialized MCPClientParams
  private clients: Map<string, MCPClient> = new Map();

  /**
   * Process MCP tool call result with content blocks processing
   * This is a common utility method that can be used by both internal MCP calls and external services (e.g., Composio)
   */
  static async processToolCallResult(
    result: MCPToolCallRawResult,
    processContentBlocksFn?: ProcessContentBlocksFn,
  ): Promise<MCPToolCallProcessedResult> {
    // Process content blocks (upload images, etc.)

    const newContent =
      result.isError || !processContentBlocksFn
        ? result.content
        : await processContentBlocksFn(result.content);

    // Convert content blocks to string
    const content = contentBlocksToString(newContent);

    const state = { ...result, content: newContent };

    return {
      content,
      ...(result.isError ? { error: { message: content, name: 'MCPToolError' } } : {}),
      state,
      success: result.isError !== true,
    };
  }

  /**
   * Keep MCP logs allowlist-only so future connection fields cannot silently expose credentials.
   */
  private getConnectionLogMetadata = (params: MCPClientParams): MCPConnectionLogMetadata => {
    if (params.type === 'http') {
      return { origin: getMCPLogOrigin(params.url), type: params.type };
    }

    return { type: params.type };
  };

  /**
   * Run an MCP operation with automatic session re-establishment.
   *
   * When the remote MCP server restarts, the cached client keeps sending the
   * stale session id and the server rejects it (`-32000 / No valid session ID
   * provided`), surfaced by MCPClient as a `NoValidSessionId` error. On that
   * error we discard the cached client (`skipCache`) and retry, so the next
   * attempt re-initializes a fresh session transparently. Any other error bails
   * immediately as a TRPCError without retrying.
   */
  private async withSessionRetry<T>(
    params: MCPClientParams,
    operationName: string,
    operation: (client: MCPClient) => Promise<T>,
    scope = 'metadata',
  ): Promise<T> {
    const connection = this.getConnectionLogMetadata(params);

    return retry(
      async (bail, attemptNumber) => {
        // Skip cache on retry attempts to drop the stale (dead) session
        const skipCache = attemptNumber > 1;
        const operationLog = { attempt: attemptNumber, connection, operation: operationName };
        log('MCP operation attempt: %O', operationLog);

        try {
          // Keep getClient inside the guarded block: a client initialization
          // failure (bad URL/token, stdio spawn error) is NOT a stale-session
          // error, so it must bail immediately instead of retrying — otherwise
          // we'd repeat auth attempts / respawn stdio commands needlessly.
          const client = await this.getClient(params, skipCache, scope);
          return await operation(client);
        } catch (error) {
          if (error instanceof McpInputRequiredError) {
            bail(error);
            return undefined as T;
          }
          // Only retry for NoValidSessionId errors
          if (
            !(error instanceof McpCallNotStartedError && error.retryable) &&
            (error as Error).message !== 'NoValidSessionId'
          ) {
            console.error('MCP operation failed:', {
              ...operationLog,
              error: getMCPErrorLogMetadata(error),
            });
            bail(
              error instanceof TRPCError
                ? error
                : new TRPCError({
                    cause: error,
                    code: 'INTERNAL_SERVER_ERROR',
                    message: `Error ${operationName} from MCP server: ${(error as Error).message}`,
                  }),
            );
            // After bail() the promise is already rejected; return (do NOT throw)
            // so async-retry does not schedule another attempt.
            return undefined as T;
          }
          throw error; // rethrow to trigger retry with a fresh session
        }
      },
      { maxRetryTime: 1000, minTimeout: 100, retries: 3 },
    );
  }

  // --- MCP Interaction ---

  // listTools now accepts MCPClientParams
  async listTools(params: MCPClientParams): Promise<LobeChatPluginApi[]> {
    return this.withSessionRetry(params, 'listing tools', async (client) => {
      const result = await client.listTools();
      log(`Tools listed successfully, result count: %d`, result.length);
      return result.map<LobeChatPluginApi>((item) => ({
        // Assuming identifier is the unique name/id
        description: item.description,
        name: item.name,
        parameters: item.inputSchema as ToolManifestSettings,
      }));
    });
  }

  // listTools now accepts MCPClientParams
  async listRawTools(params: MCPClientParams): Promise<McpTool[]> {
    return this.withSessionRetry(params, 'listing tools', async (client) => {
      const result = await client.listTools();
      log(`Tools listed successfully, result count: %d`, result.length);
      return result;
    });
  }

  // listResources now accepts MCPClientParams
  async listResources(params: MCPClientParams): Promise<McpResource[]> {
    return this.withSessionRetry(params, 'listing resources', async (client) => {
      const result = await client.listResources();
      log(`Resources listed successfully, result count: %d`, result.length);
      return result;
    });
  }

  // listPrompts now accepts MCPClientParams
  async listPrompts(params: MCPClientParams): Promise<McpPrompt[]> {
    return this.withSessionRetry(params, 'listing prompts', async (client) => {
      const result = await client.listPrompts();
      log(`Prompts listed successfully, result count: %d`, result.length);
      return result;
    });
  }

  // callTool now accepts an object with clientParams, toolName, argsStr, and processContentBlocks
  async callTool(options: {
    argsStr: any;
    elicitation?: {
      host?: McpElicitationHost;
      continuation?: McpElicitationContinuation;
      signal?: AbortSignal;
      interactive?: boolean;
      timeoutMs?: number;
      scope?: string;
    };
    clientParams: MCPClientParams;
    processContentBlocks?: ProcessContentBlocksFn;
    toolName: string;
  }): Promise<any> {
    const {
      clientParams,
      toolName,
      argsStr,
      processContentBlocks: processContentBlocksFn,
    } = options;

    const args = safeParseJSON(argsStr);

    return this.withSessionRetry(
      clientParams,
      `calling tool "${toolName}"`,
      async (client) => {
        log('Calling MCP tool: %s', toolName);

        try {
          // Delegate the call to the MCPClient instance
          const result = await client.callTool(toolName, args, options.elicitation); // Pass args directly

          // Use the common processing method
          const processedResult = await MCPService.processToolCallResult(
            result,
            processContentBlocksFn,
          );

          log('MCP tool call completed: %O', {
            contentBlockCount: Array.isArray(processedResult.state.content)
              ? processedResult.state.content.length
              : 0,
            isError: processedResult.state.isError === true,
            toolName,
          });

          return processedResult;
        } catch (error) {
          // Session errors must bubble up so withSessionRetry can reconnect & retry
          if ((error as Error).message === 'NoValidSessionId') throw error;

          // Tool-level MCP errors are returned as a failed tool result, not thrown
          if (isMcpToolFailure(error)) {
            return {
              content: error.message,
              error,
              state: {
                content: [{ text: error.message, type: 'text' }],
                isError: true,
              },
              success: false,
            };
          }

          // Other errors propagate; withSessionRetry wraps them as a TRPCError
          throw error;
        }
      },
      `${options.elicitation?.scope ?? 'tool'}:${options.elicitation?.host ? 'elicitation' : 'plain'}`,
    );
  }

  // Private method to get or initialize a client based on parameters
  private async getClient(
    params: MCPClientParams,
    skipCache = false,
    scope = 'metadata',
  ): Promise<MCPClient> {
    // Every server caller (including connector sync and agent tool execution)
    // must enforce the same Desktop-only stdio boundary, even for cached clients.
    if (params.type === 'stdio' && !isDesktop) {
      throw new TRPCError({
        cause: { data: { code: ConnectorErrorCode.StdioDesktopOnly } },
        code: 'BAD_REQUEST',
        message: 'Stdio MCP type is not supported in web environment.',
      });
    }

    const key = `${scope}:${this.serializeParams(params)}`; // Use custom serialization

    if (!skipCache && this.clients.has(key)) {
      return this.clients.get(key)!;
    }

    const connection = this.getConnectionLogMetadata(params);
    log(`No cached client found, Initializing new client.`);
    try {
      const client = new MCPClient(params, scope.endsWith(':elicitation'));
      await client.initialize({
        onProgress: (progress) => {
          log(`New client initializing... ${progress.progress}/${progress.total}`);
        },
      }); // Initialization logic should be within MCPClient
      this.clients.set(key, client);
      log('New MCP client initialized and cached: %O', connection);
      return client;
    } catch (error) {
      const errorLog = getMCPErrorLogMetadata(error);
      console.error('Failed to initialize MCP client:', { connection, error: errorLog });

      // Preserve complete error information, especially detailed stderr output
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (typeof error === 'object' && !!error && 'data' in error) {
        const type = getMCPConnectionErrorType(error);
        throw new TRPCError({
          cause: error,
          code:
            type === 'AUTHORIZATION_ERROR'
              ? // These credentials belong to the upstream MCP, not the signed-in
                // LobeHub user. A 401 here would trigger the client's global logout.
                'FORBIDDEN'
              : type === 'INITIALIZATION_TIMEOUT'
                ? 'TIMEOUT'
                : 'SERVICE_UNAVAILABLE',
          message: errorMessage,
        });
      }

      // Log detailed error information for debugging
      log('Detailed initialization error: %O', {
        connection,
        error: errorLog,
      });

      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: errorMessage, // Use complete error message directly
      });
    }
  }

  // Custom serialization function to ensure consistent keys
  private serializeParams(params: MCPClientParams): string {
    const sortedKeys = Object.keys(params).sort();
    const sortedParams: Record<string, any> = {};

    for (const key of sortedKeys) {
      const value = (params as any)[key];
      // Sort the 'args' array if it exists
      if (key === 'args' && Array.isArray(value)) {
        sortedParams[key] = JSON.stringify(key);
      } else {
        sortedParams[key] = value;
      }
    }

    return JSON.stringify(sortedParams);
  }

  async getStreamableMcpServerManifest(
    identifier: string,
    url: string,
    metadata?: CustomPluginMetadata,
    auth?: {
      accessToken?: string;
      token?: string;
      type: 'none' | 'bearer' | 'oauth2';
    },
    headers?: Record<string, string>,
  ): Promise<ToolManifest> {
    const mcpParams = { name: identifier, type: 'http' as const, url };

    // Add authentication info to parameters if available
    if (auth) {
      (mcpParams as any).auth = auth;
    }

    // Add headers info to parameters if available
    if (headers) {
      (mcpParams as any).headers = headers;
    }

    const tools = await this.listTools(mcpParams);

    return {
      api: tools,
      identifier,
      // @ts-ignore
      mcpParams,
      meta: {
        avatar: metadata?.avatar || 'MCP_AVATAR',
        description:
          metadata?.description ||
          getMcpServerDescription(identifier, { tools }, { includeToolExample: true }),
        title: identifier,
      },
      // TODO: temporary
      type: 'mcp' as any,
    };
  }

  async getStdioMcpServerManifest(
    params: Omit<StdioMCPParams, 'type'>,
    metadata?: CustomPluginMetadata,
  ): Promise<ToolManifest> {
    const mcpParams = {
      args: params.args,
      command: params.command,
      env: params.env,
      name: params.name,
      type: 'stdio' as const,
    };

    const client = await this.getClient(mcpParams); // Get client using params

    const manifest = await client.listManifests();

    const identifier = params.name;

    return {
      api: manifest.tools ? this.transformMCPToolToLobeAPI(manifest.tools) : [],
      identifier,
      meta: {
        avatar: metadata?.avatar || 'MCP_AVATAR',
        description: metadata?.description || getMcpServerDescription(identifier, manifest),
        title: metadata?.name || identifier,
      },
      ...manifest,
      // @ts-ignore
      mcpParams,
      // TODO: temporary
      type: 'mcp' as any,
    } as ToolManifest;
  }

  /**
   * Check MCP plugin installation status
   */
  async checkMcpInstall(input: {
    deploymentOptions: DeploymentOption[];
  }): Promise<CheckMcpInstallResult> {
    try {
      log(
        'Checking MCP plugin installation status for %d option(s)',
        input.deploymentOptions.length,
      );
      const results = [];

      // Check each deployment option
      for (const option of input.deploymentOptions) {
        // Use system dependency check service to check deployment option
        const result = await mcpSystemDepsCheckService.checkDeployOption(option);
        results.push(result);
      }

      // Find the recommended or first installable option
      const recommendedResult = results.find((r) => r.isRecommended && r.allDependenciesMet);
      const firstInstallableResult = results.find((r) => r.allDependenciesMet);

      // Return the recommended result, or the first installable result, or the first result
      const bestResult = recommendedResult || firstInstallableResult || results[0];

      log('MCP plugin installation check completed: %O', {
        allDependenciesMet: bestResult?.allDependenciesMet === true,
        hasResult: Boolean(bestResult),
        isRecommended: bestResult?.isRecommended === true,
        needsConfig: bestResult?.needsConfig === true,
      });

      // Construct return result, ensure configuration check information is included
      const checkResult: CheckMcpInstallResult = {
        ...bestResult,
        allOptions: results,
        platform: process.platform,
        success: true,
      };

      // If the best result requires configuration, ensure related fields are set at the top level
      if (bestResult?.needsConfig) {
        checkResult.needsConfig = true;
        checkResult.configSchema = bestResult.configSchema;
        log('Configuration is required for the selected MCP deployment option');
      }

      return checkResult;
    } catch (error) {
      log('MCP plugin installation check failed: %O', getMCPErrorLogMetadata(error));
      return {
        error:
          error instanceof Error
            ? error.message
            : 'Unknown error when checking MCP plugin installation status',
        platform: process.platform,
        success: false,
      };
    }
  }

  private transformMCPToolToLobeAPI = (data: McpTool[]) => {
    return data.map<LobeChatPluginApi>((item) => ({
      // Assuming identifier is the unique name/id
      description: item.description,
      name: item.name,
      parameters: item.inputSchema as ToolManifestSettings,
    }));
  };
}

// Export a singleton instance
export const mcpService = new MCPService();
