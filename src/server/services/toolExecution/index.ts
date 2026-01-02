import { type ChatToolPayload } from '@lobechat/types';
import debug from 'debug';

import { type MCPService } from '../mcp';
import { type PluginGatewayService } from '../pluginGateway';
import { type BuiltinToolsExecutor } from './builtin';
import { type ToolExecutionContext, type ToolExecutionResult, type ToolExecutionResultResponse } from './types';

const log = debug('lobe-server:tool-execution-service');

interface ToolExecutionServiceDeps {
  builtinToolsExecutor: BuiltinToolsExecutor;
  mcpService: MCPService;
  pluginGatewayService: PluginGatewayService;
}

export class ToolExecutionService {
  private builtinToolsExecutor: BuiltinToolsExecutor;
  private mcpService: MCPService;
  private pluginGatewayService: PluginGatewayService;

  constructor({
    mcpService,
    pluginGatewayService,
    builtinToolsExecutor,
  }: ToolExecutionServiceDeps) {
    this.builtinToolsExecutor = builtinToolsExecutor;
    this.mcpService = mcpService;
    this.pluginGatewayService = pluginGatewayService;
  }

  async executeTool(
    payload: ChatToolPayload,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResultResponse> {
    const { identifier, apiName, type } = payload;

    log('Executing tool: %s:%s (type: %s)', identifier, apiName, type);

    const startTime = Date.now();
    try {
      const typeStr = type as string;
      let data: ToolExecutionResult;
      switch (typeStr) {
        case 'builtin': {
          data = await this.builtinToolsExecutor.execute(payload, context);
          break;
        }

        case 'mcp': {
          data = await this.executeMCPTool(payload, context);
          break;
        }

        default: {
          data = await this.pluginGatewayService.execute(payload, context);

          break;
        }
      }

      const executionTime = Date.now() - startTime;

      return {
        ...data,
        executionTime,
      };

      // Handle MCP and other types (default, standalone, markdown, mcp)
    } catch (error) {
      const executionTime = Date.now() - startTime;
      log('Error executing tool %s:%s: %O', identifier, apiName, error);
      return {
        content: (error as Error).message,
        error: {
          message: (error as Error).message,
        },
        executionTime,
        success: false,
      };
    }
  }

  private async executeMCPTool(
    payload: ChatToolPayload,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const { identifier, apiName, arguments: args } = payload;

    log('Executing MCP tool: %s:%s', identifier, apiName);

    // Get the manifest from context
    const manifest = context.toolManifestMap[identifier];
    if (!manifest) {
      log('Manifest not found for MCP tool: %s', identifier);
      return {
        content: `Manifest not found for tool: ${identifier}`,
        error: {
          code: 'MANIFEST_NOT_FOUND',
          message: `Manifest not found for tool: ${identifier}`,
        },
        success: false,
      };
    }

    // Extract MCP params from manifest (stored in customParams.mcp in LobeTool)
    const mcpParams = (manifest as any).mcpParams;
    if (!mcpParams) {
      log('MCP configuration not found in manifest for: %s ', identifier);
      return {
        content: `MCP configuration not found for tool: ${identifier}, please tell user TRY TO REINSTALL THE MCP PLUGIN`,
        error: {
          code: 'MCP_CONFIG_NOT_FOUND',
          message: `MCP configuration not found for tool: ${identifier}`,
        },
        success: false,
      };
    }

    // Construct MCPClientParams from the mcp config

    log('Calling MCP service with params for: %s:%s', identifier, apiName);

    try {
      // Call the MCP service
      const result = await this.mcpService.callTool({
        argsStr: args,
        clientParams: mcpParams,
        toolName: apiName,
      });

      log('MCP tool execution successful for: %s:%s', identifier, apiName);

      return {
        content: typeof result === 'string' ? result : JSON.stringify(result),
        state: typeof result === 'object' ? result : undefined,
        success: true,
      };
    } catch (error) {
      log('MCP tool execution failed for %s:%s: %O', identifier, apiName, error);
      return {
        content: (error as Error).message,
        error: {
          code: 'MCP_EXECUTION_ERROR',
          message: (error as Error).message,
        },
        success: false,
      };
    }
  }
}

export * from './types';
