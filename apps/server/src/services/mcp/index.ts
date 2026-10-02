import {
  type CheckMcpInstallResult,
  type CustomPluginMetadata,
  type LobeChatPluginApi,
  type ToolManifest,
  type ToolManifestSettings,
} from '@lobechat/types';
import { safeParseJSON } from '@lobechat/utils';
import { type DeploymentOption } from '@lobehub/market-sdk';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
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

import { type ProcessContentBlocksFn } from './contentProcessor';
import { contentBlocksToString } from './contentProcessor';
import { mcpSystemDepsCheckService } from './deps';

const log = debug('lobe-mcp:service');

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

    if (result.isError) {
      return { content, state, success: true };
    }

    return { content, state, success: true };
  }

  private sanitizeForLogging = <T extends Record<string, any>>(obj: T): Omit<T, 'env'> => {
    if (!obj) return obj;

    const { env: _, ...rest } = obj;
    return rest as Omit<T, 'env'>;
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
  ): Promise<T> {
    const loggableParams = this.sanitizeForLogging(params);

    return retry(
      async (bail, attemptNumber) => {
        // Skip cache on retry attempts to drop the stale (dead) session
        const skipCache = attemptNumber > 1;
        log(`${operationName} for params: %O (attempt ${attemptNumber})`, loggableParams);

        try {
          // Keep getClient inside the guarded block: a client initialization
          // failure (bad URL/token, stdio spawn error) is NOT a stale-session
          // error, so it must bail immediately instead of retrying — otherwise
          // we'd repeat auth attempts / respawn stdio commands needlessly.
          const client = await this.getClient(params, skipCache);
          return await operation(client);
        } catch (error) {
          // Only retry for NoValidSessionId errors
          if ((error as Error).message !== 'NoValidSessionId') {
            console.error(`Error ${operationName} for params %O:`, loggableParams, error);
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

    return this.withSessionRetry(clientParams, `calling tool "${toolName}"`, async (client) => {
      log(`Calling tool "${toolName}" with args: %O`, args);

      try {
        // Delegate the call to the MCPClient instance
        const result = await client.callTool(toolName, args); // Pass args directly

        // Use the common processing method
        const processedResult = await MCPService.processToolCallResult(
          result,
          processContentBlocksFn,
        );

        log(`Tool "${toolName}" called successfully, result: %O`, processedResult.state);

        return processedResult;
      } catch (error) {
        // Session errors must bubble up so withSessionRetry can reconnect & retry
        if ((error as Error).message === 'NoValidSessionId') throw error;

        // Tool-level MCP errors are returned as a failed tool result, not thrown
        if (error instanceof McpError) {
          const mcpError = error as McpError;

          return {
            content: mcpError.message,
            error,
            state: {
              content: [{ text: mcpError.message, type: 'text' }],
              isError: true,
            },
            success: false,
          };
        }

        // Other errors propagate; withSessionRetry wraps them as a TRPCError
        throw error;
      }
    });
  }

  // Private method to get or initialize a client based on parameters
  private async getClient(params: MCPClientParams, skipCache = false): Promise<MCPClient> {
    const key = this.serializeParams(params); // Use custom serialization

    if (!skipCache && this.clients.has(key)) {
      return this.clients.get(key)!;
    }

    log(`No cached client found, Initializing new client.`);
    try {
      const client = new MCPClient(params);
      await client.initialize({
        onProgress: (progress) => {
          log(`New client initializing... ${progress.progress}/${progress.total}`);
        },
      }); // Initialization logic should be within MCPClient
      this.clients.set(key, client);
      log(`New client initialized and cached for key: ${key.slice(0, 20)}`);
      return client;
    } catch (error) {
      console.error(`Failed to initialize MCP client:`, error);

      // Preserve complete error information, especially detailed stderr output
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (typeof error === 'object' && !!error && 'data' in error) {
        throw new TRPCError({
          cause: error,
          code: 'SERVICE_UNAVAILABLE',
          message: errorMessage,
        });
      }

      // Log detailed error information for debugging
      log('Detailed initialization error: %O', {
        error: errorMessage,
        params: this.sanitizeForLogging(params),
        stack: error instanceof Error ? error.stack : undefined,
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
          `${identifier} MCP server has ${tools.length} tools, like "${tools[0]?.name}"`,
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
        description:
          metadata?.description ||
          `${identifier} MCP server has ` +
            Object.entries(manifest)
              .filter(([key]) => ['tools', 'prompts', 'resources'].includes(key))
              .map(([key, item]) => `${(item as Array<any>)?.length} ${key}`)
              .join(','),
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
      const loggableInput = {
        deploymentOptions: input.deploymentOptions.map((o) => this.sanitizeForLogging(o)),
      };
      log('Checking MCP plugin installation status: %O', loggableInput);
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

      log('Check completed, best result: %O', bestResult);

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
        log('Configuration required for best deployment option: %O', bestResult.configSchema);
      }

      return checkResult;
    } catch (error) {
      log('Check failed: %O', error);
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
