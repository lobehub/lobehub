import { isDesktop, isHeterogeneousAgentModelId } from '@lobechat/const';
import type { DeviceGitUpstreamRef, WorkingDirConfig } from '@lobechat/types';
import { dropStaleAutoCreated } from '@lobechat/types';

import { resolveTargetDeviceId } from '@/helpers/agentWorkingDirectory';
import { applyTopicDeviceBinding } from '@/helpers/executionTarget';
import { getAgentStoreState } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { getElectronStoreState } from '@/store/electron';

export interface TopicGitTransport {
  deviceId?: string;
  isLocalDevice: boolean;
  targetDeviceId?: string;
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

/**
 * Record the working directory's live branch (and its remote ref) on the
 * topic's config. A PR snapshot recorded by an older client is kept while the
 * branch stays, and dropped once it moves.
 */
export const mergeWorkingDirGitBranch = ({
  branch,
  currentConfig,
  path,
  upstream,
}: {
  branch: string;
  currentConfig?: WorkingDirConfig;
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
  if (currentConfig?.git?.branch !== branch) delete git.github;

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
