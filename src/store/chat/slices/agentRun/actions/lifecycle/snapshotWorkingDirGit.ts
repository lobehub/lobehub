import { isDesktop } from '@lobechat/const';
import type { WorkingDirConfig, WorkingDirGithubState } from '@lobechat/types';
import { getWorkingDirEffectivePath } from '@lobechat/types';
import isEqual from 'fast-deep-equal';

import { resolveTargetDeviceId } from '@/helpers/agentWorkingDirectory';
import { electronGitService } from '@/services/electron/git';
import { type GitLinkedPRSummary, gitService } from '@/services/git';
import { getAgentStoreState } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import type { ChatStore } from '@/store/chat/store';
import { deviceSelectors, getDeviceStoreState } from '@/store/device';
import { getElectronStoreState } from '@/store/electron';

import { topicSelectors } from '../../../topic/selectors';

/**
 * Resolve the working directory's repo type the SAME way the ControlBar's
 * `useRepoType` does — from the device's persisted `workingDirs[].repoType`, then
 * (local machine only) a filesystem probe. Deliberately NOT read off the topic's
 * stored `workingDirectoryConfig.repoType`: legacy topics persist only
 * `workingDirectory` with no config, so a config-based gate would skip them and
 * never refresh their branch/PR snapshot.
 */
const resolveRepoType = async (params: {
  isLocalDevice: boolean;
  path: string;
  targetDeviceId?: string;
}): Promise<'git' | 'github' | undefined> => {
  const { isLocalDevice, path, targetDeviceId } = params;
  const fromDevice = deviceSelectors
    .getDeviceWorkingDirs(targetDeviceId)(getDeviceStoreState())
    .find((d) => d.path === path || getWorkingDirEffectivePath(d) === path)?.repoType;
  if (fromDevice) return fromDevice;
  // A remote device's filesystem isn't reachable here — only probe the local one.
  if (isLocalDevice) return electronGitService.detectRepoType(path);
  return undefined;
};

const toGithubMetadata = (prData?: GitLinkedPRSummary): WorkingDirGithubState | undefined => {
  if (!prData) return undefined;

  return {
    ...(prData.extraCount === undefined ? {} : { extraPullRequestCount: prData.extraCount }),
    pullRequest: prData.pullRequest ?? null,
    pullRequestStatus: prData.pullRequestStatus ?? (prData.ghMissing ? 'gh-missing' : 'ok'),
  };
};

/**
 * Capture the working directory's live branch + linked PR onto the topic's
 * `workingDirectoryConfig` at SEND time.
 *
 * This is the sole writer of the branch/PR snapshot into topic metadata. It used
 * to live as a reactive effect in the ControlBar's `GitStatus`, but that fired on
 * every mount — so merely OPENING a topic re-stamped it with whatever branch the
 * shared working directory happened to be on, clobbering the historical snapshot.
 * Anchoring it to `afterUserMessagePersisted` matches the product contract ("the
 * chat branch reflects the last-used active branch; sending a message updates
 * it") and leaves `GitStatus` a pure live display of the current directory.
 *
 * Fire-and-forget: the `gh pr list` leg is slow (8s timeout), so callers must not
 * await it on the send path. It only ever patches topic metadata, idempotently.
 */
export const snapshotTopicWorkingDirGit = async (
  get: () => ChatStore,
  { agentId, topicId }: { agentId: string; topicId: string },
): Promise<void> => {
  const topic = topicSelectors.getTopicById(topicId)(get());
  if (!topic) return;

  const currentConfig = topic.metadata?.workingDirectoryConfig;
  const path = getWorkingDirEffectivePath(currentConfig) ?? topic.metadata?.workingDirectory;
  if (!path) return;

  const agentState = getAgentStoreState();
  const agencyConfig = agentByIdSelectors.getAgencyConfigById(agentId)(agentState);
  const currentDeviceId = getElectronStoreState().gatewayDeviceInfo?.deviceId;
  const targetDeviceId = resolveTargetDeviceId(agencyConfig, currentDeviceId);
  const isLocalDevice = isDesktop && !!targetDeviceId && targetDeviceId === currentDeviceId;
  const deviceId = isLocalDevice ? undefined : targetDeviceId;

  // Same transport gate as `gitHooks.isEnabled`: a local read needs `isDesktop`,
  // a remote read needs a `deviceId`. Neither → nothing to probe.
  if (!deviceId && !isDesktop) return;

  // Branch/PR snapshot is only meaningful for a GitHub repo — mirror GitStatus's
  // `isGithub` gate (non-github repos never show a PR chip). Resolve it live (the
  // config's own `repoType` may be absent on legacy topics); the stored value is
  // still a valid fast path when present.
  const repoType =
    currentConfig?.repoType ?? (await resolveRepoType({ isLocalDevice, path, targetDeviceId }));
  if (repoType !== 'github') return;

  const branchInfo = await gitService.getGitBranch({ deviceId, path });
  const branch = branchInfo?.branch;
  const detached = branchInfo?.detached;
  // No branch ref to query (unprobed / detached HEAD) → leave the prior snapshot.
  if (!branch || detached) return;

  const prData = await gitService.getLinkedPullRequest({ branch, deviceId, path });
  const github = toGithubMetadata(prData);
  if (!github) return;

  const source = currentConfig?.path ?? path;
  const isWorktree = source !== path;
  const git: NonNullable<WorkingDirConfig['git']> = {
    ...currentConfig?.git,
    branch,
    github,
    isWorktree,
  };
  delete git.detached;
  if (isWorktree) git.activeWorktree = path;
  else delete git.activeWorktree;

  const nextConfig: WorkingDirConfig = {
    ...currentConfig,
    git,
    path: source,
    repoType: 'github',
  };

  if (isEqual(currentConfig, nextConfig)) return;
  await get().updateTopicMetadata(topicId, { workingDirectoryConfig: nextConfig });
};
