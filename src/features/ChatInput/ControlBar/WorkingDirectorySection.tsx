'use client';

import { isDesktop } from '@lobechat/const';
import { memo } from 'react';

import { resolveTargetDeviceId } from '@/helpers/agentWorkingDirectory';
import { useEffectiveWorkingDirectory } from '@/hooks/useEffectiveWorkingDirectory';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { deviceSelectors, useDeviceStore } from '@/store/device';
import { useElectronStore } from '@/store/electron';

import GitStatus from './GitStatus';
import { useRepoType } from './useRepoType';
import WorkingDirectoryPicker from './WorkingDirectoryPicker';

interface WorkingDirectorySectionProps {
  agentId: string;
}

/**
 * Working directory + git status, shared by the agent runtime bars. The unified
 * picker handles local and remote targets alike; git status shows for both — the
 * local machine probes its own filesystem, a remote device answers over RPC
 * (read-only) via GitStatus's `deviceId`.
 */
const WorkingDirectorySection = memo<WorkingDirectorySectionProps>(({ agentId }) => {
  const agencyConfig = useAgentStore(agentByIdSelectors.getAgencyConfigById(agentId));
  const currentDeviceId = useElectronStore((s) => s.gatewayDeviceInfo?.deviceId);
  const targetDeviceId = resolveTargetDeviceId(agencyConfig, currentDeviceId);
  const isLocalDevice = isDesktop && !!targetDeviceId && targetDeviceId === currentDeviceId;

  const effectiveWorkingDirectory = useEffectiveWorkingDirectory(agentId);

  // Local machine probes the filesystem for repoType; a remote device's repoType
  // comes from the cached `workingDirs` entry (we can't probe a remote fs here).
  const localRepoType = useRepoType(isLocalDevice ? effectiveWorkingDirectory : undefined);
  const remoteDirs = useDeviceStore(deviceSelectors.getDeviceWorkingDirs(targetDeviceId));
  const remoteRepoType = remoteDirs.find((d) => d.path === effectiveWorkingDirectory)?.repoType;
  const repoType = isLocalDevice ? localRepoType : remoteRepoType;

  return (
    <>
      <WorkingDirectoryPicker agentId={agentId} />
      {effectiveWorkingDirectory && repoType && (
        <GitStatus
          deviceId={isLocalDevice ? undefined : targetDeviceId}
          isGithub={repoType === 'github'}
          path={effectiveWorkingDirectory}
        />
      )}
    </>
  );
});

WorkingDirectorySection.displayName = 'WorkingDirectorySection';

export default WorkingDirectorySection;
