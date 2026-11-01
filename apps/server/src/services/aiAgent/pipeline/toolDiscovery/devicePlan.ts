import type { DeviceAttachment } from '@lobechat/builtin-tool-remote-device';
import type { DeviceUnavailableErrorData } from '@lobechat/device-gateway-client';
import { TRPCError } from '@trpc/server';
import debug from 'debug';

import {
  isDeviceCapablePlan,
  isDeviceLockedPlan,
  resolveExecutionPlan,
  resolveToolMode,
} from '@/helpers/executionTarget';

import { shareGateGrantsCloudSandbox } from '../../shareGate';
import type { ExecRunContext } from '../../types';
import { traceDiscoveryStage } from '../discoveryTracing';
import type { ToolDiscoveryDeps, ToolDiscoveryInput } from './types';

const log = debug('lobe-server:ai-agent-service');

/**
 * Resolve THE device decision for this run. All rules live in
 * `resolveExecutionPlan` (gated on `canUseDevice` first, `none`/`sandbox`
 * never route to a device, offline bindings stay unrouted, unbound runs
 * auto-activate only with exactly one device online). Without the
 * `canUseDevice` gate an external bot sender's turn would still populate
 * `state.binding.device.id`, and `buildStepToolDelta` re-injects
 * `LocalSystemManifest` whenever activeDeviceId is set, bypassing the
 * engine's enabledToolIds exclusion — resolving the plan here closes
 * that bypass at the source.
 *
 * `clientExecutionAvailable` is `gatewayConfigured` here: a server with a
 * device gateway can tunnel a `local` target to the user's device, so the
 * unset-target default resolves to `local` there and `none` otherwise.
 *
 * Chat mode is orthogonal to `executionTarget` (the UI toggle only writes
 * `enableAgentMode`), so a default/stored `local` target would otherwise
 * resolve a device and `buildStepToolDelta` would re-inject local-system.
 * Pass `chatConfig` so the plan degrades to `none` in chat mode — the
 * chat-mode derivation lives in `resolveExecutionPlan` (`resolveToolMode`),
 * the same source of truth the tools engine uses.
 *
 * A share visitor never passes `canUseDevice`, so a creator agent that
 * targets `local`/`auto` would collapse to `none` and silently drop a
 * `lobe-cloud-sandbox` grant (the sandbox manifest only materializes when
 * the plan resolves to `sandbox`). `sandboxFallback` keeps that decision
 * inside the resolver instead of patching its result here.
 */
export const resolveDevicePlan = async (
  deps: ToolDiscoveryDeps,
  ctx: Pick<
    ExecRunContext,
    'agentConfig' | 'assistantMessageId' | 'canUseDevice' | 'runFacts' | 'shareGate' | 'topicId'
  >,
  input: Pick<
    ToolDiscoveryInput,
    | 'disableLocalSystem'
    | 'isFixedDeviceTarget'
    | 'localDeviceId'
    | 'requestedDeviceId'
    | 'requestTrigger'
    | 'requireDevice'
  >,
  devices: {
    boundDeviceId?: string | null;
    gatewayConfigured: boolean;
    onlineDevices: DeviceAttachment[];
  },
) => {
  const { agentConfig, assistantMessageId, canUseDevice, shareGate, topicId } = ctx;
  const {
    disableLocalSystem,
    isFixedDeviceTarget,
    localDeviceId,
    requestTrigger,
    requestedDeviceId,
    requireDevice,
  } = input;
  const { boundDeviceId, gatewayConfigured, onlineDevices } = devices;

  const executionPlan = resolveExecutionPlan({
    agencyConfig: agentConfig.agencyConfig,
    canUseDevice,
    chatConfig: agentConfig.chatConfig ?? undefined,
    clientExecutionAvailable: gatewayConfigured,
    localDeviceId,
    onlineDeviceIds: onlineDevices.map((device) => device.deviceId),
    requestedDeviceId,
    sandboxFallback: shareGate ? shareGateGrantsCloudSandbox(shareGate) : false,
    trigger: requestTrigger,
  });
  // Persist a visible assistant error and fail the RPC before tool/runtime
  // preparation, so no operation can start somewhere it must not run.
  const failUnroutedDevice = async (deviceId: string, message: string, detail: string) => {
    const errorData: DeviceUnavailableErrorData = {
      code: 'DEVICE_NOT_FOUND',
      deviceId,
      retryable: true,
      scope: deps.workspaceId ? 'workspace' : 'personal',
      ...(deps.workspaceId ? { workspaceId: deps.workspaceId } : {}),
    };
    await deps.messageModel.update(assistantMessageId, {
      content: '',
      error: {
        body: { detail, ...errorData },
        message,
        type: 'ServerAgentRuntimeError',
      },
    });
    throw new TRPCError({
      cause: { data: errorData },
      code: 'PRECONDITION_FAILED',
      message: detail,
    });
  };
  const isChatMode = resolveToolMode(agentConfig.chatConfig ?? undefined) === 'chat';
  const deviceOffline =
    executionPlan.kind === 'device-unrouted' && executionPlan.reason === 'bound-device-offline';

  // A fixed device target must never degrade to the cloud sandbox or a
  // different device.
  if (isFixedDeviceTarget && boundDeviceId && !isChatMode && executionPlan.kind !== 'device') {
    await failUnroutedDevice(
      boundDeviceId,
      'Fixed agent device unavailable',
      deviceOffline
        ? 'The device fixed by this agent is offline. Ask an editor to bring it online or change the agent device policy.'
        : 'The device fixed by this agent is unavailable for this run. Ask an editor to check the agent device policy.',
    );
  }
  // Nor may a device the request required (`lh topic send --new --device`):
  // it can go offline between the caller's check and this routing, and the
  // run would otherwise degrade to the cloud sandbox or another machine.
  if (
    requireDevice &&
    requestedDeviceId &&
    !isChatMode &&
    !(executionPlan.kind === 'device' && executionPlan.deviceId === requestedDeviceId)
  ) {
    await failUnroutedDevice(
      requestedDeviceId,
      'Required device unavailable',
      deviceOffline
        ? `Device ${requestedDeviceId} went offline before the run could start there. Bring it online and send again.`
        : `This run cannot be routed to device ${requestedDeviceId}, so it was not started elsewhere.`,
    );
  }
  // Device tools (local-system / remote-device proxy) only exist in a
  // device-capable session — `none` and `sandbox` sessions must never see
  // them, not even the proxy that could activate a device mid-run.
  const deviceCapable = isDeviceCapablePlan(executionPlan);
  // Locked = routed to a device, or explicitly bound but offline. Such a
  // run has no device decision left, so the remote-device picker is
  // physically stripped (here and in the engine walls) — the model must
  // follow the user's choice, never re-list or switch machines mid-run.
  const deviceLocked = isDeviceLockedPlan(executionPlan);
  const activeDeviceId = executionPlan.kind === 'device' ? executionPlan.deviceId : undefined;
  // Which principal pool the routed device lives in. A workspace run with a
  // per-user `local` override routes to the caller's PERSONAL
  // device — the device pool read added it from the personal pool — and the
  // device runtimes must address it via `(userId, deviceId)`, not the
  // `workspace:<id>` pool where it has no connection. Carried through
  // operation metadata into `ToolExecutionContext` and read by
  // `resolveRunWorkspaceId`.
  const activeDeviceScope = activeDeviceId
    ? onlineDevices.find((d) => d.deviceId === activeDeviceId)?.scope
    : undefined;
  log(
    'execAgent: execution plan → kind=%s deviceId=%s scope=%s',
    executionPlan.kind,
    activeDeviceId ?? 'none',
    activeDeviceScope ?? 'none',
  );
  // A device-targeted run that could not be routed silently degrades exec
  // (lobe-skills runCommand/execScript) to the cloud sandbox. Surface it as
  // a structured warn — `bound-device-offline` with a requestedDeviceId is
  // the desktop "local device" pick whose gateway connection dropped, and
  // this log is the breadcrumb for diagnosing WHY the device was judged
  // offline (lazy WS connect vs getScopedOnlineDevices failing silently).
  if (executionPlan.kind === 'device-unrouted') {
    console.warn('[AiAgentService] device-unrouted: exec degrades to cloud sandbox', {
      boundDeviceId,
      onlineDeviceCount: onlineDevices.length,
      reason: executionPlan.reason,
      requestedDeviceId,
      topicId,
      userId: deps.userId,
    });
  }

  // Opt-in capability from the existing system-info RPC. Older desktop and CLI
  // clients omit it, so they must never receive the new Computer Use manifest.
  const systemInfoDeviceId = canUseDevice && !disableLocalSystem ? activeDeviceId : undefined;
  const supportedDeviceTools = systemInfoDeviceId
    ? (
        await traceDiscoveryStage('device_system_info', () =>
          ctx.runFacts.deviceSystemInfo(systemInfoDeviceId, activeDeviceScope),
        )
      )?.supportedTools
    : undefined;

  return {
    activeDeviceId,
    activeDeviceScope,
    deviceCapable,
    deviceLocked,
    executionPlan,
    supportedDeviceTools,
  };
};
