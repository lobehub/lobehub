import { isRemoteHeterogeneousType } from '@lobechat/heterogeneous-agents';

import { resolveExecutionPlan, resolveWorkspaceScoped } from '@/helpers/executionTarget';
import { findWakeableManagedDevices } from '@/server/services/deviceGateway/managedDeviceWake';

import { supportsCloudHeterogeneousSandbox } from '../../helpers/heteroErrors';
import type { ExecRunContext } from '../../types';
import type { HeteroDispatchDeps, HeteroDispatchInput } from './types';

/**
 * Where a hetero run goes: the platform device of a remote agent, or the
 * execution plan of a local CLI agent with the device it names. Reads only
 * the request and the device registry — never the prepared run — so it runs
 * alongside `prepareHeteroRun`.
 */
export const resolveHeteroRouting = async (
  deps: HeteroDispatchDeps,
  ctx: Pick<ExecRunContext, 'agentConfig' | 'canUseDevice'>,
  input: Pick<
    HeteroDispatchInput,
    | 'canManageAgent'
    | 'effectiveRequestedDeviceId'
    | 'heteroType'
    | 'isPublicWorkspaceAgent'
    | 'localDeviceId'
    | 'memberDeviceOverride'
    | 'requestTrigger'
    | 'requestedDeviceId'
  >,
) => {
  const { agentConfig, canUseDevice } = ctx;
  const {
    canManageAgent,
    effectiveRequestedDeviceId,
    heteroType,
    isPublicWorkspaceAgent,
    localDeviceId,
    memberDeviceOverride,
    requestTrigger,
    requestedDeviceId,
  } = input;
  const isRemoteHetero = isRemoteHeterogeneousType(heteroType);

  const platformPlan = isRemoteHetero
    ? resolveExecutionPlan({
        agencyConfig: agentConfig.agencyConfig,
        canUseDevice,
        clientExecutionAvailable: Boolean(localDeviceId),
        isHetero: true,
        localDeviceId,
        requestedDeviceId: effectiveRequestedDeviceId,
        sandboxExecutionAvailable: false,
        trigger: requestTrigger,
        workspaceScoped: resolveWorkspaceScoped(
          isPublicWorkspaceAgent && !canManageAgent,
          memberDeviceOverride,
        ),
      })
    : undefined;
  const remoteDeviceId = platformPlan?.kind === 'device' ? platformPlan.deviceId : undefined;
  const remoteDeviceWorkspaceId = remoteDeviceId
    ? await deps.resolveDeviceWorkspaceId(remoteDeviceId)
    : undefined;
  const usesCallersPersonalDevice =
    platformPlan?.kind === 'device' &&
    !remoteDeviceWorkspaceId &&
    (effectiveRequestedDeviceId === remoteDeviceId ||
      (platformPlan.target === 'local' &&
        agentConfig.agencyConfig?.executionTargetSelectionPolicy !== 'fixed') ||
      (!canManageAgent && memberDeviceOverride?.boundDeviceId === remoteDeviceId));
  const remoteDeviceUserId = usesCallersPersonalDevice
    ? deps.userId
    : (agentConfig.userId ?? deps.userId);

  // Resolve CLI-device routing before persisting the marker. Cancellation
  // must address the same device even though local CLI agents use a different
  // dispatch transport from notify-based platform agents.
  // A bound managed cloud device that is offline resolves to
  // `device-wakeable`: it is woken and the dispatch waits for it.
  const wakeableCliDevices =
    !isRemoteHetero && canUseDevice
      ? await findWakeableManagedDevices(
          { db: deps.db, userId: deps.userId, workspaceId: deps.workspaceId },
          [requestedDeviceId, agentConfig.agencyConfig?.boundDeviceId],
        )
      : [];
  const cliPlanParams = {
    agencyConfig: agentConfig.agencyConfig,
    clientExecutionAvailable: false,
    isHetero: true,
    requestedDeviceId,
    sandboxExecutionAvailable: supportsCloudHeterogeneousSandbox(heteroType),
    trigger: requestTrigger,
    wakeableDeviceIds: wakeableCliDevices.map((device) => device.deviceId),
  };
  const deviceHeteroPlan = !isRemoteHetero
    ? resolveExecutionPlan({ ...cliPlanParams, canUseDevice })
    : undefined;
  const cliDeviceId =
    deviceHeteroPlan?.kind === 'device' || deviceHeteroPlan?.kind === 'device-wakeable'
      ? deviceHeteroPlan.deviceId
      : undefined;
  // Whether the sandbox is a fallback for a sender denied the agent's device:
  // with access the same request would have routed to a device. Lets a failed
  // sandbox run tell the sender why it ran there instead.
  const deviceAccessDenied =
    deviceHeteroPlan?.kind === 'sandbox' &&
    !canUseDevice &&
    ['device', 'device-wakeable'].includes(
      resolveExecutionPlan({ ...cliPlanParams, canUseDevice: true }).kind,
    );
  const cliDeviceWorkspaceId = cliDeviceId
    ? await deps.resolveDeviceWorkspaceId(cliDeviceId)
    : undefined;

  return {
    cliDeviceId,
    cliDeviceWorkspaceId,
    deviceAccessDenied,
    deviceHeteroPlan,
    remoteDeviceId,
    remoteDeviceUserId,
    remoteDeviceWorkspaceId,
    wakeableCliDevices,
  };
};
