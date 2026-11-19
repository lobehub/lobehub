import { isDesktop, isHeterogeneousAgentModelId } from '@lobechat/const';
import type {
  ChatTopicMetadata,
  DeviceGitUpstreamRef,
  WorkingDirConfig,
  WorkingDirGithubState,
} from '@lobechat/types';
import { dropStaleAutoCreated, getWorkingDirEffectivePath } from '@lobechat/types';

import { resolveTargetDeviceId } from '@/helpers/agentWorkingDirectory';
import { applyTopicDeviceBinding } from '@/helpers/executionTarget';
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

/**
 * Where the topic's git reads go: the agent's execution target — or, when the
 * topic is bound to a device (`topicDeviceId`), that device, by the same rules
 * the run applies (`applyTopicDeviceBinding`): a run keeps executing on the
 * topic's device after the agent's default moves elsewhere.
 */
export const resolveTopicGitTransport = (
  agentId: string,
  topicDeviceId?: string,
): TopicGitTransport => {
  const agentState = getAgentStoreState();
  const currentDeviceId = getElectronStoreState().gatewayDeviceInfo?.deviceId;
  const agentAgencyConfig = agentByIdSelectors.getAgencyConfigById(agentId)(agentState);
  const agencyConfig = topicDeviceId
    ? applyTopicDeviceBinding(
        { agencyConfig: agentAgencyConfig, workspaceScoped: false },
        topicDeviceId,
        currentDeviceId,
        {
          isHetero: isHeterogeneousAgentModelId(
            agentByIdSelectors.getAgentModelById(agentId)(agentState),
          ),
        },
      ).agencyConfig
    : agentAgencyConfig;
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
  /**
   * The linked-PR snapshot to record. Omitted under Better Coding Experience,
   * which no longer guesses a PR from the branch: the one already recorded is
   * kept while the branch stays, and dropped once it moves.
   */
  github?: WorkingDirGithubState;
  path: string;
  upstream?: DeviceGitUpstreamRef;
}): WorkingDirConfig => {
  const source = currentConfig?.path ?? path;
  const isWorktree = source !== path;
  const git: NonNullable<WorkingDirConfig['git']> = {
    ...currentConfig?.git,
    branch,
    isWorktree,
  };
  if (github) git.github = github;
  else if (currentConfig?.git?.branch !== branch) delete git.github;

  delete git.detached;
  if (isWorktree) git.activeWorktree = path;
  else delete git.activeWorktree;
  dropStaleAutoCreated(git, currentConfig?.git?.activeWorktree);

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
