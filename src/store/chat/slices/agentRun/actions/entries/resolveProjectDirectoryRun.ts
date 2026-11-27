import {
  type AgentOwnDevice,
  getAgentOwnDevice,
  OwnDeviceUnavailableError,
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
  /** It fell back to the sandbox from its agent's own device (set by the server). */
  projectSandboxFallback?: boolean;
  projectWorkingDirectoryId?: string | null;
}

/** The agent's own device's presence in the device replica; `unknown` before it is confirmed. */
const ownDevicePresence = (ownDevice: AgentOwnDevice): 'offline' | 'online' | 'unknown' => {
  const device = deviceSelectors
    .deviceList(getDeviceStoreState())
    .find((item) => item.deviceId === ownDevice.deviceId);
  if (!device || device.onlineUnknown) return 'unknown';
  return device.online ? 'online' : 'offline';
};

/**
 * An Auto draft whose folder the agent's own device can no longer run it in —
 * the device changed since it was staged, or went offline — goes where Auto
 * would stage it now: the own device's folder while that device is online,
 * else the project alone, where the sandbox fallback or the device-only
 * refusal applies. Read from the replicas; a cold one, or a device whose
 * presence is not known yet, leaves the draft to the server check.
 */
const retargetAutoDraft = (
  staged: PendingNewTopicDirectory | undefined,
  ownDevice: AgentOwnDevice | undefined,
): PendingNewTopicDirectory | undefined => {
  if (!staged?.auto || !ownDevice || !staged.projectWorkingDirectoryId) return staged;
  const directory = findProjectDirectory(staged.projectWorkingDirectoryId);
  if (!directory) return staged;
  const presence = ownDevicePresence(ownDevice);
  if (directory.deviceId === ownDevice.deviceId && presence !== 'offline') return staged;
  const own =
    presence === 'online'
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
 * Auto draft on that device's project directory, as the draft staged it. A
 * draft staged on the project alone runs on that device in the agent's own
 * working directory while the device is online (no project folder is needed
 * there). With the device offline, one that may use the sandbox runs there —
 * and keeps running there for the conversation's later sends,
 * `ownDeviceFallback` says so — while a device-only one is refused
 * (`OwnDeviceUnavailableError`) rather than moved to another device. The
 * server applies the same rule to the run and marks a fallen-back
 * conversation (`withProjectSandboxFallback`): this per-send target only
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
    const presence = ownDevice && ownDevicePresence(ownDevice);
    const newTopicProject = stagedProjectId ? { projectId: stagedProjectId } : undefined;
    if (autoDraft && ownDevice) {
      // Its own device, in its own working directory: the agent's own target.
      if (presence !== 'offline')
        return { agencyConfig, newTopicProject, stagedDirectory: undefined, stagedProjectId };
      // Offline: a device-only agent stays off every other runner, the sandbox included.
      if (!ownDevice.sandboxFallback) throw new OwnDeviceUnavailableError('offline');
      return {
        agencyConfig: { ...agencyConfig, executionTarget: 'sandbox' } as T,
        newTopicProject,
        ownDeviceFallback: 'offline' as const,
        stagedDirectory: undefined,
        stagedProjectId,
      };
    }
    // A project conversation without a directory whose agent fell back from
    // its own device stays in the sandbox it began in (see the helper).
    const sandboxTopic =
      !staged &&
      projectTopicFallsBackToSandbox(
        agencyConfig,
        boundTopic && {
          ...boundTopic,
          metadata: {
            boundDeviceId: boundTopic.boundDeviceId,
            projectSandboxFallback: boundTopic.projectSandboxFallback,
          },
        },
        presence === 'unknown' ? undefined : presence === 'online',
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
      newTopicProject,
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
