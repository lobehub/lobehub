/**
 * Agent-facing device RPCs: CLI quotas and model catalogs, agent run dispatch,
 * and tool / MCP / message-API calls.
 */
import {
  describeGatewayRequestFailure,
  type DeviceMessageApiResult,
  type DeviceToolCallResult,
  type GatewayMcpParams,
  type GatewayToolCallCompletion,
} from '@lobechat/device-gateway-client';
import type { HeterogeneousAgentType } from '@lobechat/heterogeneous-agents';
import type {
  AntigravityQuotaParams,
  AntigravityQuotaSnapshot,
  ClaudeCodeAccountRouting,
  ClaudeCodeQuotaSnapshot,
  CodexQuotaSnapshot,
  KimiCodeQuotaSnapshot,
} from '@lobechat/heterogeneous-agents/quota';
import type {
  DeviceClient,
  DeviceUnavailableErrorData,
  HeterogeneousAgentModelCatalog,
  HeteroPermissionMode,
  ListHeterogeneousAgentModelsParams,
} from '@lobechat/types';
import debug from 'debug';

import type { McpTool } from '@/libs/mcp/types';

import { invokeDeviceRead } from './deviceRead';
import type { DeviceClientGetter } from './types';

const log = debug('lobe-server:device-gateway');

/**
 * Claude Code subscription quota of the login on a remote device. The device
 * samples the Anthropic usage API with its local credentials — same sampler
 * as the desktop IPC path. `undefined` also covers older device clients that
 * don't know this RPC yet.
 */
export function claudeCodeQuota(
  getClient: DeviceClientGetter,
  params: {
    deviceId: string;
    env?: Record<string, string>;
    force?: boolean;
    userId: string;
    workspaceId?: string;
  },
) {
  return invokeDeviceRead<ClaudeCodeQuotaSnapshot>(getClient, 'getClaudeCodeQuota', params, {
    env: params.env,
    force: params.force,
  });
}

/** Codex subscription quota sampled from the login on a remote device. */
export function codexQuota(
  getClient: DeviceClientGetter,
  params: {
    command?: string;
    deviceId: string;
    env?: Record<string, string>;
    force?: boolean;
    userId: string;
    workspaceId?: string;
  },
) {
  return invokeDeviceRead<CodexQuotaSnapshot>(getClient, 'getCodexQuota', params, {
    command: params.command,
    env: params.env,
    force: params.force,
  });
}

/** Native agy quota; relay only, without quota-history ingestion. */
export function antigravityQuota(
  getClient: DeviceClientGetter,
  params: AntigravityQuotaParams & {
    deviceId: string;
    userId: string;
    workspaceId?: string;
  },
) {
  return invokeDeviceRead<AntigravityQuotaSnapshot>(
    getClient,
    'getAntigravityQuota',
    { ...params, timeout: 30_000 },
    {
      command: params.command,
      env: params.env,
      force: params.force,
    },
  );
}

/** Kimi Code subscription quota sampled from the login on a remote device. */
export function kimiCodeQuota(
  getClient: DeviceClientGetter,
  params: {
    deviceId: string;
    env?: Record<string, string>;
    force?: boolean;
    userId: string;
    workspaceId?: string;
  },
) {
  return invokeDeviceRead<KimiCodeQuotaSnapshot>(getClient, 'getKimiCodeQuota', params, {
    env: params.env,
    force: params.force,
  });
}

/** Query a heterogeneous CLI's model catalog on the device that will execute it. */
export async function listHeterogeneousAgentModels(
  getClient: DeviceClientGetter,
  params: {
    args?: string[];
    command?: string;
    cwd?: string;
    deviceId: string;
    env?: Record<string, string>;
    timeout?: number;
    type: ListHeterogeneousAgentModelsParams['type'];
    userId: string;
    workspaceId?: string;
  },
): Promise<HeterogeneousAgentModelCatalog> {
  const { args, command, cwd, deviceId, env, timeout = 20_000, type, userId, workspaceId } = params;
  const client = getClient();
  const unavailable = (message: string): HeterogeneousAgentModelCatalog => ({
    error: { code: 'device_unavailable', message },
    status: 'error',
    updatedAt: Date.now(),
  });
  if (!client) return unavailable('Device gateway is not configured');

  try {
    const result = await client.invokeRpc<HeterogeneousAgentModelCatalog>(
      { deviceId, timeout, userId, workspaceId },
      {
        method: 'listHeterogeneousAgentModels',
        params: { args, command, cwd, env, type },
      },
    );

    if (!result.success || !result.data) {
      const message = result.error || 'The device did not return a model catalog';
      const unsupported =
        message.includes('does not support heterogeneous agent model discovery') ||
        message.includes('Unknown device RPC method');
      log('listHeterogeneousAgentModels: failed for deviceId=%s — %s', deviceId, message);
      return {
        error: { code: unsupported ? 'unsupported_client' : 'device_unavailable', message },
        status: 'error',
        updatedAt: Date.now(),
      };
    }

    return result.data;
  } catch (error) {
    log('listHeterogeneousAgentModels: error for deviceId=%s — %O', deviceId, error);
    return unavailable(error instanceof Error ? error.message : 'Device model discovery failed');
  }
}

export async function dispatchAgentRun(
  getClient: DeviceClientGetter,
  params: {
    agentId?: string;
    agentType: HeterogeneousAgentType;
    assistantMessageId: string;
    /** Resolved `lh hetero exec` wrapper args. */
    args?: string[];
    /** Claude Code account the device must spawn on; see the request message. */
    claudeAccountRouting?: ClaudeCodeAccountRouting;
    /** Entrypoint name the agent asked Claude Code to report; see the request message. */
    claudeCodeEntrypoint?: string;
    /** Restricts the run to connections of these clients; omitted means any client. */
    clientKinds?: DeviceClient[];
    cwd?: string;
    deviceId?: string;
    /** Image attachments forwarded to the device as fetchable (signed) URLs. */
    imageList?: Array<{ id?: string; url: string }>;
    jwt: string;
    operationId: string;
    permissionMode?: HeteroPermissionMode;
    prompt: string;
    resumeFallbackSystemContext?: string;
    resumeSessionId?: string;
    systemContext?: string;
    topicId: string;
    userId: string;
    workspaceId?: string;
    /** Topic/run workspace forwarded to the device for hetero ingest. */
    ingestWorkspaceId?: string;
  },
): Promise<{ error?: string; errorData?: DeviceUnavailableErrorData; success: boolean }> {
  const client = getClient();
  if (!client) return { error: 'GATEWAY_NOT_CONFIGURED', success: false };

  try {
    return await client.dispatchAgentRun(params);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log('dispatchAgentRun: error — %s', message);
    return { error: message, success: false };
  }
}

export async function executeToolCall(
  getClient: DeviceClientGetter,
  params: {
    clientKinds?: DeviceClient[];
    /** Lets the device report this call's final result later; see `buildShellCompletion`. */
    completion?: GatewayToolCallCompletion;
    deviceId: string;
    operationId?: string;
    userId: string;
    workspaceId?: string;
  },
  toolCall: { apiName: string; arguments: string; identifier: string },
  timeout = 30_000,
): Promise<DeviceToolCallResult> {
  const client = getClient();
  if (!client) {
    return {
      content: 'Device Gateway is not configured',
      error: 'GATEWAY_NOT_CONFIGURED',
      success: false,
    };
  }

  log(
    'executeToolCall: operationId=%s, userId=%s, deviceId=%s, tool=%s/%s',
    params.operationId ?? 'N/A',
    params.userId,
    params.deviceId,
    toolCall.identifier,
    toolCall.apiName,
  );

  try {
    return await client.executeToolCall({ ...params, timeout }, toolCall);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log('executeToolCall: error — %s', message);
    // Backstop for anything the http client did not already describe. A raw
    // `TimeoutError` / driver message here reads to the model as if the tool
    // itself blew up; name the failing hop and its recovery instead.
    const failure = describeGatewayRequestFailure(error, 'tool call');
    return { content: failure.content, error: failure.error, success: false };
  }
}

/**
 * Tunnel an MCP tool call to a connected device, for MCP servers only the
 * device can reach: stdio (the cloud can't spawn the user's local binary)
 * and localhost / LAN HTTP endpoints (the cloud's fetch can't reach them).
 * The connection params are forwarded so the device runs the call locally.
 */
export async function executeMcpCall(
  getClient: DeviceClientGetter,
  mcpCall: {
    apiName: string;
    arguments: string;
    /** Which of the device's clients runs the call (see `resolveMcpClientKinds`). */
    clientKinds?: DeviceClient[];
    deviceId: string;
    identifier: string;
    params: GatewayMcpParams;
    userId: string;
    workspaceId?: string;
  },
  timeout = 30_000,
): Promise<DeviceToolCallResult> {
  const client = getClient();
  if (!client) {
    return {
      content: 'Device Gateway is not configured',
      error: 'GATEWAY_NOT_CONFIGURED',
      success: false,
    };
  }

  log(
    'executeMcpCall: userId=%s, deviceId=%s, mcp=%s/%s',
    mcpCall.userId,
    mcpCall.deviceId,
    mcpCall.identifier,
    mcpCall.apiName,
  );

  try {
    return await client.executeMcpCall({ ...mcpCall, timeout });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log('executeMcpCall: error — %s', message);
    const failure = describeGatewayRequestFailure(error, 'tool call');
    return { content: failure.content, error: failure.error, success: false };
  }
}

/**
 * List an MCP server's tools on a connected device, for servers only the device
 * can reach (stdio, its network, or set to connect through it): the cloud can't
 * connect to them to install or refresh the tool list. The tools come back as
 * the server's `tools/list` returned them.
 *
 * Throws with a reason the user can act on: no gateway, a client too old to
 * list MCP tools, or the device's own error.
 */
export async function listMcpTools(
  getClient: DeviceClientGetter,
  params: {
    /** Which of the device's clients lists them (see `resolveMcpClientKinds`). */
    clientKinds?: DeviceClient[];
    deviceId: string;
    mcpApps?: boolean;
    params: GatewayMcpParams;
    timeout?: number;
    userId: string;
    workspaceId?: string;
  },
): Promise<McpTool[]> {
  const {
    clientKinds,
    deviceId,
    mcpApps,
    params: connection,
    timeout = 30_000,
    userId,
    workspaceId,
  } = params;
  const client = getClient();
  if (!client) throw new Error('Device gateway is not configured');

  log('listMcpTools: userId=%s, deviceId=%s, mcp=%s', userId, deviceId, connection.name);

  let result: Awaited<ReturnType<typeof client.invokeRpc<McpTool[]>>>;
  try {
    result = await client.invokeRpc<McpTool[]>(
      { clientKinds, deviceId, timeout, userId, workspaceId },
      { method: 'listMcpTools', params: { mcpApps, params: connection } },
    );
  } catch (error) {
    log('listMcpTools: transport error for deviceId=%s — %O', deviceId, error);
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Couldn't reach your device to list this MCP server's tools (${reason}). Make sure the desktop app or \`lh connect\` is running and connected, then try again.`,
      { cause: error },
    );
  }

  if (!result.success || !Array.isArray(result.data)) {
    const message = result.error || 'The device did not return a tool list';
    log('listMcpTools: failed for deviceId=%s — %s', deviceId, message);
    if (message.includes('Unknown device RPC method')) {
      throw new Error(
        'The app on this device is too old to list MCP tools. Update the desktop app or the `lh` CLI, then try again.',
      );
    }
    throw new Error(message);
  }

  return result.data;
}

export async function executeMessageApi(
  getClient: DeviceClientGetter,
  params: { deviceId: string; userId: string; workspaceId?: string },
  api: { apiName: string; payload: Record<string, unknown>; platform: string },
  timeout = 30_000,
): Promise<DeviceMessageApiResult> {
  const client = getClient();
  if (!client) {
    return {
      content: 'Device Gateway is not configured',
      error: 'GATEWAY_NOT_CONFIGURED',
      success: false,
    };
  }

  log(
    'executeMessageApi: userId=%s, deviceId=%s, api=%s/%s',
    params.userId,
    params.deviceId,
    api.platform,
    api.apiName,
  );

  try {
    return await client.executeMessageApi(
      {
        deviceId: params.deviceId,
        timeout,
        userId: params.userId,
        workspaceId: params.workspaceId,
      },
      api,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log('executeMessageApi: error — %s', message);
    return { content: `Device message API error: ${message}`, error: message, success: false };
  }
}
