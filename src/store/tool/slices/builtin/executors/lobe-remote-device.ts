/**
 * Lobe Remote Device Executor (client-side)
 *
 * Serves `lobe-remote-device` when the run executes in the BROWSER (client
 * runtime — Agent Gateway disabled, `selectRuntimeType` → 'client'). The
 * server-side `remoteDeviceRuntime` never runs in that mode, so device
 * discovery is relayed to the server's `device.listDevices` tRPC — the same
 * query the device-settings page and the run-target picker render — and the
 * shared `RemoteDeviceExecutionRuntime` builds the LLM-facing result.
 *
 * Without this executor the tool could still be activated (its manifest lives
 * in the builtin registry) but had no executor: `invokeBuiltinTool` fell
 * through to "No executor found" and the model saw an empty tool result.
 *
 * Scope semantics mirror the server runtime (`getScopedOnlineDevices` /
 * `resolveRunWorkspaceId`): a workspace agent only ever sees its workspace
 * pool, a personal agent only its own devices. When the invoking agent is
 * unknown to the store the executor FAILS CLOSED (structured error) instead
 * of falling back to the personal pool, so an unhydrated workspace run can
 * never expose personal devices. One server-side nuance is NOT mirrored —
 * `activeDeviceScope === 'personal'` (a workspace agent routed to the
 * caller's own machine via the per-user `local` override) — because
 * `BuiltinToolContext` carries no device-scope field; such a run resolves to
 * the workspace pool here, which is empty for a personal-routed device.
 */
import { LocalSystemIdentifier } from '@lobechat/builtin-tool-local-system';
import { RemoteDeviceApiName, RemoteDeviceIdentifier } from '@lobechat/builtin-tool-remote-device';
import { RemoteDeviceExecutionRuntime } from '@lobechat/builtin-tool-remote-device/executionRuntime';
import {
  BaseExecutor,
  type BuiltinServerRuntimeOutput,
  type BuiltinToolContext,
  type BuiltinToolResult,
  type DeviceListItem,
} from '@lobechat/types';

import { createWorkspaceLambdaClient } from '@/libs/trpc/client';
import { deviceService } from '@/services/device';
import { useAgentStore } from '@/store/agent';
import { getElectronStoreState } from '@/store/electron';

/**
 * Map a `BuiltinServerRuntimeOutput` (server runtime contract) into the
 * renderer executor's `BuiltinToolResult` shape (error → {message, type}).
 */
const toBuiltinResult = (output: BuiltinServerRuntimeOutput): BuiltinToolResult => ({
  content: output.content,
  error: output.error
    ? {
        body: output.error,
        message: output.error instanceof Error ? output.error.message : String(output.error),
        type: 'RemoteDeviceError',
      }
    : undefined,
  state: output.state,
  success: output.success,
});
// The `device.listDevices` union query is scope-independent (filtering happens
// after the fetch), so parallel invokes in the same tick — `call_tools_batch`
// and group-agent broadcasts run tools under Promise.all — share one in-flight
// request per pool key instead of stampeding the server with N identical
// queries. Results are per-pool, never per-run, so sharing is safe.
const inFlightQueries = new Map<string, Promise<DeviceListItem[]>>();

const queryDevices = (workspaceId?: string): Promise<DeviceListItem[]> => {
  const key = workspaceId ?? 'personal';
  let pending = inFlightQueries.get(key);
  if (!pending) {
    // Pin the query to the agent's workspace when it has one: the default
    // lambdaClient resolves its workspace context from the business headers
    // slot (the currently-active UI workspace), which would leak another
    // workspace's pool into a background/multi-window run.
    pending = (
      workspaceId
        ? createWorkspaceLambdaClient(workspaceId).device.listDevices.query()
        : deviceService.listDevices()
    ).finally(() => inFlightQueries.delete(key));
    inFlightQueries.set(key, pending);
  }
  return pending;
};

const createRuntime = (agentId?: string) =>
  new RemoteDeviceExecutionRuntime({
    queryDeviceList: async () => {
      const agent = agentId ? useAgentStore.getState().agentMap[agentId] : undefined;
      // Fail CLOSED when the agent is unknown (not yet hydrated in the store —
      // background/group runs before its config loaded) or the invoking context
      // carries no agent id: without the agent we cannot prove which pool this
      // run belongs to. Falling back to the personal pool would leak personal
      // device ids/hostnames into a workspace conversation and let
      // `activateDevice` persist a personal activeDeviceId — exactly what the
      // server path prevents by recovering the workspace from the run/DB. The
      // runtime surfaces the throw as a structured failure, so the model sees a
      // clear 'cannot resolve scope' instead of a misleading empty list.
      if (!agent) {
        throw new Error('Cannot resolve the device scope for this run: agent is not loaded.');
      }
      const workspaceId = agent.workspaceId || undefined;
      const list = await queryDevices(workspaceId);
      // Scope the relay to the invoking agent's device pool, mirroring the server
      // runtime (getScopedOnlineDevices): a workspace agent only ever sees the
      // workspace pool, a personal agent only its own devices. `device.listDevices`
      // returns the personal ∪ workspace union, so without this filter a workspace
      // conversation would expose personal devices and `activateDevice` could pin a
      // personal activeDeviceId.
      //
      // The agent id is captured in this closure PER INVOCATION (each invoke
      // constructs its own runtime), so overlapping calls can never filter under
      // each other's scope.
      const isWorkspaceAgent = workspaceId !== undefined;
      const devices = list
        .filter((d) => (isWorkspaceAgent ? d.scope === 'workspace' : d.scope === 'personal'))
        .map((d) => ({
          channels: d.channels?.map((c) => ({
            channel: c.channel ?? undefined,
            connectedAt: c.connectedAt,
            // The UI `DeviceChannel` shape carries no connectionId; the gateway
            // id is not exposed by listDevices. Reuse connectedAt as a stable
            // placeholder so the attachment keeps the same shape as the server
            // runtime's gateway mapping.
            connectionId: c.connectedAt,
          })),
          deviceId: d.deviceId,
          friendlyName: d.friendlyName,
          hostname: d.hostname ?? '',
          lastSeen: d.lastSeen,
          online: d.online,
          platform: d.platform ?? '',
          scope: d.scope,
        }));
      return devices;
    },
  });

class RemoteDeviceExecutor extends BaseExecutor<typeof RemoteDeviceApiName> {
  readonly identifier = RemoteDeviceIdentifier;
  protected readonly apiEnum = RemoteDeviceApiName;

  listOnlineDevices = async (
    _params: void,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    // The shared runtime already returns a structured failure for every error
    // path; invokeBuiltinTool additionally catches stray throws.
    return toBuiltinResult(await createRuntime(ctx.agentId).listOnlineDevices());
  };

  activateDevice = async (
    params: { deviceId: string },
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    const result = await createRuntime(ctx.agentId).activateDevice(params);
    if (!result.success) return toBuiltinResult(result);
    // Client-mode Local System runs on THIS desktop only: its executor talks
    // to localFileService/Electron IPC and receives no device routing, so
    // activating a remote device would advertise a tool that then executes on
    // the wrong machine (or fails outright in a web tab). Restrict client-mode
    // activation to the current desktop client — remote devices must be
    // controlled through Agent Gateway (server-executed) mode, which routes
    // Local System calls to the activated device.
    const localDeviceId = getElectronStoreState().gatewayDeviceInfo?.deviceId;
    if (!localDeviceId || localDeviceId !== params.deviceId) {
      return toBuiltinResult({
        content: localDeviceId
          ? `Device "${params.deviceId}" is not the current desktop client. In browser-run mode only the local device can be activated — use Agent Gateway mode to control remote devices.`
          : 'Device activation is unavailable in browser-run mode without a connected desktop client. Use Agent Gateway mode to control devices.',
        success: false,
      });
    }
    // Fold the device activation into the client runtime's tool-activation
    // contract (`state.activatedTools` → persisted pluginState →
    // selectActivatedToolIdsFromMessages → next-step tool set), mirroring the
    // server's `activeDeviceId` → lobe-local-system fold in
    // buildStepToolDelta. Without this the success message would claim
    // Local System is available but the next client-mode LLM call would still
    // omit lobe-local-system.
    return toBuiltinResult({
      ...result,
      state: {
        ...result.state,
        activatedTools: [{ identifier: LocalSystemIdentifier }],
      },
    });
  };
}

export const remoteDeviceExecutor = new RemoteDeviceExecutor();
