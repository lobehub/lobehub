import { isDesktop } from '@lobechat/const';
import type {
  ChatTopicMetadata,
  DeviceGitUpstreamRef,
  WorkingDirConfig,
  WorkingDirGithubState,
} from '@lobechat/types';
import { getWorkingDirEffectivePath } from '@lobechat/types';

import { resolveTargetDeviceId } from '@/helpers/agentWorkingDirectory';
import type { GitLinkedPRSummary } from '@/services/git';
import { getAgentStoreState } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { getElectronStoreState } from '@/store/electron';

export interface TopicGitTransport {
  deviceId?: string;
  isLocalDevice: boolean;
  targetDeviceId?: string;
}

export interface TopicLinkedPullRequestBase {
  branch: string;
  currentConfig?: WorkingDirConfig;
  path: string;
  pullRequestNumber?: number;
}

export const canReadTopicGitTransport = (transport: Pick<TopicGitTransport, 'deviceId'>) =>
  !!transport.deviceId || isDesktop;

export const resolveTopicGitTransport = (agentId: string): TopicGitTransport => {
  const agentState = getAgentStoreState();
  const agencyConfig = agentByIdSelectors.getAgencyConfigById(agentId)(agentState);
  const currentDeviceId = getElectronStoreState().gatewayDeviceInfo?.deviceId;
  const targetDeviceId = resolveTargetDeviceId(agencyConfig, currentDeviceId);
  const isLocalDevice = isDesktop && !!targetDeviceId && targetDeviceId === currentDeviceId;

  return {
    deviceId: isLocalDevice ? undefined : targetDeviceId,
    isLocalDevice,
    targetDeviceId,
  };
};

export const getTopicLinkedPullRequestBase = (
  metadata?: ChatTopicMetadata,
): TopicLinkedPullRequestBase | undefined => {
  const currentConfig = metadata?.workingDirectoryConfig;
  const git = currentConfig?.git;
  const branch = git?.branch;
  const path = getWorkingDirEffectivePath(currentConfig) ?? metadata?.workingDirectory;
  const repoType =
    currentConfig?.repoType ??
    (git?.github ? 'github' : undefined) ??
    (isDesktop ? undefined : 'github');

  if (!path || !branch || git?.detached || repoType !== 'github') return undefined;

  return {
    branch,
    currentConfig,
    path,
    pullRequestNumber: git?.github?.pullRequest?.number,
  };
};

export const isSuccessfulLinkedPullRequestLookup = (
  prData?: GitLinkedPRSummary,
): prData is GitLinkedPRSummary =>
  !!prData && !prData.ghMissing && (prData.pullRequestStatus ?? 'ok') === 'ok';

export const toWorkingDirGithubState = (
  prData?: GitLinkedPRSummary,
): WorkingDirGithubState | undefined => {
  if (!prData) return undefined;

  return {
    ...(prData.extraCount === undefined ? {} : { extraPullRequestCount: prData.extraCount }),
    pullRequest: prData.pullRequest ?? null,
    pullRequestStatus: prData.pullRequestStatus ?? (prData.ghMissing ? 'gh-missing' : 'ok'),
  };
};

export const mergeWorkingDirGithubState = ({
  branch,
  currentConfig,
  github,
  path,
  upstream,
}: {
  branch: string;
  currentConfig?: WorkingDirConfig;
  github: WorkingDirGithubState;
  path: string;
  upstream?: DeviceGitUpstreamRef;
}): WorkingDirConfig => {
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

  // A probe that resolved no remote ref means the branch is unpushed or its trace is
  // gone — not that a previously recorded ref is wrong. Keep the old one rather than
  // erase the topic's only cross-device handle on a transient miss; the writers that
  // know the branch MOVED (switch / worktree / push-to-a-new-ref) clear it explicitly.
  if (upstream) git.upstream = upstream;

  return {
    ...currentConfig,
    git,
    path: source,
    repoType: 'github',
  };
};
