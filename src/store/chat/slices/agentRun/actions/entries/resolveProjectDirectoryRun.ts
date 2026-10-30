import { projectWorkingDirectoryService } from '@/services/projectWorkingDirectory';
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
 */
export const resolveProjectDirectoryRun = async <T extends DeviceRouting>(params: {
  agencyConfig: T | undefined;
  boundDirectoryId: string | null | undefined;
  isGatewayMode: boolean;
  stagedDirectoryId: string | undefined;
}) => {
  const { agencyConfig, boundDirectoryId, isGatewayMode, stagedDirectoryId } = params;
  const directoryId = boundDirectoryId ?? stagedDirectoryId;
  if (!directoryId) return { agencyConfig, stagedDirectory: undefined };

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
    stagedDirectory: stagedDirectoryId ? directory : undefined,
  };
};
