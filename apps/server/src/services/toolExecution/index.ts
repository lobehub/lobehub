import { type ChatToolPayload } from '@lobechat/types';
import { isLocalOrPrivateUrl, safeParseJSON } from '@lobechat/utils';
import debug from 'debug';

import { ConnectorToolPermission } from '@/database/schemas';
import {
  type CloudMCPParams,
  type HttpMCPClientParams,
  type StdioMCPParams,
  type ToolCallContent,
} from '@/libs/mcp';
import {
  buildBlockedToolResponse,
  getConnectorToolPermission,
} from '@/libs/mcp/connectorPermissionCheck';
import { deviceGateway } from '@/server/services/deviceGateway';
import { getScopedOnlineDevices } from '@/server/services/deviceGateway/scopedDevices';
import { contentBlocksToString } from '@/server/services/mcp/contentProcessor';
import {
  DEFAULT_TOOL_RESULT_MAX_LENGTH,
  truncateToolResult,
} from '@/server/utils/truncateToolResult';

import { DiscoverService } from '../discover';
import { type MCPService } from '../mcp';
import { type BuiltinToolsExecutor } from './builtin';
import { classifyToolError } from './errorClassification';
import { resolveRunWorkspaceId } from './serverRuntimes/resolveWorkspaceScope';
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
    // Lobehub market skills, Composio, MCP connectors, and execAgent/qstash alike.
    // needs_approval is handled via humanIntervention in the manifest; we only
    // hard-block 'disabled' here (and needs_approval in headless/qstash context
    // since the manifest's humanIntervention auto-rejects them there already).
    if (context.serverDB && context.userId && identifier && apiName) {
      const permission = await getConnectorToolPermission(
        context.serverDB,
        context.userId,
        identifier,
        apiName,
        context.workspaceId,
        context.agentId,
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

      // MCP servers only the user's machine can reach must not be called from
      // the cloud: stdio (the binary lives on the user's machine) and
      // localhost / private-network HTTP endpoints (the cloud's fetch can't
      // reach them, #16533). When a device gateway is configured (cloud
      // deployment), such calls MUST tunnel to a device — with no reachable
      // device, fail fast with an actionable error instead of spawning the
      // command / fetching the private URL on the server (the same rule the
      // classic-path guard in connector exec enforces). Standalone Electron /
      // self-host (no gateway) falls through to the in-process MCP service
      // below, which legitimately runs on the user's machine or LAN.
      const isDeviceOnlyMcp =
        mcpParams.type === 'stdio' ||
        (mcpParams.type === 'http' && isLocalOrPrivateUrl(mcpParams.url));
      if (isDeviceOnlyMcp && deviceGateway.isConfigured) {
        const tunnelTarget = context.userId
          ? await this.resolveMcpTunnelTarget(context)
          : undefined;
        if (!tunnelTarget) {
          log('Device-only MCP %s:%s has no reachable device — failing fast', identifier, apiName);
          const message = `MCP server '${identifier}' only your own machine can reach (stdio or local network). No online device was found to run it — open the LobeHub desktop app on the machine that hosts this MCP server, then retry.`;
          return {
            content: message,
            error: { code: 'MCP_DEVICE_UNAVAILABLE', message },
            success: false,
          };
        }
        return await this.executeMcpViaDevice(payload, context, mcpParams, tunnelTarget);
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
   * Resolve which device a device-only MCP call should tunnel to.
   *
   * Prefer the run's plan-routed device. Chat-mode runs, however, carry no
   * device execution plan (`resolveExecutionPlan` returns `kind: 'none'` for
   * chat) even though the user's MCP connectors are still enabled — without a
   * fallback every stdio / local-HTTP tool call in a plain chat would fail.
   * Fall back to the user's most recently active online PERSONAL device —
   * workspace runs get no implicit fallback (see inline comment).
   *
   * Deliberately NOT gated on `context.deviceCapable`: that flag governs the
   * device-TOOL surface (local-system shell/file access). Tunneling an MCP
   * connection the user explicitly installed grants the model no machine
   * access beyond the MCP server itself, so it is treated as connection
   * routing, not device capability.
   */
  private async resolveMcpTunnelTarget(
    context: ToolExecutionContext,
  ): Promise<{ deviceId: string; workspaceId?: string } | undefined> {
    // Workspace devices live under the `workspace:<id>` principal in the
    // gateway, so device lookup AND the tunneled call itself must carry the
    // same scope — resolved the way the local-system/browser device runtimes
    // do (respects a personal-scope active device, recovers the agent's
    // workspace when the run context lost it).
    const workspaceId = await resolveRunWorkspaceId(context);
    if (context.activeDeviceId) return { deviceId: context.activeDeviceId, workspaceId };
    // The implicit fallback is PERSONAL-scope only. In a workspace run the
    // connector may have been authorized by ANOTHER member, and tunneling its
    // params (stdio env / HTTP auth) to the caller's own newest device would
    // hand that member's credentials to a machine they never authorized. With
    // no plan-routed device and no connector→device ownership tie, fail closed
    // (caller surfaces MCP_DEVICE_UNAVAILABLE).
    if (workspaceId) return undefined;
    // The scoped helper (not the raw gateway pool) is mandatory here: it
    // applies device visibility and merges DB state. No serverDB → can't
    // apply visibility → fail closed.
    if (!context.userId || !context.serverDB) return undefined;
    try {
      const devices = await getScopedOnlineDevices(context.serverDB, context.userId, undefined);
      // Already sorted online-first / most-recently-active; drop offline rows.
      // Only the desktop app handles `mcp` tool calls — the CLI's
      // tool_call_request handler ignores `toolCall.type`/`params`, so a
      // device whose only live connection is `lh connect` would fail the call.
      const newest = devices.find(
        (d) =>
          d.online &&
          d.channels?.some((c) => c.channel === 'desktop' || c.channel === 'desktop-dev'),
      );
      return newest ? { deviceId: newest.deviceId, workspaceId: undefined } : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Execute an MCP tool call on the user's device via the device gateway.
   * Forwards the connection params so the device can reach the MCP server —
   * something the cloud server cannot do: stdio spawns the local binary,
   * http covers localhost / LAN endpoints only the device's network sees.
   * Credentials for http are decrypted server-side and forwarded verbatim
   * (narrowed to the token fields — never the OAuth client secret / refresh
   * token). Callers must ensure `userId` is set and pass a resolved tunnel
   * target (device + workspace scope).
   */
  private async executeMcpViaDevice(
    payload: ChatToolPayload,
    context: ToolExecutionContext,
    mcpParams: StdioMCPParams | HttpMCPClientParams,
    target: { deviceId: string; workspaceId?: string },
  ): Promise<ToolExecutionResult> {
    const { identifier, apiName, arguments: args } = payload;

    log(
      'Executing %s MCP tool via device: %s:%s (device=%s, workspace=%s)',
      mcpParams.type,
      identifier,
      apiName,
      target.deviceId,
      target.workspaceId ?? 'personal',
    );

    const result = await deviceGateway.executeMcpCall(
      {
        apiName,
        arguments: args,
        deviceId: target.deviceId,
        identifier,
        params:
          mcpParams.type === 'stdio'
            ? {
                args: mcpParams.args ?? [],
                command: mcpParams.command,
                env: mcpParams.env,
                name: mcpParams.name,
                type: 'stdio',
              }
            : {
                // AuthConfig also carries OAuth client secrets / refresh tokens —
                // forward only what the device's MCP client needs to authenticate.
                auth: mcpParams.auth
                  ? {
                      accessToken: mcpParams.auth.accessToken,
                      token: mcpParams.auth.token,
                      type: mcpParams.auth.type,
                    }
                  : undefined,
                headers: mcpParams.headers,
                name: mcpParams.name,
                type: 'http',
                url: mcpParams.url,
              },
        userId: context.userId!,
        // Address the workspace device pool when the run is workspace-scoped —
        // omitting this would route the call to the personal pool and miss an
        // online workspace-shared device.
        workspaceId: target.workspaceId,
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
