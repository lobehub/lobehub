import type { ChatTopicMetadata, DeviceGitLinkedPullRequest } from '@lobechat/types';
import {
  getTopicMetadataWorkingDirectoryEffectivePath,
  getTopicMetadataWorkingDirectorySourcePath,
} from '@lobechat/utils/client/topic';
import { cssVar } from 'antd-style';
import type { LucideIcon } from 'lucide-react';
import { GitMerge, GitPullRequestArrow, GitPullRequestClosed } from 'lucide-react';

import { getConfigRepoType, getWorkingDirectoryName } from '@/helpers/workingDirectoryPath';

export type PullRequestState = 'open' | 'merged' | 'closed';

/**
 * Resolve a GitHub PR's lifecycle state. GitHub's `state` is only open|closed;
 * "merged" is a closed PR carrying a `mergedAt`, so check that first.
 */
export const getPullRequestState = (pr: DeviceGitLinkedPullRequest): PullRequestState => {
  if (pr.mergedAt || pr.state === 'merged') return 'merged';
  if (pr.state === 'closed') return 'closed';
  return 'open';
};

// GitHub merged-PR purple. Kept as a constant since antd's token set has no
// semantic "merged" color; the green (success) / red (error) come from tokens.
const MERGED_PURPLE = '#8957e5';

export interface PullRequestStateVisual {
  color: string;
  icon: LucideIcon;
  labelKey: 'metaCard.pr.closed' | 'metaCard.pr.merged' | 'metaCard.pr.open';
}

export const PR_STATE_VISUAL: Record<PullRequestState, PullRequestStateVisual> = {
  closed: { color: cssVar.colorError, icon: GitPullRequestClosed, labelKey: 'metaCard.pr.closed' },
  merged: { color: MERGED_PURPLE, icon: GitMerge, labelKey: 'metaCard.pr.merged' },
  open: { color: cssVar.colorSuccess, icon: GitPullRequestArrow, labelKey: 'metaCard.pr.open' },
};

/**
 * Read the git / worktree / linked-PR context off a topic's persisted
 * `workingDirectoryConfig`. Returns `undefined` when the topic carries no git
 * context, so the caller can skip the hover card entirely (no probe).
 */
export const getTopicMetaCard = (metadata: ChatTopicMetadata | undefined) => {
  const config = metadata?.workingDirectoryConfig;
  const git = config?.git;
  if (!git) return undefined;

  const sourcePath = getTopicMetadataWorkingDirectorySourcePath(metadata);
  const effectivePath = getTopicMetadataWorkingDirectoryEffectivePath(metadata);
  const isWorktree =
    !!git.isWorktree || (!!git.activeWorktree && git.activeWorktree !== sourcePath);

  return {
    branch: git.branch,
    detached: git.detached,
    pullRequest: git.github?.pullRequest ?? undefined,
    repoName: sourcePath ? getWorkingDirectoryName(sourcePath) : undefined,
    repoType: getConfigRepoType(config),
    worktreeName: isWorktree && effectivePath ? getWorkingDirectoryName(effectivePath) : undefined,
  };
};
