import { type DeviceControlDeps, executeDeviceRpc } from '@lobechat/device-control';
import { BROWSER_IDENTIFIER } from '@lobechat/device-control/agent-browser';
import { COMPUTER_USE_IDENTIFIER } from '@lobechat/device-control/computer-use';
import type {
  AgentRunRequestMessage,
  GatewayClient,
  RpcRequestMessage,
  SystemInfoRequestMessage,
  ToolCallRequestMessage,
} from '@lobechat/device-gateway-client';
import type { RuntimeProbeCache } from '@lobechat/heterogeneous-agents/runtimeProbeCache';
import { executeDeviceOperation } from '@lobechat/local-file-shell/shell';

import type { resolveToken } from '../../auth/resolveToken';
import type { CliMaintenance } from '../../daemon/maintenance';
import { appendLog } from '../../daemon/manager';
import type { ActivityReporter } from '../../device/activityHook';
import { spawnHeteroAgentRun } from '../../device/agentRun';
import { collectSystemInfo } from '../../device/systemInfo';
import { executeToolCall } from '../../tools';
import { executeBrowserCall, type resolveBrowserDevice } from '../../tools/browser';
import { executeComputerUseCall, type resolveComputerUseDevice } from '../../tools/computerUse';
import { log } from '../../utils/logger';

/** Everything a gateway connection's request handlers need from the host process. */
export interface GatewayHandlerContext {
  /** Present when `LOBEHUB_DEVICE_ACTIVITY_COMMAND` reports this device's work. */
  activity?: ActivityReporter;
  /** Present when an `agent-browser` binary enabled the browser tool on this device. */
  browser?: Awaited<ReturnType<typeof resolveBrowserDevice>>;
  /** Present when `--auv` enabled Computer Use on this device. */
  computerUse?: Awaited<ReturnType<typeof resolveComputerUseDevice>>;
  deps: DeviceControlDeps;
  error: (msg: string) => void;
  /** Read at dispatch time — the underlying auth may be refreshed mid-session. */
  getAuth: () => Awaited<ReturnType<typeof resolveToken>>;
  /** Credentials tools may use against the server API (e.g. image upload); none when absent. */
  getToolAuth: () => Awaited<ReturnType<typeof resolveToken>> | undefined;
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
  const {
    activity,
    browser,
    computerUse,
    deps,
    error,
    getAuth,
    getToolAuth,
    info,
    isDaemonChild,
    maintenance,
    recordRequest,
  } = ctx;

  // Handle system info requests
  client.on('system_info_request', async (request: SystemInfoRequestMessage) => {
    info(`Received system_info_request: requestId=${request.requestId}`);
    const systemInfo = await collectSystemInfo(ctx.nativeRuntimes, computerUse, browser);
    client.sendSystemInfoResponse({
      requestId: request.requestId,
      result: { success: true, systemInfo },
    });
  });

  // Handle tool call requests
  client.on('tool_call_request', async (request: ToolCallRequestMessage) => {
    recordRequest();
    const endActivity = activity?.begin();
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
    const result = await executeDeviceOperation({ apiName: toolCall.apiName, operationId }, () =>
      maintenance.run(() =>
        // Computer Use's `runCommand` shares its apiName with the shell tool, and
        // the browser's apis (`click`, `screenshot`, …) are routed by identifier too.
        toolCall.identifier === COMPUTER_USE_IDENTIFIER
          ? executeComputerUseCall(computerUse, toolCall.apiName, toolCall.arguments, timeout)
          : toolCall.identifier === BROWSER_IDENTIFIER
            ? executeBrowserCall(browser, toolCall.apiName, toolCall.arguments, timeout)
            : executeToolCall(toolCall.apiName, toolCall.arguments, timeout, getToolAuth()),
      ),
    ).catch((err: Error) => ({
      content: '',
      error: err.message,
      state: undefined,
      success: false,
    }));
    endActivity?.();
    const executionTimeMs = Math.round(performance.now() - startedAt);

    if (isDaemonChild) {
      appendLog(
        `[RESULT] ${result.success ? 'OK' : 'FAIL'} ${executionTimeMs}ms${operationId ? ` op=${operationId}` : ''} (${requestId})`,
      );
    } else {
      log.toolResult(requestId, result.success, result.content, operationId);
    }

    client.sendToolCallResponse({
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
    const { method, params, requestId } = request;
    if (isDaemonChild) appendLog(`[RPC] ${method} (${requestId})`);
    else info(`Received rpc_request: method=${method} (${requestId})`);

    const endActivity = activity?.begin();
    try {
      const run = () => executeDeviceRpc(method, params, deps);
      const isMaintenance = ['getCliUpdateState', 'checkCliUpdate', 'restartCli'].includes(method);
      const data = await (isMaintenance ? run() : maintenance.run(run));
      client.sendRpcResponse({ requestId, result: { data, success: true } });
      if (method === 'restartCli') maintenance.afterResponse();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (isDaemonChild) appendLog(`[RPC ERROR] ${method}: ${message} (${requestId})`);
      else error(`rpc_request method=${method} failed: ${message}`);
      client.sendRpcResponse({ requestId, result: { error: message, success: false } });
    } finally {
      endActivity?.();
    }
  });

  // Handle gateway-dispatched agent runs (heterogeneous agents, e.g. Claude
  // Code). Mirrors the desktop app: spawn `lh hetero exec`, which owns the full
  // execution + server-ingest pipeline. Ack with the spawn outcome — `accepted`
  // once the child starts, `rejected` if it fails to spawn (e.g. bad cwd) — so
  // a failed dispatch surfaces as an error instead of a stuck assistant message.
  client.on('agent_run_request', async (request: AgentRunRequestMessage) => {
    recordRequest();
    // Covers the dispatch; the run itself is polled through the task registry.
    const endActivity = activity?.begin();
    info(
      `Received agent_run_request: operationId=${request.operationId} type=${request.agentType}`,
    );
    try {
      const ack = await maintenance.run(() =>
        spawnHeteroAgentRun(
          {
            agentId: request.agentId,
            agentType: request.agentType,
            assistantMessageId: request.assistantMessageId,
            args: request.args,
            claudeAccountRouting: request.claudeAccountRouting,
            claudeCodeEntrypoint: request.claudeCodeEntrypoint,
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
        ),
      );
      client.sendAgentRunAck({ operationId: request.operationId, ...ack });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      error(`agent_run_request failed: ${reason}`);
      client.sendAgentRunAck({ operationId: request.operationId, reason, status: 'rejected' });
    } finally {
      endActivity?.();
    }
  });
}
