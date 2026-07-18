'use client';

import { isDesktop } from '@lobechat/const';
import type { WorkingDirEntry } from '@lobechat/types';
import { getWorkingDirEffectivePath } from '@lobechat/types';
import { memo } from 'react';

import SafeBoundary from '@/components/ErrorBoundary';
import { resolveTargetDeviceId } from '@/helpers/agentWorkingDirectory';
import { getConfigRepoType, getWorkingDirectoryPathString } from '@/helpers/workingDirectoryPath';
import { useEffectiveAgencyConfig } from '@/hooks/useEffectiveAgencyConfig';
import { useEffectiveWorkingDirectory } from '@/hooks/useEffectiveWorkingDirectory';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { deviceSelectors, useDeviceStore } from '@/store/device';
import { useElectronStore } from '@/store/electron';

import GitStatus from './GitStatus';
import { useRepoType } from './useRepoType';
import WorkingDirectoryPicker from './WorkingDirectoryPicker';

interface WorkingDirectorySectionProps {
  agentId: string;
}

const getEntryEffectivePath = (entry: WorkingDirEntry) => {
  const sourcePath = getWorkingDirectoryPathString(entry.path);
  return getWorkingDirectoryPathString(entry.git?.activeWorktree) ?? sourcePath;
};

/**
 * Working directory + git status, shared by the agent runtime bars. The unified
 * picker handles local and remote targets alike; git status shows for both — the
 * local machine probes its own filesystem, a remote device answers over RPC
 * (read-only) via GitStatus's `deviceId`.
 */
const WorkingDirectorySectionInner = memo<WorkingDirectorySectionProps>(({ agentId }) => {
  // Effective config (shared row + this member's device override, LOBE-11689)
  // so GitStatus probes the same device `useEffectiveWorkingDirectory` resolved
  // the cwd from — raw shared config could point them at different machines.
  const { agencyConfig, workspaceScoped } = useEffectiveAgencyConfig(agentId);
  const currentDeviceId = useElectronStore((s) => s.gatewayDeviceInfo?.deviceId);
  const targetDeviceId = resolveTargetDeviceId(agencyConfig, currentDeviceId, {
    workspaceScoped,
  });
  const isLocalDevice = isDesktop && !!targetDeviceId && targetDeviceId === currentDeviceId;

  const rawEffectiveWorkingDirectory = useEffectiveWorkingDirectory(agentId);
  const effectiveWorkingDirectory = getWorkingDirectoryPathString(rawEffectiveWorkingDirectory);

  // Live probes (fs / cached device dirs) can't resolve repoType for a worktree
  // path that was never registered as a device working dir — so fall back to the
  // repoType persisted on the topic (the same snapshot the meta hover card reads).
  // Without this the whole GitStatus is gated out and branch/worktree/PR chips
  // vanish even though the topic clearly carries git context.
  const topicWorkingDirectoryConfig = useChatStore(
    (s) => topicSelectors.currentTopicMetadata(s)?.workingDirectoryConfig,
  );
  // Only trust the persisted config when it actually describes the directory we
  // resolved — the topic override wins in `useEffectiveWorkingDirectory`, so this
  // holds whenever the config is what produced `effectiveWorkingDirectory`.
  const topicConfigMatchesEffective =
    !!effectiveWorkingDirectory &&
    getWorkingDirEffectivePath(topicWorkingDirectoryConfig) === effectiveWorkingDirectory;
  const persistedConfig = topicConfigMatchesEffective ? topicWorkingDirectoryConfig : undefined;

  // Local machine probes the filesystem for repoType; a remote device's repoType
  // comes from the cached `workingDirs` entry (we can't probe a remote fs here).
  const localRepoType = useRepoType(isLocalDevice ? effectiveWorkingDirectory : undefined);
  const deviceDirs = useDeviceStore(deviceSelectors.getDeviceWorkingDirs(targetDeviceId));
  const currentEntry = effectiveWorkingDirectory
    ? deviceDirs.find((entry) => getEntryEffectivePath(entry) === effectiveWorkingDirectory)
    : undefined;
  const remoteRepoType =
    currentEntry?.repoType === 'git' || currentEntry?.repoType === 'github'
      ? currentEntry.repoType
      : undefined;

  // The SOURCE repo, not the checkout. A persisted-worktree topic has no matching
  // `workingDirs` entry (that's exactly why the repoType probe misses), so without
  // the persisted `config.path` this would collapse to the worktree path — and
  // WorktreeSwitcher commits `sourcePath` as the WorkingDirEntry.path, rewriting
  // the topic's repo source to the linked worktree and breaking later switches.
  const sourceWorkingDirectory =
    getWorkingDirectoryPathString(currentEntry?.path) ??
    getWorkingDirectoryPathString(persistedConfig?.path) ??
    effectiveWorkingDirectory;

  const repoType =
    (isLocalDevice ? localRepoType : remoteRepoType) ?? getConfigRepoType(persistedConfig);

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
