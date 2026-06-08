import { type ChatToolPayload } from '@lobechat/types';
import { safeParseJSON } from '@lobechat/utils';
import debug from 'debug';

import { ConnectorToolPermission } from '@/database/schemas';
import { type CloudMCPParams, type StdioMCPParams, type ToolCallContent } from '@/libs/mcp';
import {
  buildBlockedToolResponse,
  getConnectorToolPermission,
} from '@/libs/mcp/connectorPermissionCheck';
import { deviceGateway } from '@/server/services/deviceGateway';
import { contentBlocksToString } from '@/server/services/mcp/contentProcessor';
import {
  DEFAULT_TOOL_RESULT_MAX_LENGTH,
  truncateToolResult,
} from '@/server/utils/truncateToolResult';

import { DiscoverService } from '../discover';
import { type MCPService } from '../mcp';
import { type BuiltinToolsExecutor } from './builtin';
import { classifyToolError } from './errorClassification';
import {
  type ToolExecutionContext,
  type ToolExecutionResult,
  type ToolExecutionResultResponse,
} from './types';

const log = debug('lobe-server:tool-execution-service');

interface ToolExecutionServiceDeps {
  builtinToolsExecutor: BuiltinToolsExecutor;
  mcpService: MCPService;
}

const normalizeExecutionError = (error: unknown, fallbackMessage: string) => {
  const normalized = classifyToolError(error || fallbackMessage);
  const message = fallbackMessage || normalized.message;

  if (error && typeof error === 'object') {
    if (error instanceof Error) {
      return {
        code: normalized.code,
        kind: normalized.kind,
        message: error.message || message,
        name: error.name,
      };
    }

    const plainError = error as Record<string, unknown>;

    return {
      ...plainError,
      code: (plainError.code as string | undefined) || normalized.code,
      kind: normalized.kind,
      message: (plainError.message as string | undefined) || message,
    };
  }

  if (typeof error === 'string') {
    return { code: normalized.code, kind: normalized.kind, message: error };
  }

  return { code: normalized.code, kind: normalized.kind, message };
};

export class ToolExecutionService {
  private builtinToolsExecutor: BuiltinToolsExecutor;
  private mcpService: MCPService;

  constructor({ mcpService, builtinToolsExecutor }: ToolExecutionServiceDeps) {
    this.builtinToolsExecutor = builtinToolsExecutor;
    this.mcpService = mcpService;
  }

  async executeTool(
    payload: ChatToolPayload,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResultResponse> {
    const { identifier, apiName, type } = payload;

    log('Executing tool: %s:%s (type: %s)', identifier, apiName, type);

    // ── Connector tool permission gate (covers ALL paths + qstash) ────────
    // Check before any execution so that disabled tools are blocked universally:
    // Lobehub market skills, Klavis, MCP connectors, and execAgent/qstash alike.
    // needs_approval is handled via humanIntervention in the manifest; we only
    // hard-block 'disabled' here (and needs_approval in headless/qstash context
    // since the manifest's humanIntervention auto-rejects them there already).
    if (context.serverDB && context.userId && identifier && apiName) {
      const permission = await getConnectorToolPermission(
        context.serverDB,
        context.userId,
        identifier,
        apiName,
      );
      if (permission === ConnectorToolPermission.disabled) {
        log('Tool %s:%s is disabled by user — blocking execution', identifier, apiName);
        const blocked = buildBlockedToolResponse(apiName);
        return { ...blocked, executionTime: 0 };
      }
    }
    // ── End permission gate ───────────────────────────────────────────────

    const startTime = Date.now();
    try {
      const typeStr = type as string;
      let data: ToolExecutionResult;
      switch (typeStr) {
        case 'mcp': {
          data = await this.executeMCPTool(payload, context);
          break;
        }

        case 'builtin':
        default: {
          data = await this.builtinToolsExecutor.execute(payload, context);
          break;
        }
      }

      const executionTime = Date.now() - startTime;

      // Truncate result content to prevent context overflow
      // Use agent-specific config if provided, otherwise use default
      const truncatedContent = context.skipResultTruncation
        ? data.content
        : truncateToolResult(data.content, context.toolResultMaxLength);

      // Log if content was truncated
      if (truncatedContent !== data.content) {
        const maxLength = context.toolResultMaxLength ?? DEFAULT_TOOL_RESULT_MAX_LENGTH;
        log(
          'Tool result truncated for %s:%s - original: %d chars, truncated: %d chars (limit: %d)',
          identifier,
          apiName,
          data.content.length,
          truncatedContent.length,
          maxLength,
        );
      }

      if (!data.success) {
        return {
          ...data,
          content: truncatedContent,
          error: normalizeExecutionError(data.error, data.content),
          executionTime,
        };
      }

      return {
        ...data,
        content: truncatedContent,
        executionTime,
      };

      // Handle MCP and other types (default, standalone, markdown, mcp)
    } catch (error) {
      const executionTime = Date.now() - startTime;
      log('Error executing tool %s:%s: %O', identifier, apiName, error);
      const errorMessage = (error as Error).message;

      return {
        content: context.skipResultTruncation ? errorMessage : truncateToolResult(errorMessage),
        error: normalizeExecutionError(error, errorMessage),
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

    log(
      'Calling MCP service with params for: %s:%s (type: %s)',
      identifier,
      apiName,
      mcpParams.type,
    );

    try {
      // Check if this is a cloud MCP endpoint
      if (mcpParams.type === 'cloud') {
        return await this.executeCloudMCPTool(payload, context, mcpParams);
      }

      // Stdio MCP can't run on the cloud server — the binary lives on the
      // user's machine. When a device gateway is configured and a device is
      // active, tunnel the call to that device, which spawns the stdio server
      // locally. Standalone Electron (no gateway) falls through to the
      // in-process MCP service below, where spawning is on the user's machine.
      if (
        mcpParams.type === 'stdio' &&
        deviceGateway.isConfigured &&
        context.activeDeviceId &&
        context.userId
      ) {
        return await this.executeMcpViaDevice(payload, context, mcpParams);
      }

      // For stdio (in-process) / http/sse types, use standard MCP service
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

  /**
   * Execute a stdio MCP tool call on the user's device via the device gateway.
   * Forwards the stdio connection params (command/args/env) so the device can
   * spawn the local MCP server and run the call — something the cloud server
   * cannot do. Callers must ensure `activeDeviceId` and `userId` are set.
   */
  private async executeMcpViaDevice(
    payload: ChatToolPayload,
    context: ToolExecutionContext,
    mcpParams: StdioMCPParams,
  ): Promise<ToolExecutionResult> {
    const { identifier, apiName, arguments: args } = payload;

    log(
      'Executing stdio MCP tool via device: %s:%s (device=%s)',
      identifier,
      apiName,
      context.activeDeviceId,
    );

    const result = await deviceGateway.executeMcpCall(
      {
        apiName,
        arguments: args,
        deviceId: context.activeDeviceId!,
        identifier,
        params: {
          args: mcpParams.args ?? [],
          command: mcpParams.command,
          env: mcpParams.env,
          name: mcpParams.name,
          type: 'stdio',
        },
        userId: context.userId!,
      },
      context.executionTimeoutMs,
    );

    if (!result.success) {
      return {
        content: result.content,
        error: {
          code: 'MCP_DEVICE_EXECUTION_ERROR',
          message: result.error || result.content,
        },
        success: false,
      };
    }

    return {
      content: result.content,
      state: (result.state as Record<string, any>) ?? undefined,
      success: true,
    };
  }

  private async executeCloudMCPTool(
    payload: ChatToolPayload,
    context: ToolExecutionContext,

    _mcpParams: CloudMCPParams,
  ): Promise<ToolExecutionResult> {
    const { identifier, apiName, arguments: args } = payload;

    log('Executing Cloud MCP tool: %s:%s via cloud gateway', identifier, apiName);

    try {
      // Create DiscoverService with user context
      const discoverService = new DiscoverService({
        userInfo: context.userId ? { userId: context.userId } : undefined,
      });

      // Parse arguments
      const apiParams = safeParseJSON(args) || {};

      // Call cloud MCP endpoint via Market API
      // Returns CloudGatewayResponse: { content: ToolCallContent[], isError?: boolean }
      const cloudResult = await discoverService.callCloudMcpEndpoint({
        apiParams,
        identifier,
        toolName: apiName,
      });

      const cloudResultContent = (cloudResult?.content ?? []) as ToolCallContent[];

      // Convert content blocks to string (same as market router does)
      const content = contentBlocksToString(cloudResultContent);
      const state = { ...cloudResult, content: cloudResultContent };

      log('Cloud MCP tool execution successful for: %s:%s', identifier, apiName);

      return {
        content,
        state,
        success: !cloudResult?.isError,
      };
    } catch (error) {
      log('Cloud MCP tool execution failed for %s:%s: %O', identifier, apiName, error);
      return {
        content: (error as Error).message,
        error: {
          code: 'CLOUD_MCP_EXECUTION_ERROR',
          message: (error as Error).message,
        },
        success: false,
      };
    }
  }
}

export * from './types';
