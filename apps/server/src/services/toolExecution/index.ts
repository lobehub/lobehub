import { BRANDING_NAME } from '@lobechat/business-const';
import { McpInputRequiredError } from '@lobechat/mcp-elicitation';
import { DEFAULT_TOOL_RESULT_MAX_LENGTH, truncateToolResult } from '@lobechat/prompts/toolResult';
import {
  type ChatToolPayload,
  connectorIdentifierCandidates,
  type DeviceClient,
} from '@lobechat/types';
import { isDeviceOnlyMcpEndpoint, shouldConnectViaDevice } from '@lobechat/utils/mcpEndpoint';
import type { ElicitRequestParams } from '@modelcontextprotocol/client';
import debug from 'debug';

import { ConnectorModel } from '@/database/models/connector';
import { ConnectorToolModel } from '@/database/models/connectorTool';
import { MessageModel } from '@/database/models/message';
import { ConnectorToolPermission } from '@/database/schemas';
import { type CloudMCPParams, type HttpMCPClientParams, type StdioMCPParams } from '@/libs/mcp';
import {
  buildBlockedToolResponse,
  getConnectorToolPermission,
} from '@/libs/mcp/connectorPermissionCheck';
import { isMCPSSRFBlockedError } from '@/libs/mcp/ssrf';
import { createMCPError } from '@/libs/mcp/types';
import { signMcpDeviceGrant } from '@/libs/trpc/utils/internalJwt';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { resolveLinkedCall } from '@/server/services/connector/links';
import { buildConnectorMcpParams } from '@/server/services/connector/sync';
import { deviceGateway } from '@/server/services/deviceGateway';
import {
  resolveMcpClientKinds,
  resolveMcpDeviceFeatures,
} from '@/server/services/deviceGateway/deviceChannels';
import { resolveDeviceDispatchAuthorizationFailure } from '@/server/services/deviceGateway/dispatchAuthorization';
import { relayDeviceViewState } from '@/server/services/mcp/deviceView';
import { isMcpAppsEnabled } from '@/server/services/mcp/featureGate';

import { type MCPService } from '../mcp';
import { callCloudMcpTool, runtimeCloudMcpCaller } from '../mcp/cloudTool';
import {
  findPersonalMcpDevice,
  MCP_BOUND_DEVICE_UNAVAILABLE,
  MCP_DEVICE_UNAVAILABLE,
  McpBoundDeviceUnavailableError,
  mcpBoundDeviceUnavailableMessage,
  mcpDeviceUnavailableMessage,
  resolveBoundMcpDevice,
  toGatewayMcpParams,
} from '../mcp/deviceTunnel';
import { mcpConnectionBinding } from '../mcp/elicitation/binding';
import {
  type McpCallIdentity,
  type McpElicitationExpiry,
  McpElicitationService,
} from '../mcp/elicitation/McpElicitationService';
import type { McpElicitationRuntime } from '../mcp/elicitation/resume';
import { type BuiltinToolsExecutor } from './builtin';
import { classifyToolError, getToolAccessDeniedError } from './errorClassification';
import { buildMcpAuthorizationErrorContent, isMcpAuthorizationError } from './mcpAuthError';
import { resolveRunWorkspaceId } from './serverRuntimes/resolveWorkspaceScope';
import { withoutDeviceReplay } from './serverRuntimes/withoutDeviceReplay';
import {
  type ToolExecutionContext,
  type ToolExecutionResult,
  type ToolExecutionResultResponse,
} from './types';

const log = debug('lobe-server:tool-execution-service');

/** The device a device-only MCP call runs on, and which of its clients runs it. */
interface McpTunnelTarget {
  clientKinds: DeviceClient[];
  deviceId: string;
  workspaceId?: string;
}

interface ToolExecutionServiceDeps {
  builtinToolsExecutor: BuiltinToolsExecutor;
  mcpRuntime?: McpElicitationRuntime;
  mcpService: MCPService;
  onMcpElicitationExpired?: McpElicitationExpiry;
}

/**
 * Hard bound on the `error.message` of a failed tool call. The (already
 * truncated) `content` is what the LLM reads; the error is metadata, so it
 * never needs the full payload — and an unbounded one is dangerous: a tool
 * that fails with megabytes of output (e.g. `rm -rf` on a read-only sandbox
 * FS, one `cannot remove` line per file) rides the step's `nextContext` into
 * the QStash publish body and blows the provider's 10 MB message quota, which
 * fails the whole operation at the step boundary instead of just that one tool
 * call. Deliberately NOT subject to `skipResultTruncation` — that opt-out is
 * about the LLM context budget, this is a transport safety bound.
 */
const TOOL_ERROR_MESSAGE_MAX_LENGTH = 4000;

const clampErrorMessage = (message: string | undefined): string | undefined =>
  message === undefined ? undefined : truncateToolResult(message, TOOL_ERROR_MESSAGE_MAX_LENGTH);

const normalizeExecutionError = (error: unknown, fallbackMessage: string) => {
  const normalized = classifyToolError(error || fallbackMessage);
  // Classification reads the raw error above; only the carried copy is clamped.
  const message = clampErrorMessage(fallbackMessage || normalized.message);

  if (error && typeof error === 'object') {
    if (error instanceof Error) {
      return {
        code: normalized.code,
        kind: normalized.kind,
        message: clampErrorMessage(error.message) || message,
        name: error.name,
      };
    }

    const plainError = error as Record<string, unknown>;

    return {
      ...plainError,
      code: (plainError.code as string | undefined) || normalized.code,
      // A runtime may know that side effects already happened; retry keywords
      // must not override its explicit refusal to replay the operation.
      kind: plainError.kind === 'stop' ? 'stop' : normalized.kind,
      message: clampErrorMessage(plainError.message as string | undefined) || message,
    };
  }

  if (typeof error === 'string') {
    return { code: normalized.code, kind: normalized.kind, message: clampErrorMessage(error) };
  }

  return { code: normalized.code, kind: normalized.kind, message };
};

/**
 * Readable text for a thrown tool failure. Model runtimes reject with plain
 * objects (e.g. `{ errorType: 'InsufficientBudgetForModel', error: { message } }`)
 * that have no top-level `message`; reading only `.message` turned those into
 * an undefined tool result, which the model then saw as `<empty_content>`.
 */
const getThrownErrorText = (error: unknown): string => {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message || error.name;
  if (!error || typeof error !== 'object') return String(error);

  const raw = error as {
    error?: { message?: unknown };
    errorType?: unknown;
    message?: unknown;
    type?: unknown;
  };
  const message = [raw.message, raw.error?.message].find(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
  const errorType = [raw.errorType, raw.type].find(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );

  if (message && errorType) return `${errorType}: ${message}`;
  if (message || errorType) return (message || errorType)!;

  try {
    return JSON.stringify(error);
  } catch {
    return 'Unknown tool execution error';
  }
};

/**
 * What the model reads of a server MCP call. A result with an MCP App view
 * gives its text only: MCP Apps keeps `structuredContent` and `_meta` for the
 * view, out of model context. Any other result (no view, an error, a failed
 * view lookup) keeps its serialized form, `structuredContent` included, but
 * never `_meta`: protocol metadata, where an Apps-aware server keeps what only
 * its views may see.
 */
const toModelContent = (result: any): string => {
  if (result?.state?.mcpApp) return result.content;
  if (!result?.state || typeof result.state !== 'object') return JSON.stringify(result);

  const { _meta, ...state } = result.state;
  return JSON.stringify({ ...result, state });
};

export class ToolExecutionService {
  private builtinToolsExecutor: BuiltinToolsExecutor;
  private mcpService: MCPService;
  private onMcpElicitationExpired?: McpElicitationExpiry;
  private mcpRuntime?: McpElicitationRuntime;

  constructor({
    mcpService,
    builtinToolsExecutor,
    onMcpElicitationExpired,
    mcpRuntime,
  }: ToolExecutionServiceDeps) {
    this.builtinToolsExecutor = builtinToolsExecutor;
    this.mcpService = mcpService;
    this.onMcpElicitationExpired = onMcpElicitationExpired;
    this.mcpRuntime = mcpRuntime;
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
        { agentId: context.agentId, topicId: context.topicId },
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

        default: {
          data = await this.builtinToolsExecutor.execute(payload, context);
          break;
        }
      }

      const executionTime = Date.now() - startTime;

      const denial = !data.success
        ? getToolAccessDeniedError(data.errorData ?? data.error, data.content)
        : undefined;
      if (denial) {
        data = { ...data, content: JSON.stringify({ error: denial }), error: denial };
      }

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
          error: normalizeExecutionError(data.errorData ?? data.error, data.content),
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
      const errorMessage = getThrownErrorText(error);
      const denial = getToolAccessDeniedError(error, errorMessage);
      const content = denial ? JSON.stringify({ error: denial }) : errorMessage;

      return {
        content: context.skipResultTruncation ? content : truncateToolResult(content),
        error: denial || normalizeExecutionError(error, errorMessage),
        executionTime,
        success: false,
      };
    }
  }

  private async executeMCPTool(
    payload: ChatToolPayload,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const { identifier, apiName } = payload;
    let args = payload.arguments;

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
    let mcpParams = (manifest as any).mcpParams;
    let linkName: string | undefined;
    let mcpConnectorAccount: { connectorId: string; linkId?: string } | undefined;
    // A connector's result may keep the MCP App view a device names: the
    // connector routes read the view and run its calls back on that device
    let relaysView = false;
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

    const isDeviceOnlyMcp = isDeviceOnlyMcpEndpoint(mcpParams);

    // Agent Share visitor runs execute with the CREATOR's identity, so a
    // device-only MCP would access the creator's device or private network
    // on a visitor's behalf — allowed only under the share's device grant.
    // The tool-set gate already drops these manifests
    // (`applyShareGateToToolSet`); this is the unbypassable dispatch-site
    // check, mirroring `isShareBlockedBuiltinDispatch`.
    if (context.agentShareVisitor && !context.agentShareVisitor.canUseDevice && isDeviceOnlyMcp) {
      log('Share gate blocked device-only MCP dispatch: %s:%s', identifier, apiName);
      const message = `MCP server '${identifier}' runs on the agent owner's own machine and is not available in shared conversations.`;
      return {
        content: message,
        error: { code: 'SHARE_GATE_BLOCKED', message },
        success: false,
      };
    }

    const elicitationService =
      context.serverDB && context.userId && context.operationId && context.assistantMessageId
        ? new McpElicitationService(
            context.serverDB,
            context.userId,
            context.workspaceId,
            this.onMcpElicitationExpired,
            this.mcpRuntime,
          )
        : undefined;
    const identity: McpCallIdentity | undefined = elicitationService
      ? {
          apiName,
          assistantMessageId: context.assistantMessageId!,
          identifier,
          operationId: context.operationId!,
          toolCallId: payload.id,
          toolMessageId: context.toolMessageId,
        }
      : undefined;
    const deadline = Date.now() + (context.executionTimeoutMs ?? 60_000);
    let toolMessageId = context.toolMessageId;
    try {
      if (
        (manifest as { connectorReauthorizationRequired?: boolean })
          .connectorReauthorizationRequired
      ) {
        throw createMCPError('AUTHORIZATION_ERROR', 'Reconnect this connector to continue.');
      }
      const marker = (manifest as { connectorLinks?: { connectorId: string; param: string } })
        .connectorLinks;
      // A connector row's manifest (`manifest.connector`) was built at
      // discovery with that row's endpoint and credentials. The row may since
      // have left this conversation's scope (made private, disabled, deleted):
      // every call resolves it again, in the run's conversation, and runs only
      // while the tool prefix still names that same row.
      const rowRef = (manifest as { connector?: { id: string } }).connector;
      relaysView = !!(rowRef || marker);
      if (rowRef || marker) {
        if (!context.serverDB || !context.userId)
          throw new Error(
            'Connector account resolution requires an authenticated execution context',
          );
        const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
        const workspaceId = await resolveRunWorkspaceId(context);
        const connectorModel = new ConnectorModel(
          context.serverDB,
          context.userId,
          workspaceId,
          gateKeeper,
        );
        // The marker rides in a manifest, and a plugin row can carry any
        // manifest. Only the connector this call's identifier resolves to for
        // the run (the one the permission gate checked) may lend its accounts,
        // and only to a tool it serves and has not disabled. It resolves in the
        // run's conversation, as discovery did: a private agent's own topic
        // admits its owner's private and personal rows, each a tool set of its
        // own, so the row is the one this tool prefix names.
        const connector = (
          await connectorModel.resolveToolSets(
            { agentId: context.agentId, topicId: context.topicId },
            connectorIdentifierCandidates(identifier),
          )
        ).find((row) => row.toolIdentifier === identifier);
        const expectedId = marker?.connectorId ?? rowRef?.id;
        if (!connector || connector.id !== expectedId || !connector.isEnabled)
          throw new Error(
            'Connector is no longer available. Ask the user to connect an account in Settings > Connectors.',
          );
        if (marker) {
          const tool = // A run model reads the tools of the owner's personal row too
            (
              await new ConnectorToolModel(context.serverDB, context.userId, workspaceId, {
                agentRun: true,
              }).queryByConnector(connector.id)
            ).find((item) => item.toolName === apiName);
          if (!tool) throw new Error(`Connector '${identifier}' has no tool named '${apiName}'.`);
          if (tool.permission === ConnectorToolPermission.disabled)
            return buildBlockedToolResponse(apiName);
          const currentEndpoint = buildConnectorMcpParams({ ...connector, credentials: null });
          if (
            context.agentShareVisitor &&
            !context.agentShareVisitor.canUseDevice &&
            isDeviceOnlyMcpEndpoint(currentEndpoint)
          ) {
            const message = `MCP server '${identifier}' runs on the agent owner's own machine and is not available in shared conversations.`;
            return {
              content: message,
              error: { code: 'SHARE_GATE_BLOCKED', message },
              success: false,
            };
          }
          const resolved = await resolveLinkedCall(
            {
              connector,
              argsStr: args,
              param: marker.param,
              isShareVisitor: !!context.agentShareVisitor,
            },
            { connectorModel },
          );
          args = resolved.argsStr;
          payload = { ...payload, arguments: args };
          linkName = resolved.linkName;
          if (resolved.linkId)
            mcpConnectorAccount = { connectorId: connector.id, linkId: resolved.linkId };
          mcpParams = buildConnectorMcpParams(resolved.connector);
        }
      }
      // Check if this is a cloud MCP endpoint
      if (mcpParams.type === 'cloud') {
        return await this.executeCloudMCPTool(payload, context, mcpParams);
      }

      if (elicitationService && identity) {
        const ensuredMessageId = await elicitationService.ensureToolMessage(identity);
        toolMessageId = ensuredMessageId;
        await elicitationService.messages.updatePluginState(ensuredMessageId, {
          mcpInvocationDeadline: deadline,
        });
      }

      // Stdio must run on the user's own device. Without a configured gateway or a
      // reachable device, fail instead of executing the command on the server.
      // HTTP the user set to connect through their device, or a private one,
      // also uses the device when a gateway is configured, while self-hosted
      // servers without one keep connecting in-process.
      if (
        shouldConnectViaDevice(mcpParams, { deviceGatewayConfigured: deviceGateway.isConfigured })
      ) {
        if (!deviceGateway.isConfigured) {
          const message = `MCP server '${identifier}' uses stdio and must run on your own device, not in the cloud, but this server's device gateway is not configured. Configure a device gateway on the server, then open the ${BRANDING_NAME} desktop app or run \`lh connect\` on the machine that hosts this MCP server, and retry.`;
          return {
            content: message,
            toolMessageId,
            error: { code: 'MCP_GATEWAY_NOT_CONFIGURED', message },
            success: false,
          };
        }

        // A server bound to a device runs there and nowhere else: when that
        // device can't run it, the call fails with the reason instead of
        // moving to the run's device or another of the user's.
        if (mcpParams.boundDevice) {
          const bound = await this.resolveBoundMcpTunnelTarget(context, mcpParams);
          if ('error' in bound) {
            log('Bound MCP %s:%s cannot run on its device — %s', identifier, apiName, bound.error);
            return {
              content: bound.error,
              toolMessageId,
              error: { code: MCP_BOUND_DEVICE_UNAVAILABLE, message: bound.error },
              success: false,
            };
          }
          const result = await this.executeMcpViaDevice(
            payload,
            { ...context, toolMessageId },
            mcpParams,
            bound,
            relaysView,
          );
          return { ...result, toolMessageId: result.toolMessageId ?? toolMessageId };
        }

        const tunnelTarget = context.userId
          ? await this.resolveMcpTunnelTarget(context)
          : undefined;
        if (!tunnelTarget) {
          log('Device-only MCP %s:%s has no reachable device — failing fast', identifier, apiName);
          const message = mcpDeviceUnavailableMessage(identifier);
          return {
            content: message,
            toolMessageId,
            error: { code: MCP_DEVICE_UNAVAILABLE, message },
            success: false,
          };
        }
        const result = await this.executeMcpViaDevice(
          payload,
          { ...context, toolMessageId },
          mcpParams,
          tunnelTarget,
          relaysView,
        );
        result.toolMessageId ??= toolMessageId;
        if (!result.success && linkName) {
          // Device transports may serialize a provider error to plain text.
          // Preserve its meaning while retaining the selected account boundary.
          return {
            ...result,
            content: `The call using account '${linkName}' failed. Do not switch to another account without the user's consent. ${result.content}`,
          };
        }
        return result;
      }

      // HTTP MCP endpoints can execute through the server-side MCP service.
      const result = await this.mcpService.callTool({
        argsStr: args,
        clientParams: mcpParams,
        mcpApps: await isMcpAppsEnabled(context.userId),
        toolName: apiName,
        elicitation: {
          scope: JSON.stringify([context.userId, context.workspaceId]),
          signal: context.abortSignal
            ? AbortSignal.any([
                context.abortSignal,
                AbortSignal.timeout(Math.max(1, deadline - Date.now())),
              ])
            : AbortSignal.timeout(Math.max(1, deadline - Date.now())),
          timeoutMs: Math.max(1, deadline - Date.now()),
          continuation: context.mcpContinuation,
          host:
            elicitationService && identity
              ? {
                  request: async (request, requestContext) => {
                    return elicitationService
                      .createLegacyHost({ ...identity, toolMessageId }, deadline)
                      .request(request, requestContext);
                  },
                }
              : undefined,
        },
      });

      log('MCP tool execution completed for: %s:%s', identifier, apiName);

      return {
        content: typeof result === 'string' ? result : toModelContent(result),
        ...(result?.success === false
          ? {
              error: {
                code: 'MCP_TOOL_ERROR',
                kind: 'stop',
                message: result.error?.message ?? result.content,
              },
            }
          : {}),
        state: typeof result === 'object' ? result : undefined,
        ...(toolMessageId && { toolMessageId }),
        success: result?.success !== false,
      };
    } catch (error) {
      if (error instanceof McpInputRequiredError && elicitationService && identity) {
        const entries = Object.entries(error.checkpoint.inputRequired.inputRequests ?? {});
        const requests: Record<string, ElicitRequestParams> = Object.fromEntries(
          entries.map(([key, request]) => [key, request.params as ElicitRequestParams]),
        );
        const pending = await elicitationService.open(identity, {
          checkpoint: error.checkpoint,
          connectionBinding: mcpConnectionBinding(mcpParams, mcpConnectorAccount),
          deadline,
          legacy: false,
          requests,
        });
        return {
          content: '',
          deferred: true,
          state: { status: 'pending', toolMessageId: pending.toolMessageId },
          success: true,
          toolMessageId: pending.toolMessageId,
        };
      }
      log('MCP tool execution failed for %s:%s: %O', identifier, apiName, error);
      const existingMessageId =
        toolMessageId ??
        (elicitationService && identity
          ? await elicitationService.messages.findToolMessageIdByToolCallId(
              identity.toolCallId,
              identity.assistantMessageId,
            )
          : undefined);
      if (isMcpAuthorizationError(error)) {
        const content = buildMcpAuthorizationErrorContent(identifier, {
          isShareVisitor: !!context.agentShareVisitor,
          linkName,
        });
        return {
          content,
          toolMessageId: existingMessageId ?? undefined,
          error: { code: 'UNAUTHORIZED', message: (error as Error).message },
          success: false,
        };
      }
      // The server's SSRF policy refused the MCP server address: a configuration
      // error with its own code, so the reason stays visible to the user.
      if (isMCPSSRFBlockedError(error)) {
        const message = (error as Error).message;
        return {
          content: message,
          error: { code: 'MCP_SSRF_BLOCKED', kind: 'stop', message },
          toolMessageId: existingMessageId ?? undefined,
          success: false,
        };
      }
      return {
        content: (error as Error).message,
        ...(existingMessageId && { toolMessageId: existingMessageId }),
        error: {
          code: 'MCP_EXECUTION_ERROR',
          kind: 'stop',
          message: (error as Error).message,
        },
        success: false,
      };
    }
  }

  /**
   * The device a bound MCP server's call tunnels to: always the bound one, in
   * the pool the binding names (the connector's workspace, or its owner's
   * personal devices), never the run's. `error` explains why it can't run there.
   */
  private async resolveBoundMcpTunnelTarget(
    context: ToolExecutionContext,
    mcpParams: StdioMCPParams | HttpMCPClientParams,
  ): Promise<McpTunnelTarget | { error: string }> {
    const binding = mcpParams.boundDevice!;
    if (!context.userId || !context.serverDB) {
      return { error: mcpBoundDeviceUnavailableMessage(mcpParams.name, 'not_found') };
    }
    try {
      const target = await resolveBoundMcpDevice({
        binding,
        identifier: mcpParams.name,
        serverDB: context.serverDB,
        userId: context.userId,
      });
      return { ...target, workspaceId: binding.workspaceId };
    } catch (error) {
      if (error instanceof McpBoundDeviceUnavailableError) return { error: error.message };
      throw error;
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
  ): Promise<McpTunnelTarget | undefined> {
    // Workspace devices live under the `workspace:<id>` principal in the
    // gateway, so device lookup AND the tunneled call itself must carry the
    // same scope — resolved the way the local-system/browser device runtimes
    // do (respects a personal-scope active device, recovers the agent's
    // workspace when the run context lost it).
    const workspaceId = await resolveRunWorkspaceId(context);
    if (context.activeDeviceId) {
      // The desktop app and an `lh connect` that reports MCP support run the
      // call; a device whose only client is an older CLI cannot. Such an
      // active device is skipped: personal runs fall through to the newest
      // capable device below, workspace runs fail closed.
      const clientKinds =
        context.userId !== undefined
          ? await resolveMcpClientKinds(context.userId, context.activeDeviceId, workspaceId)
          : ['desktop' as const];
      if (clientKinds) return { clientKinds, deviceId: context.activeDeviceId, workspaceId };
      log('Active device %s cannot run MCP calls; not tunneling to it', context.activeDeviceId);
    }
    // The implicit fallback is PERSONAL-scope only. In a workspace run the
    // connector may have been authorized by ANOTHER member, and tunneling its
    // params (stdio env / HTTP auth) to the caller's own newest device would
    // hand that member's credentials to a machine they never authorized. With
    // no plan-routed device and no connector→device ownership tie, fail closed
    // (caller surfaces MCP_DEVICE_UNAVAILABLE).
    if (workspaceId) return undefined;
    // The scoped device lookup (not the raw gateway pool) is mandatory here: it
    // applies device visibility and merges DB state. No serverDB → can't
    // apply visibility → fail closed.
    if (!context.userId || !context.serverDB) return undefined;
    const device = await findPersonalMcpDevice(context.serverDB, context.userId);
    return device
      ? { clientKinds: device.clientKinds, deviceId: device.deviceId, workspaceId: undefined }
      : undefined;
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
   *
   * `relaysView`: a connector's call, whose result may keep the MCP App view
   * the device names (see `relayDeviceViewState`) while the user's `mcp_apps`
   * flag is on and the device's client serves views.
   */
  private async executeMcpViaDevice(
    payload: ChatToolPayload,
    context: ToolExecutionContext,
    mcpParams: StdioMCPParams | HttpMCPClientParams,
    target: McpTunnelTarget,
    relaysView = false,
  ): Promise<ToolExecutionResult> {
    const { identifier, apiName, arguments: args } = payload;

    const authorizationError = await resolveDeviceDispatchAuthorizationFailure(
      context.serverDB,
      context.userId!,
      target.deviceId,
      target.workspaceId,
    );
    if (authorizationError) {
      return {
        content: 'The workspace device is no longer registered or visible for this run.',
        error: 'DEVICE_NOT_FOUND',
        errorData: authorizationError,
        success: false,
      };
    }

    log(
      'Executing %s MCP tool via device: %s:%s (device=%s, workspace=%s)',
      mcpParams.type,
      identifier,
      apiName,
      target.deviceId,
      target.workspaceId ?? 'personal',
    );

    // MCP Apps on the device session too, so a view's later calls and reads
    // reach the same pooled server; an older client would ignore it
    const mcpApps =
      relaysView &&
      (await isMcpAppsEnabled(context.userId)) &&
      (await resolveMcpDeviceFeatures(context.userId!, target)).includes('apps');
    const deadline = Date.now() + (context.executionTimeoutMs ?? 60_000);
    const identity =
      context.operationId && context.assistantMessageId
        ? {
            apiName,
            assistantMessageId: context.assistantMessageId,
            identifier,
            operationId: context.operationId,
            toolCallId: payload.id,
            toolMessageId: context.toolMessageId,
          }
        : undefined;
    const delegation =
      identity && target.workspaceId
        ? await signMcpDeviceGrant(
            {
              ...identity,
              userId: context.userId!,
              workspaceId: target.workspaceId,
              deviceId: target.deviceId,
            },
            deadline,
          )
        : undefined;
    const result = await deviceGateway.executeMcpCall(
      {
        apiName,
        arguments: args,
        deviceId: target.deviceId,
        identifier,
        // Only the token fields of the auth travel to the device
        params: {
          ...toGatewayMcpParams(mcpParams),
          ...(mcpApps && { mcpCall: { mcpApps: true } }),
          ...(identity && {
            elicitation: {
              delegation,
              identity,
              deadline,
              workspaceId: context.workspaceId ?? target.workspaceId,
              continuation: context.mcpContinuation,
            },
          }),
        },
        // Pin the client resolved for this device, so the call never lands on
        // one of its clients that cannot run it.
        clientKinds: target.clientKinds,
        userId: context.userId!,
        // Address the workspace device pool when the run is workspace-scoped —
        // omitting this would route the call to the personal pool and miss an
        // online workspace-shared device.
        workspaceId: target.workspaceId,
      },
      context.executionTimeoutMs,
    );

    const existingToolMessageId =
      context.serverDB && context.userId && context.assistantMessageId
        ? await new MessageModel(
            context.serverDB,
            context.userId,
            context.workspaceId,
          ).findToolMessageIdByToolCallId(payload.id, context.assistantMessageId)
        : undefined;
    if (!result.success) {
      // The device may already be running the call, so never let the retry
      // classifier replay it (see withoutDeviceReplay).
      return withoutDeviceReplay({
        content: result.content,
        error: result.errorData ?? {
          code: 'MCP_DEVICE_EXECUTION_ERROR',
          message: result.error || result.content,
        },
        errorData: result.errorData,
        toolMessageId: existingToolMessageId ?? undefined,
        success: false,
      });
    }

    // A view the device names is read and driven through the server, from
    // any client that opens the conversation, back on this device
    const state = await relayDeviceViewState(result.state as Record<string, any> | undefined, {
      device: target,
      keep: mcpApps,
      params: mcpParams,
    });

    return {
      content: result.content,
      state: result.state ? state : undefined,
      toolMessageId: existingToolMessageId ?? undefined,
      success: true,
    };
  }

  private async executeCloudMCPTool(
    payload: ChatToolPayload,
    context: ToolExecutionContext,

    mcpParams: CloudMCPParams,
  ): Promise<ToolExecutionResult> {
    const { apiName, arguments: args } = payload;
    // The gateway knows the connector, not a private row's tool prefix
    const identifier = mcpParams.name || payload.identifier;

    log('Executing Cloud MCP tool: %s:%s via cloud gateway', identifier, apiName);

    try {
      const { content, state, success } = await callCloudMcpTool(
        { args, identifier, toolName: apiName },
        runtimeCloudMcpCaller(context.userId),
      );

      log('Cloud MCP tool execution successful for: %s:%s', identifier, apiName);

      return { content, state, success };
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
