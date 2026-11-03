import { isDesktop } from '@lobechat/const';

import { useElectronStore } from '@/store/electron';

import { useStagedProjectDirectory } from './useProjectTopicDirectory';
import { useRepoType } from './useRepoType';

export interface StagedProjectGitTarget {
  /** Undefined for this desktop, which probes its own filesystem over IPC. */
  deviceId?: string;
  isGithub: boolean;
  path: string;
}

/**
 * Where a blank conversation staged in a project directory reads its git
 * status: that directory, on its own device. The conversation will run there,
 * not in the agent default the control bar otherwise resolves. Undefined until
 * the directory is known to be a repo.
 */
export const useStagedProjectGitTarget = (agentId: string): StagedProjectGitTarget | undefined => {
  const { directories, directoryId } = useStagedProjectDirectory(agentId);
  const directory = directories.find((d) => d.id === directoryId);
  const currentDeviceId = useElectronStore((s) => s.gatewayDeviceInfo?.deviceId);
  const deviceId = directory?.deviceId ?? undefined;
  const repoType = useRepoType(directory?.path, deviceId);

  if (!directory?.path || !repoType) return;

  const isLocalDevice = isDesktop && !!deviceId && deviceId === currentDeviceId;

  return {
    deviceId: isLocalDevice ? undefined : deviceId,
    isGithub: repoType === 'github',
    path: directory.path,
  };
};
