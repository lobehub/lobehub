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

import { useTopicId } from '../hooks/useTopicId';
import GitStatus from './GitStatus';
import { useActiveProjectDirectoryTopicId } from './useProjectTopicDirectory';
import { resolveRepoType, useRepoTypeState } from './useRepoType';
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
  // Effective config (shared row + this member's device override)
  // so GitStatus probes the same device `useEffectiveWorkingDirectory` resolved
  // the cwd from — raw shared config could point them at different machines.
  const topicId = useTopicId();
  const { agencyConfig, workspaceScoped } = useEffectiveAgencyConfig(agentId, { topicId });
  const currentDeviceId = useElectronStore((s) => s.gatewayDeviceInfo?.deviceId);
  const targetDeviceId = resolveTargetDeviceId(agencyConfig, currentDeviceId, {
    workspaceScoped,
  });
  const isLocalDevice = isDesktop && !!targetDeviceId && targetDeviceId === currentDeviceId;

  const rawEffectiveWorkingDirectory = useEffectiveWorkingDirectory(agentId, { topicId });
  const effectiveWorkingDirectory = getWorkingDirectoryPathString(rawEffectiveWorkingDirectory);

  // When the repoType probe cannot answer — the recorded worktree directory was
  // DELETED, or the device is offline — fall back to the repoType persisted on
  // the topic (the same snapshot the meta hover card reads). Without this the
  // whole GitStatus is gated out and branch/worktree/PR chips vanish even though
  // the topic clearly carries git context. The same snapshot also feeds
  // GitStatus's `fallbackGit`, since the live branch probe of a deleted worktree
  // reads nothing either.
  const topicWorkingDirectoryConfig = useChatStore((s) =>
    topicId ? topicSelectors.getTopicById(topicId)(s)?.metadata?.workingDirectoryConfig : undefined,
  );
  // The project owns this conversation's directory and the device switcher
  // already names it, so there is nothing to pick or show here.
  const projectTopicId = useActiveProjectDirectoryTopicId();
  // Only trust the persisted config when it actually describes the directory we
  // resolved — the topic override wins in `useEffectiveWorkingDirectory`, so this
  // holds whenever the config is what produced `effectiveWorkingDirectory`.
  const topicConfigMatchesEffective =
    !!effectiveWorkingDirectory &&
    getWorkingDirEffectivePath(topicWorkingDirectoryConfig) === effectiveWorkingDirectory;
  const persistedConfig = topicConfigMatchesEffective ? topicWorkingDirectoryConfig : undefined;

  // Cached repoType of the target device's dir, re-probed in the background —
  // over IPC locally, through the device's RPC remotely — so a dir that became
  // a repo after it was registered (cloned into later) is corrected.
  const live = useRepoTypeState(
    targetDeviceId ? effectiveWorkingDirectory : undefined,
    targetDeviceId,
  );
  const deviceDirs = useDeviceStore(deviceSelectors.getDeviceWorkingDirs(targetDeviceId));
  const currentEntry = effectiveWorkingDirectory
    ? deviceDirs.find((entry) => getEntryEffectivePath(entry) === effectiveWorkingDirectory)
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

  // A probe that answered is authoritative, "not a repo" included (its `.git`
  // was removed). Only a dir that could not be probed — a deleted worktree, an
  // offline device — falls back to the topic's persisted snapshot.
  const repoType = resolveRepoType(live, getConfigRepoType(persistedConfig));

  return (
    <>
      {!projectTopicId && <WorkingDirectoryPicker agentId={agentId} />}
      {effectiveWorkingDirectory && repoType && (
        <GitStatus
          agentId={agentId}
          deviceId={isLocalDevice ? undefined : targetDeviceId}
          fallbackGit={persistedConfig?.git}
          isGithub={repoType === 'github'}
          path={effectiveWorkingDirectory}
          sourcePath={sourceWorkingDirectory}
          topicId={topicId}
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
