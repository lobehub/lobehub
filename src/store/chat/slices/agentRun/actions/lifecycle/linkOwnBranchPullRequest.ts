import { getWorkingDirEffectivePath } from '@lobechat/types';

import { gitService } from '@/services/git';
import { workService } from '@/services/work';
import type { ChatStore } from '@/store/chat/store';
import {
  canReadTopicGitTransport,
  resolveTopicGitTransport,
} from '@/store/chat/utils/topicWorkingDirGit';

import { topicSelectors } from '../../../topic/selectors';

const sameRepo = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/**
 * At the end of a run, link the open PR of the
 * branch the topic CREATED — its first-send worktree branch, or one its agent
 * made — when someone opened it outside the agent's commands (on GitHub, from
 * another tool). Never for a branch the topic merely switched to: that is the
 * branch guess the lab removed, and it may carry someone else's PR.
 *
 * The device answers `gh pr list --head <remote ref>`. The link is a topic
 * link (`source: 'branch'`), vouched only when the PR's head lives in the
 * repository the topic pushes to — a same-named branch in a stranger's fork is
 * listed but stays locked. Best-effort; never throws.
 */
export const linkOwnBranchPullRequest = async (
  get: () => ChatStore,
  { agentId, topicId }: { agentId: string; topicId: string },
): Promise<void> => {
  try {
    const topic = topicSelectors.getTopicById(topicId)(get());
    const config = topic?.metadata?.workingDirectoryConfig;
    const git = config?.git;
    if (!git?.ownBranch || git.detached || git.branch !== git.ownBranch) return;
    // Unpushed: GitHub cannot have a PR for it yet, and asking `gh` is not free.
    if (!git.upstream) return;

    const path = getWorkingDirEffectivePath(config);
    if (!path) return;
    // The device the topic is bound to, where its runs (and this worktree) live.
    const { deviceId } = resolveTopicGitTransport(agentId, topic?.metadata?.boundDeviceId);
    if (!canReadTopicGitTransport({ deviceId })) return;

    // Open PRs only: an all-state list returns the newest first, which may be a
    // closed / merged PR hiding the open one this lookup is for.
    const lookup = await gitService.getLinkedPullRequest({
      branch: git.ownBranch,
      deviceId,
      path,
      state: 'open',
    });
    const pr = lookup?.pullRequestStatus === 'ok' ? lookup.pullRequest : null;
    if (!pr || pr.state.toLowerCase() !== 'open') return;

    const { linked } = await workService.linkTopicPullRequest({
      headRefName: pr.headRefName ?? lookup?.upstream?.branch,
      source: 'branch',
      title: pr.title,
      topicId,
      url: pr.url,
      vouched: sameRepo(pr.headRepoFullName, lookup?.remoteRepoFullName),
    });
    if (linked) await workService.refreshTopicPullRequests(topicId);
  } catch (error) {
    console.error('[linkOwnBranchPullRequest] failed:', error);
  }
};
