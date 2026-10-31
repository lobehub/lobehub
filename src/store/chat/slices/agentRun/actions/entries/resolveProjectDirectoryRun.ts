import { projectWorkingDirectoryService } from '@/services/projectWorkingDirectory';
import { type PendingNewTopicDirectory } from '@/store/chat/slices/topic/initialState';
import { findProjectDirectory } from '@/store/projectWorkingDirectory';

interface DeviceRouting {
  boundDeviceId?: string;
  executionTarget?: string;
  executionTargetSelectionPolicy?: string;
}

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
 */
export const resolveProjectDirectoryRun = async <T extends DeviceRouting>(params: {
  agencyConfig: T | undefined;
  boundDirectoryId: string | null | undefined;
  isGatewayMode: boolean;
  staged: PendingNewTopicDirectory | undefined;
}) => {
  const { agencyConfig, boundDirectoryId, isGatewayMode, staged } = params;
  const stagedDirectoryId = staged?.projectWorkingDirectoryId;
  const directoryId = boundDirectoryId ?? stagedDirectoryId;
  if (!directoryId) {
    const stagedProjectId = staged?.projectId;
    return {
      agencyConfig,
      newTopicProject: stagedProjectId ? { projectId: stagedProjectId } : undefined,
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
