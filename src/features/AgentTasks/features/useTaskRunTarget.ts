'use client';

import { isDesktop } from '@lobechat/const';
import type { DeviceExecutionTarget, DeviceListItem, WorkingDirConfig } from '@lobechat/types';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { resolveWorkspaceSurface } from '@/features/ChatInput/ControlBar/useWorkspaceSurface';
import { useDeviceList } from '@/features/DeviceManager/useDeviceList';
import { devicePoolForAgent, devicePoolForTask } from '@/features/ExecutionTargetPicker';
import { resolveAgentWorkingDirectoryConfig } from '@/helpers/agentWorkingDirectory';
import { resolveExecutionTarget } from '@/helpers/executionTarget';
import { useIsGatewayModeEnabled } from '@/helpers/gatewayMode';
import { getWorkingDirectoryPathString } from '@/helpers/workingDirectoryPath';
import { useEffectiveAgencyConfig } from '@/hooks/useEffectiveAgencyConfig';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useElectronStore } from '@/store/electron';

export type DeviceLabelSource = Pick<DeviceListItem, 'deviceId' | 'friendlyName' | 'hostname'>;

export const deviceLabel = (device: DeviceLabelSource, unknownLabel: string) =>
  device.friendlyName || device.hostname || unknownLabel;

/**
 * What the directory axis can offer, which is a property of the TARGET and not
 * of the task: a cloud repo identifier and a path on a machine are the same
 * axis in different units, so the control has to follow where the run goes.
 *
 * - `device` — the run lands on a machine, so the directory is an absolute path
 *   on it (a repo identifier would mean nothing there).
 * - `repo` — the run lands in the server cloud sandbox, where the identifier
 *   IS the directory.
 * - `none` — nothing choosable here; report the inherited state as a hint
 *   rather than offering a control that cannot take effect.
 */
export type TaskDirectoryKind = 'device' | 'none' | 'repo';

export interface TaskRunTarget {
  /** Whether the task may pick a target at all — the assignee's policy owns this. */
  canSelect: boolean;
  /** The machine the run lands on (task pin → agent bound device). */
  deviceId?: string;
  /**
   * The devices this task may pin — the pool its runs can reach, not every
   * device the caller can see (see `devicePoolForAgent`).
   */
  devices?: DeviceListItem[];
  directoryKind: TaskDirectoryKind;
  /** Where the run lands: the task's pin if it has one, else the agent's own target. */
  effectiveTarget: DeviceExecutionTarget;
  /**
   * The directory the run will start in when the task does not choose one,
   * resolved through the same chain the runtime uses. Shown as the greyed hint
   * so inheritance is legible instead of a black box.
   */
  inheritedDirectory?: WorkingDirConfig;
  /** Label for the target the task inherits — the same wording the chat chip uses. */
  inheritedLabel: string;
  /**
   * What the run would do with no pin. Kept alongside {@link effectiveTarget} so
   * the "follow the agent" row can show the inherited glyph even while the task
   * is pinned somewhere else.
   */
  inheritedTarget: DeviceExecutionTarget;
  /** Whether a task-level pin is what puts the run on {@link deviceId}. */
  isDeviceTarget: boolean;
  isPending: boolean;
  /**
   * The task's own pin, and only when the assignee's policy lets it take
   * effect. Callers must read this rather than the raw stored value: a pin the
   * run side drops must not be shown as the target.
   */
  pinnedDeviceId?: string;
}

/**
 * Resolve where a task's runs go, and what its directory axis may offer.
 *
 * One source of truth for the two chips and the hint between them, so the run
 * location control and the directory control cannot disagree about the machine
 * in force — which is exactly how a task ends up storing a repo as the
 * directory of a device run.
 *
 * The task's own pin wins over the agent's target: the run contract routes a
 * `requestedDeviceId` regardless of the agent's stored target. An author-`fixed`
 * policy is the exception — the run side drops the requested device for it, so
 * this reports the inherited target instead of the stored pin.
 */
export const useTaskRunTarget = (agentId: string, pinnedDeviceId?: string): TaskRunTarget => {
  const { t } = useTranslation('chat');
  const { data: devices, isLoading: isDevicesLoading } = useDeviceList();
  const isHetero = useAgentStore(agentByIdSelectors.isAgentHeterogeneousById(agentId));
  // Agent-level, not the active chat topic's: a task run carries no topic
  // binding, so the conversation that happens to be open must not move it.
  const { agencyConfig, canSelectExecutionTarget, isPreferenceLoading, workspaceScoped } =
    useEffectiveAgencyConfig(agentId, { topicId: null });
  const deviceRoutingAvailable = useIsGatewayModeEnabled(agentId);
  const legacyAgentWorkingDirectory = useAgentStore(
    (s) => s.localAgentWorkingDirectoryMap[agentId],
  );
  const agentWorkspaceId = useAgentStore((s) => s.agentMap[agentId]?.workspaceId);
  // This desktop's own device id — the machine a `local` target means here.
  const currentDeviceId = useElectronStore((s) => s.gatewayDeviceInfo?.deviceId);

  // The pool a task may pin from must be the pool its runs can reach: a deviceId
  // carries the identity it was enrolled under, so a workspace agent cannot run
  // on a personal machine (and vice versa) — and a Task's scheduled runs execute
  // under the workspace principal, not under whoever is looking at it, so a pin
  // outside the pool is one automation can never resolve. Same rule the chat
  // picker applies, shared through `devicePoolForAgent` so the two cannot drift.
  // A task narrows it further to public workspace devices: its automated runs
  // execute as the task's creator, who cannot resolve a colleague's private
  // machine (see `devicePoolForTask`).
  const agentPool = devicePoolForAgent(devices, !!agentWorkspaceId);
  const pool = devicePoolForTask(devices, !!agentWorkspaceId);

  const inheritedTarget = resolveExecutionTarget(agencyConfig, {
    clientExecutionAvailable: isDesktop,
    deviceRoutingAvailable,
    isHetero,
    workspaceScoped,
  });

  // A `fixed` selection policy is an author-controlled contract, and the run
  // side already honours it: the planner drops a requested device for it
  // (`resolveExecutionPlan`), and `turnSetup` writes no topic-bound device. So a
  // pin left on the task must NOT be presented as the run's target — nor used to
  // resolve a directory on a machine the run never reaches, which the topic
  // metadata would then still carry.
  const pinApplies = !!pinnedDeviceId && canSelectExecutionTarget;
  const isDeviceTarget = pinApplies;
  const effectiveTarget: DeviceExecutionTarget = pinApplies ? 'device' : inheritedTarget;
  // A workspace agent's `local` target is the member's own machine, which the
  // task's automation and collaborators cannot resolve unless it is in the task
  // pool (public workspace devices); offering it would pin an unreachable device.
  const localCandidate = agencyConfig?.boundDeviceId || currentDeviceId;
  const localDeviceId =
    localCandidate &&
    (!agentWorkspaceId || pool.some((device) => device.deviceId === localCandidate))
      ? localCandidate
      : undefined;

  // A `local` target is a machine too — this desktop. A task run carries no
  // `localDeviceId`, so the server routes it to the agent's bound device (the
  // desktop syncs its own id there); fall back to this desktop's id when the
  // binding has not been written yet. Without this the directory axis showed a
  // dead "Follow agent" hint, although the run starts in a path on a machine.
  // Picking a directory then pins this machine (`applyTaskDirectorySelection`),
  // so the run is routed to where the path exists.
  const deviceId = pinApplies
    ? pinnedDeviceId
    : inheritedTarget === 'device'
      ? agencyConfig?.boundDeviceId
      : inheritedTarget === 'local'
        ? localDeviceId
        : undefined;

  // From the device list this hook already fetched, not the device store,
  // which a task page may never populate.
  const deviceDefaultCwd = getWorkingDirectoryPathString(
    devices?.find((device) => device.deviceId === deviceId)?.defaultCwd ?? undefined,
  );

  // Only a device run has a machine whose default could apply; asking for one
  // otherwise would describe a directory the cloud run never uses.
  const inheritedDirectory = useMemo(
    () =>
      deviceId
        ? resolveAgentWorkingDirectoryConfig({
            agencyConfig,
            // The machine in force decides which per-device choice applies.
            currentDeviceId: deviceId,
            deviceDefaultCwd,
            legacyAgentWorkingDirectory,
            workspaceScoped,
          })
        : undefined,
    [agencyConfig, deviceDefaultCwd, deviceId, legacyAgentWorkingDirectory, workspaceScoped],
  );

  const surface = resolveWorkspaceSurface({
    agencyConfig,
    alwaysShowWorkspace: isHetero,
    clientExecutionAvailable: isDesktop,
    deviceRoutingAvailable,
    isHetero,
    workspaceScoped,
  });

  // The machine in force can come from the task's own pin OR from the assignee
  // (a bound `device` target) — both mean the run starts in a path on that
  // machine, so both must offer the directory control. Requiring a TASK-level
  // pin here left an inherited device run with a non-interactive hint and no way
  // to choose a directory, even though the stored config and the runner support
  // a directory without one.
  const directoryKind: TaskDirectoryKind = deviceId
    ? 'device'
    : surface === 'cloudRepo'
      ? 'repo'
      : 'none';

  const unknownLabel = t('heteroAgent.executionTarget.unknownDevice');
  const inheritedLabel = (() => {
    if (inheritedTarget === 'device') {
      // The agent's own binding may be a private device: label it from the
      // agent's pool, not the narrower set a task may pin.
      const bound = agentPool.find((device) => device.deviceId === agencyConfig?.boundDeviceId);
      return bound ? deviceLabel(bound, unknownLabel) : unknownLabel;
    }
    return t(`heteroAgent.executionTarget.${inheritedTarget}`);
  })();

  return {
    canSelect: canSelectExecutionTarget,
    deviceId,
    devices: pool,
    directoryKind,
    effectiveTarget,
    inheritedDirectory,
    inheritedLabel,
    inheritedTarget,
    isDeviceTarget,
    isPending: isPreferenceLoading || isDevicesLoading,
    pinnedDeviceId: pinApplies ? pinnedDeviceId : undefined,
  };
};
