import { type DeviceControlDeps, executeDeviceRpc } from '@lobechat/device-control';
import type {
  AgentRunRequestMessage,
  GatewayClient,
  RpcRequestMessage,
  SystemInfoRequestMessage,
  ToolCallRequestMessage,
} from '@lobechat/device-gateway-client';
import type { RuntimeProbeCache } from '@lobechat/heterogeneous-agents/runtimeProbeCache';

import type { resolveToken } from '../auth/resolveToken';
import type { CliMaintenance } from '../daemon/maintenance';
import { appendLog } from '../daemon/manager';
import { executeToolCall } from '../tools';
import { log } from '../utils/logger';
import { spawnHeteroAgentRun } from './agentRun';
import { collectSystemInfo } from './systemInfo';

interface ExecutionRequest {
  attemptId?: string;
  executionSignal?: AbortSignal;
  isExecutionCurrent?: () => boolean;
}
const executionCurrent = (request: ExecutionRequest) =>
  !!request.attemptId &&
  !!request.executionSignal &&
  !request.executionSignal.aborted &&
  request.isExecutionCurrent?.() === true;
const assertExecutionCurrent = (request: ExecutionRequest) => {
  if (!executionCurrent(request)) throw new Error('GATEWAY_EXECUTION_STALE');
};

/** Everything a gateway connection's request handlers need from the host process. */
export interface GatewayHandlerContext {
  deps: DeviceControlDeps;
  error: (msg: string) => void;
  /** Read at dispatch time — the underlying auth may be refreshed mid-session. */
  getAuth: () => Awaited<ReturnType<typeof resolveToken>>;
  info: (msg: string) => void;
  isDaemonChild: boolean;
  maintenance: CliMaintenance;
  /** Process-wide native runtime probe, shared by every gateway connection. */
  nativeRuntimes: RuntimeProbeCache;
  recordRequest: () => void;
}

/**
 * Bind the request handlers shared by every gateway connection this process
 * owns — the personal connection and any workspace-share connections opened via
 * the `enrollWorkspace` RPC — so a workspace principal exposes exactly the same
 * tool / RPC / agent-run surface as the personal one.
 */
export function bindGatewayClientHandlers(
  client: GatewayClient,
  ctx: GatewayHandlerContext,
  connectionWorkspaceId?: string,
) {
  const { deps, error, getAuth, info, isDaemonChild, maintenance, recordRequest } = ctx;

  // Handle system info requests
  client.on('system_info_request', async (request: SystemInfoRequestMessage) => {
    if (!executionCurrent(request)) return;
    info(`Received system_info_request: requestId=${request.requestId}`);
    try {
      const systemInfo = await collectSystemInfo(ctx.nativeRuntimes);
      if (!executionCurrent(request)) return;
      client.sendSystemInfoResponse({
        attemptId: request.attemptId,
        requestId: request.requestId,
        result: { success: true, systemInfo },
      });
    } catch (err) {
      error(
        `System information collection failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      if (executionCurrent(request))
        client.sendSystemInfoResponse({
          attemptId: request.attemptId,
          requestId: request.requestId,
          result: { success: false },
        });
    }
  });

  // Handle tool call requests
  client.on('tool_call_request', async (request: ToolCallRequestMessage) => {
    if (!executionCurrent(request)) return;
    recordRequest();
    const { operationId, requestId, timeout, toolCall } = request;
    if (isDaemonChild) {
      appendLog(
        `[TOOL] ${toolCall.apiName}${operationId ? ` op=${operationId}` : ''} (${requestId})`,
      );
    } else {
      log.toolCall(toolCall.apiName, requestId, toolCall.arguments, operationId);
    }

    // Timed on the DEVICE's clock. The server can only see the whole dispatch
    // round trip, so reporting this back is what separates a slow tool from
    // slow transport.
    const startedAt = performance.now();
    const result = await maintenance
      .run(() => {
        assertExecutionCurrent(request);
        return executeToolCall(
          toolCall.apiName,
          toolCall.arguments,
          timeout,
          getAuth(),
          request.executionSignal,
        );
      })
      .catch((err: Error) => ({
        content: '',
        error: err.message,
        state: undefined,
        success: false,
      }));
    const executionTimeMs = Math.round(performance.now() - startedAt);

    if (isDaemonChild) {
      appendLog(
        `[RESULT] ${result.success ? 'OK' : 'FAIL'} ${executionTimeMs}ms${operationId ? ` op=${operationId}` : ''} (${requestId})`,
      );
    } else {
      log.toolResult(requestId, result.success, result.content, operationId);
    }

    if (!executionCurrent(request)) return;

    client.sendToolCallResponse({
      attemptId: request.attemptId,
      requestId,
      result: {
        content: result.content,
        error: result.error,
        executionTimeMs,
        state: result.state,
        success: result.success,
      },
    });
  });

  // Handle generic server-internal device RPCs (git / workspace / file ops).
  // Shares the `@lobechat/device-control` dispatcher with the desktop app so the
  // CLI exposes the same remote-device control surface.
  client.on('rpc_request', async (request: RpcRequestMessage) => {
    if (!executionCurrent(request)) return;
    const { method, params, requestId } = request;
    if (isDaemonChild) appendLog(`[RPC] ${method} (${requestId})`);
    else info(`Received rpc_request: method=${method} (${requestId})`);

    try {
      const run = () => {
        assertExecutionCurrent(request);
        return executeDeviceRpc(method, params, deps);
      };
      const isMaintenance = ['getCliUpdateState', 'checkCliUpdate', 'restartCli'].includes(method);
      const data = await (isMaintenance ? run() : maintenance.run(run));
      if (!executionCurrent(request)) return;
      client.sendRpcResponse({
        attemptId: request.attemptId,
        requestId,
        result: { data, success: true },
      });
      if (method === 'restartCli') maintenance.afterResponse();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (isDaemonChild) appendLog(`[RPC ERROR] ${method}: ${message} (${requestId})`);
      else error(`rpc_request method=${method} failed: ${message}`);
      if (!executionCurrent(request)) return;
      client.sendRpcResponse({
        attemptId: request.attemptId,
        requestId,
        result: { error: message, success: false },
      });
    }
  });

  // Handle gateway-dispatched agent runs (heterogeneous agents, e.g. Claude
  // Code). Mirrors the desktop app: spawn `lh hetero exec`, which owns the full
  // execution + server-ingest pipeline. Ack with the spawn outcome — `accepted`
  // once the child starts, `rejected` if it fails to spawn (e.g. bad cwd) — so
  // a failed dispatch surfaces as an error instead of a stuck assistant message.
  client.on('agent_run_request', async (request: AgentRunRequestMessage) => {
    if (!executionCurrent(request)) return;
    recordRequest();
    info(
      `Received agent_run_request: operationId=${request.operationId} type=${request.agentType}`,
    );
    try {
      const ack = await maintenance.run(() => {
        assertExecutionCurrent(request);
        return spawnHeteroAgentRun(
          {
            executionSignal: request.executionSignal,
            agentId: request.agentId,
            agentType: request.agentType,
            assistantMessageId: request.assistantMessageId,
            args: request.args,
            cwd: request.cwd,
            imageList: request.imageList,
            jwt: request.jwt,
            operationId: request.operationId,
            prompt: request.prompt,
            resumeFallbackSystemContext: request.resumeFallbackSystemContext,
            resumeSessionId: request.resumeSessionId,
            serverUrl: getAuth().serverUrl,
            systemContext: request.systemContext,
            topicId: request.topicId,
            workspaceId: request.ingestWorkspaceId ?? request.workspaceId ?? connectionWorkspaceId,
          },
          { error, info },
        );
      });
      if (!executionCurrent(request)) return;
      client.sendAgentRunAck({
        attemptId: request.attemptId,
        operationId: request.operationId,
        requestId: request.requestId,
        ...ack,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      error(`agent_run_request failed: ${reason}`);
      if (!executionCurrent(request)) return;
      client.sendAgentRunAck({
        attemptId: request.attemptId,
        operationId: request.operationId,
        requestId: request.requestId,
        reason,
        status: 'rejected',
      });
    }
  });
}
