'use client';

import { isDesktop } from '@lobechat/const';
import { isRecord } from '@lobechat/utils';
import { memo } from 'react';

import SafeBoundary from '@/components/ErrorBoundary';
import { resolveTargetDeviceId } from '@/helpers/agentWorkingDirectory';
import { getWorkingDirectoryPathString } from '@/helpers/workingDirectoryPath';
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

const getEntryEffectivePath = (entry: unknown) => {
  if (!isRecord(entry)) return;

  const sourcePath = getWorkingDirectoryPathString(entry.path);
  const git = isRecord(entry.git) ? entry.git : undefined;
  return getWorkingDirectoryPathString(git?.activeWorktree) ?? sourcePath;
};

/**
 * Working directory + git status, shared by the agent runtime bars. The unified
 * picker handles local and remote targets alike; git status shows for both — the
 * local machine probes its own filesystem, a remote device answers over RPC
 * (read-only) via GitStatus's `deviceId`.
 */
const WorkingDirectorySectionInner = memo<WorkingDirectorySectionProps>(({ agentId }) => {
  const agencyConfig = useAgentStore(agentByIdSelectors.getAgencyConfigById(agentId));
  const currentDeviceId = useElectronStore((s) => s.gatewayDeviceInfo?.deviceId);
  const targetDeviceId = resolveTargetDeviceId(agencyConfig, currentDeviceId);
  const isLocalDevice = isDesktop && !!targetDeviceId && targetDeviceId === currentDeviceId;

  const rawEffectiveWorkingDirectory = useEffectiveWorkingDirectory(agentId);
  const effectiveWorkingDirectory = getWorkingDirectoryPathString(rawEffectiveWorkingDirectory);

  // Local machine probes the filesystem for repoType; a remote device's repoType
  // comes from the cached `workingDirs` entry (we can't probe a remote fs here).
  const localRepoType = useRepoType(isLocalDevice ? effectiveWorkingDirectory : undefined);
  const deviceDirs = useDeviceStore(deviceSelectors.getDeviceWorkingDirs(targetDeviceId));
  const currentEntry = effectiveWorkingDirectory
    ? deviceDirs.find((entry) => getEntryEffectivePath(entry) === effectiveWorkingDirectory)
    : undefined;
  const sourceWorkingDirectory =
    (isRecord(currentEntry) ? getWorkingDirectoryPathString(currentEntry.path) : undefined) ??
    effectiveWorkingDirectory;
  const remoteRepoType =
    currentEntry?.repoType === 'git' || currentEntry?.repoType === 'github'
      ? currentEntry.repoType
      : undefined;
  const repoType = isLocalDevice ? localRepoType : remoteRepoType;

  return (
    <>
      <WorkingDirectoryPicker agentId={agentId} />
      {effectiveWorkingDirectory && repoType && (
        <GitStatus
          agentId={agentId}
          deviceId={isLocalDevice ? undefined : targetDeviceId}
          isGithub={repoType === 'github'}
          path={effectiveWorkingDirectory}
          sourcePath={sourceWorkingDirectory}
        />
      )}
    </>
  );
});

WorkingDirectorySectionInner.displayName = 'WorkingDirectorySectionInner';

const WorkingDirectorySection = memo<WorkingDirectorySectionProps>(({ agentId }) => (
  <SafeBoundary minHeight={22} resetKeys={[agentId]}>
    <WorkingDirectorySectionInner agentId={agentId} />
  </SafeBoundary>
));

WorkingDirectorySection.displayName = 'WorkingDirectorySection';

export default WorkingDirectorySection;
