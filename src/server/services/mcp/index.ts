import { CheckMcpInstallResult, CustomPluginMetadata } from '@lobechat/types';
import { safeParseJSON } from '@lobechat/utils';
import { LobeChatPluginApi, LobeChatPluginManifest, PluginSchema } from '@lobehub/chat-plugin-sdk';
import { DeploymentOption } from '@lobehub/market-sdk';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { TRPCError } from '@trpc/server';
import debug from 'debug';

import {
  MCPClient,
  MCPClientParams,
  McpPrompt,
  McpResource,
  McpTool,
  StdioMCPParams,
} from '@/libs/mcp';

import { ProcessContentBlocksFn, contentBlocksToString } from './contentProcessor';
import { mcpSystemDepsCheckService } from './deps';

const log = debug('lobe-mcp:service');

// Removed MCPConnection interface as it's no longer needed

export class MCPService {
  // Store instances of the custom MCPClient, keyed by serialized MCPClientParams
  private clients: Map<string, MCPClient> = new Map();

  private sanitizeForLogging = <T extends Record<string, any>>(obj: T): Omit<T, 'env'> => {
    if (!obj) return obj;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { env: _, ...rest } = obj;
    return rest as Omit<T, 'env'>;
  };

  // --- MCP Interaction ---

  // listTools now accepts MCPClientParams
  async listTools(
    params: MCPClientParams,
    { retryTime, skipCache }: { retryTime?: number; skipCache?: boolean } = {},
  ): Promise<LobeChatPluginApi[]> {
    const client = await this.getClient(params, skipCache); // Get client using params
    const loggableParams = this.sanitizeForLogging(params);
    log(`Listing tools using client for params: %O`, loggableParams);

    try {
      const result = await client.listTools();
      log(
        `Tools listed successfully for params: %O, result count: %d`,
        loggableParams,
        result.length,
      );
      return result.map<LobeChatPluginApi>((item) => ({
        // Assuming identifier is the unique name/id
        description: item.description,
        name: item.name,
        parameters: item.inputSchema as PluginSchema,
      }));
    } catch (error) {
      let nextReTryTime = retryTime || 0;

      if ((error as Error).message === 'NoValidSessionId' && nextReTryTime <= 3) {
        if (!nextReTryTime) {
          nextReTryTime = 1;
        } else {
          nextReTryTime += 1;
        }

        return this.listTools(params, { retryTime: nextReTryTime, skipCache: true });
      }

      console.error(`Error listing tools for params %O:`, loggableParams, error);
      // Propagate a TRPCError for better handling upstream
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: `Error listing tools from MCP server: ${(error as Error).message}`,
      });
    }
  }

  // listTools now accepts MCPClientParams
  async listRawTools(params: MCPClientParams): Promise<McpTool[]> {
    const client = await this.getClient(params); // Get client using params
    const loggableParams = this.sanitizeForLogging(params);
    log(`Listing tools using client for params: %O`, loggableParams);

    try {
      const result = await client.listTools();
      log(
        `Tools listed successfully for params: %O, result count: %d`,
        loggableParams,
        result.length,
      );
      return result;
    } catch (error) {
      console.error(`Error listing tools for params %O:`, loggableParams, error);
      // Propagate a TRPCError for better handling upstream
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: `Error listing tools from MCP server: ${(error as Error).message}`,
      });
    }
  }

  // listResources now accepts MCPClientParams
  async listResources(params: MCPClientParams): Promise<McpResource[]> {
    const client = await this.getClient(params); // Get client using params
    const loggableParams = this.sanitizeForLogging(params);
    log(`Listing resources using client for params: %O`, loggableParams);

    try {
      const result = await client.listResources();
      log(
        `Resources listed successfully for params: %O, result count: %d`,
        loggableParams,
        result.length,
      );
      return result;
    } catch (error) {
      console.error(`Error listing resources for params %O:`, loggableParams, error);
      // Propagate a TRPCError for better handling upstream
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: `Error listing resources from MCP server: ${(error as Error).message}`,
      });
    }
  }

  // listPrompts now accepts MCPClientParams
  async listPrompts(params: MCPClientParams): Promise<McpPrompt[]> {
    const client = await this.getClient(params); // Get client using params
    const loggableParams = this.sanitizeForLogging(params);
    log(`Listing prompts using client for params: %O`, loggableParams);

    try {
      const result = await client.listPrompts();
      log(
        `Prompts listed successfully for params: %O, result count: %d`,
        loggableParams,
        result.length,
      );
      return result;
    } catch (error) {
      console.error(`Error listing prompts for params %O:`, loggableParams, error);
      // Propagate a TRPCError for better handling upstream
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: `Error listing prompts from MCP server: ${(error as Error).message}`,
      });
    }
  }

  // callTool now accepts an object with clientParams, toolName, argsStr, and processContentBlocks
  async callTool(
    options: {
      argsStr: any;
      clientParams: MCPClientParams;
      processContentBlocks?: ProcessContentBlocksFn;
      toolName: string;
    },
    { retryTime, skipCache }: { retryTime?: number; skipCache?: boolean } = {},
  ): Promise<any> {
    const { clientParams, toolName, argsStr, processContentBlocks } = options;

    const client = await this.getClient(clientParams, skipCache); // Get client using params

    const args = safeParseJSON(argsStr);
    const loggableParams = this.sanitizeForLogging(clientParams);

    log(
      `Calling tool "${toolName}" using client for params: %O with args: %O`,
      loggableParams,
      args,
    );

    try {
      // Delegate the call to the MCPClient instance
      const result = await client.callTool(toolName, args); // Pass args directly

      // Process content blocks (upload images, etc.)
      const newContent =
        result.isError || !processContentBlocks
          ? result.content
          : await processContentBlocks(result.content);

      // Convert content blocks to string
      const content = contentBlocksToString(newContent);

      const state = { ...result, content: newContent };

      log(
        `Tool "${toolName}" called successfully for params: %O, result: %O`,
        loggableParams,
        state,
      );

      if (result.isError) return { content, state, success: true };

      return { content, state, success: true };
    } catch (error) {
      // Retry on session-related errors (same pattern as listTools)
      let nextReTryTime = retryTime || 0;
      const errMsg = (error as Error).message || '';
      const isSessionError =
        errMsg === 'NoValidSessionId' ||
        errMsg.includes('No valid session ID') ||
        errMsg.includes('Server not initialized');

      if (isSessionError && nextReTryTime <= 3) {
        if (!nextReTryTime) {
          nextReTryTime = 1;
        } else {
          nextReTryTime += 1;
        }

        log(`Session error calling tool "${toolName}", retrying (attempt ${nextReTryTime}/3)...`);
        return this.callTool(options, { retryTime: nextReTryTime, skipCache: true });
      }

      if (error instanceof McpError) {
        const mcpError = error as McpError;

        return {
          content: mcpError.message,
          error: error,
          state: {
            content: [{ text: mcpError.message, type: 'text' }],
            isError: true,
          },
          success: false,
        };
      }

      console.error(
        `Error calling tool "${toolName}" for params %O:`,
        this.sanitizeForLogging(clientParams),
        error,
      );
      // Propagate a TRPCError
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: `Error calling tool "${toolName}" on MCP server: ${(error as Error).message}`,
      });
    }
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

      // 保留完整的错误信息，特别是详细的 stderr 输出
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (typeof error === 'object' && !!error && 'data' in error) {
        throw new TRPCError({
          cause: error,
          code: 'SERVICE_UNAVAILABLE',
          message: errorMessage,
        });
      }

      // 记录详细的错误信息用于调试
      log('Detailed initialization error: %O', {
        error: errorMessage,
        params: this.sanitizeForLogging(params),
        stack: error instanceof Error ? error.stack : undefined,
      });

      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: errorMessage, // 直接使用完整的错误信息
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
  ): Promise<LobeChatPluginManifest> {
    const mcpParams = { name: identifier, type: 'http' as const, url };

    // 如果有认证信息，添加到参数中
    if (auth) {
      (mcpParams as any).auth = auth;
    }

    // 如果有 headers 信息，添加到参数中
    if (headers) {
      (mcpParams as any).headers = headers;
    }

    const tools = await this.listTools(mcpParams);

    return {
      api: tools,
      identifier,
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
  ): Promise<LobeChatPluginManifest> {
    const client = await this.getClient({
      args: params.args,
      command: params.command,
      env: params.env,
      name: params.name,
      type: 'stdio',
    }); // Get client using params

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
      // TODO: temporary
      type: 'mcp' as any,
    } as LobeChatPluginManifest;
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

      // 检查每个部署选项
      for (const option of input.deploymentOptions) {
        // 使用系统依赖检查服务检查部署选项
        const result = await mcpSystemDepsCheckService.checkDeployOption(option);
        results.push(result);
      }

      // 找出推荐的或第一个可安装的选项
      const recommendedResult = results.find((r) => r.isRecommended && r.allDependenciesMet);
      const firstInstallableResult = results.find((r) => r.allDependenciesMet);

      // 返回推荐的结果，或第一个可安装的结果，或第一个结果
      const bestResult = recommendedResult || firstInstallableResult || results[0];

      log('Check completed, best result: %O', bestResult);

      // 构造返回结果，确保包含配置检查信息
      const checkResult: CheckMcpInstallResult = {
        ...bestResult,
        allOptions: results,
        platform: process.platform,
        success: true,
      };

      // 如果最佳结果需要配置，确保在顶层设置相关字段
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
      parameters: item.inputSchema as PluginSchema,
    }));
  };
}

// Export a singleton instance
export const mcpService = new MCPService();
