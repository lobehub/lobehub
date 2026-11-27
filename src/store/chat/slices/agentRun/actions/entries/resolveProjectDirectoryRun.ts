import {
  type AgentOwnDevice,
  getAgentOwnDevice,
  OwnDeviceUnavailableError,
  type OwnDeviceUnavailableReason,
  projectTopicFallsBackToSandbox,
} from '@/helpers/agentOwnDevice';
import { projectWorkingDirectoryService } from '@/services/projectWorkingDirectory';
import { type PendingNewTopicDirectory } from '@/store/chat/slices/topic/initialState';
import { deviceSelectors, getDeviceStoreState } from '@/store/device';
import { findProjectDirectory, useProjectDirectoryStore } from '@/store/projectWorkingDirectory';

interface DeviceRouting {
  boundDeviceId?: string;
  executionTarget?: string;
  executionTargetSelectionPolicy?: string;
  heterogeneousProvider?: { type?: string };
}

/** A started conversation's place in a project, when it has no directory. */
export interface BoundProjectTopic {
  /** The machine it already ran on, if any. */
  boundDeviceId?: string;
  projectId?: string | null;
  projectWorkingDirectoryId?: string | null;
}

/**
 * Why the agent's own device could not take an Auto draft, read from the
 * project's directory replica: it has a directory there it may run in (so the
 * device is offline or not ready), or none at all.
 */
const ownDeviceReason = (
  projectId: string,
  ownDevice: AgentOwnDevice,
): OwnDeviceUnavailableReason => {
  const directories = useProjectDirectoryStore.getState().directoriesMap[projectId] ?? [];
  return directories.some(
    (directory) => directory.deviceId === ownDevice.deviceId && directory.runnable,
  )
    ? 'offline'
    : 'noDirectory';
};

/**
 * An Auto draft still staged on another device's directory (the agent's own
 * device changed since it was staged) does not follow it there: it moves to
 * the own device's directory while that device is online, or to the project
 * alone, as Auto would stage it now. Read from the replicas; a cold one leaves
 * the draft to the server check.
 */
const retargetAutoDraft = (
  staged: PendingNewTopicDirectory | undefined,
  ownDevice: AgentOwnDevice | undefined,
): PendingNewTopicDirectory | undefined => {
  if (!staged?.auto || !ownDevice || !staged.projectWorkingDirectoryId) return staged;
  const directory = findProjectDirectory(staged.projectWorkingDirectoryId);
  if (!directory || directory.deviceId === ownDevice.deviceId) return staged;
  // Same availability Auto stages by: a ready folder on an online device. An
  // offline one leaves the draft on the project, where the fallback or the
  // device-only refusal applies.
  const device = deviceSelectors
    .deviceList(getDeviceStoreState())
    .find((item) => item.deviceId === ownDevice.deviceId);
  const online = !!device?.online && !device.onlineUnknown;
  const own = online
    ? (useProjectDirectoryStore.getState().directoriesMap[directory.projectId] ?? []).find(
        (row) => row.deviceId === ownDevice.deviceId && row.runnable,
      )
    : undefined;
  return own
    ? { agentId: staged.agentId, auto: true, projectWorkingDirectoryId: own.id }
    : { agentId: staged.agentId, auto: true, projectId: directory.projectId };
};

/**
 * Route a send into the project directory it runs in: the bound topic's, or —
 * for a blank conversation a project group's "+" opened — the staged one. The
 * directory pins the run to its device, so the agent's own device choice is
 * overridden; an agent fixed to another device cannot run there.
 *
 * `stagedDirectory` is set only for the staged case: the caller binds the new
 * topic to it, and hands it back to the blank view if that topic never lands.
 * A draft staged on a project without a directory only yields
 * `stagedProjectId`: the topic is born conversation-only in that project and
 * runs wherever the agent itself routes. `newTopicProject` is what the new
 * topic is bound to in either staged case.
 *
 * A heterogeneous agent with a device of its own (`getAgentOwnDevice`) runs an
 * Auto draft on that device's project directory, as the draft staged it. When
 * the draft could only stage the project (the device is offline or has no
 * directory there), one that may use the sandbox runs there — and keeps
 * running there for the conversation's later sends, `ownDeviceFallback` says
 * why — while a device-only one is refused (`OwnDeviceUnavailableError`)
 * rather than moved to another device. The server applies the same sandbox
 * rule to the run (`projectFallsBackToSandbox`): this per-send target only
 * shapes the client's own plan and does not reach `execAgent`.
 */
export const resolveProjectDirectoryRun = async <T extends DeviceRouting>(params: {
  agencyConfig: T | undefined;
  boundDirectoryId: string | null | undefined;
  /** The started conversation's project binding; omitted for a new topic. */
  boundTopic?: BoundProjectTopic;
  isGatewayMode: boolean;
  staged: PendingNewTopicDirectory | undefined;
}) => {
  const { agencyConfig, boundDirectoryId, boundTopic, isGatewayMode } = params;
  const ownDevice = getAgentOwnDevice(agencyConfig);
  const staged = retargetAutoDraft(params.staged, ownDevice);
  const stagedDirectoryId = staged?.projectWorkingDirectoryId;
  const directoryId = boundDirectoryId ?? stagedDirectoryId;
  if (!directoryId) {
    const stagedProjectId = staged?.projectId;
    const autoDraft = !!staged?.auto && !!stagedProjectId;
    // Auto could not place the agent on its own device: a device-only agent
    // stays off every other runner, the sandbox included.
    if (autoDraft && ownDevice && !ownDevice.sandboxFallback)
      throw new OwnDeviceUnavailableError(ownDeviceReason(stagedProjectId, ownDevice));
    // A project conversation without a directory, started by an agent that
    // fell back from its own device, stays in the sandbox it began in — unless
    // it already ran on a machine.
    const sandboxTopic =
      !staged &&
      projectTopicFallsBackToSandbox(
        agencyConfig,
        boundTopic && { ...boundTopic, metadata: { boundDeviceId: boundTopic.boundDeviceId } },
      );
    // Auto put this draft in the project's sandbox: this send runs there,
    // without rewriting the agent's own target (a draft-local choice must not
    // outlive the draft). A hand-picked sandbox already set the target.
    const autoSandbox =
      (autoDraft && agencyConfig?.executionTargetSelectionPolicy !== 'fixed') || sandboxTopic;
    return {
      agencyConfig: autoSandbox
        ? ({ ...agencyConfig, executionTarget: 'sandbox' } as T)
        : agencyConfig,
      newTopicProject: stagedProjectId ? { projectId: stagedProjectId } : undefined,
      ownDeviceFallback:
        autoDraft && ownDevice ? ownDeviceReason(stagedProjectId, ownDevice) : undefined,
      stagedDirectory: undefined,
      stagedProjectId,
    };
  }

  // The sidebar's directory replica already holds the row; read it locally
  // so the optimistic pair is not held behind a network round trip. The
  // server re-validates the directory (environment link, enabled state,
  // permission) when it starts the run. Only a cold replica pays for resolve.
  const directory =
    findProjectDirectory(directoryId) ??
    (await projectWorkingDirectoryService.resolve(directoryId)).data;
  if (!isGatewayMode) throw new Error('Enable Gateway Mode to run in a project working directory');
  if (
    agencyConfig?.executionTargetSelectionPolicy === 'fixed' &&
    agencyConfig.boundDeviceId !== directory.deviceId
  )
    throw new Error('Agent is fixed to another execution target');

  return {
    agencyConfig: {
      ...agencyConfig,
      boundDeviceId: directory.deviceId,
      executionTarget: 'device',
    } as T,
    newTopicProject: stagedDirectoryId
      ? { projectId: directory.projectId, projectWorkingDirectoryId: directory.id }
      : undefined,
    stagedDirectory: stagedDirectoryId ? directory : undefined,
    stagedProjectId: undefined,
  };
};
