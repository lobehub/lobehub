import { gitService } from '@/services/git';
import { workService } from '@/services/work';

/** Waits before re-asking while the push's tool row is still being persisted. */
export const PUSH_LINK_RETRY_DELAYS = [1500, 4000, 10_000];

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * After an agent's `git push` (Better Coding Experience), link the pull
 * request the pushed branch already has to the topic.
 *
 * The execution device answers which PR heads the branch (`gh pr list --head`
 * on its remote ref) — the only source when no GitHub App tracks the repo.
 * The SERVER decides: it re-reads the push from the persisted tool message,
 * prefers the GitHub App's rows, and accepts the device's answer only for the
 * repository and branch git itself reported. Only an open PR is offered: a
 * merged or closed one that happened to share the branch name is not the one
 * this push is for.
 *
 * Best-effort; never throws. Resolves to the linked identifiers.
 */
export const linkPushedPullRequests = async (params: {
  branch: string;
  deviceId?: string;
  path: string;
  toolCallId: string;
  topicId: string;
}): Promise<string[]> => {
  try {
    const lookup = await gitService.getLinkedPullRequest({
      branch: params.branch,
      deviceId: params.deviceId,
      path: params.path,
    });
    const pr = lookup?.pullRequestStatus === 'ok' ? lookup.pullRequest : null;
    const headRefName = lookup?.upstream?.branch;
    const pullRequests =
      pr && headRefName && pr.state.toLowerCase() === 'open'
        ? [
            {
              headRefName,
              ...(pr.headRepoFullName ? { headRepoFullName: pr.headRepoFullName } : {}),
              isDraft: pr.isDraft,
              number: pr.number,
              state: pr.state,
              title: pr.title,
              url: pr.url,
            },
          ]
        : [];

    for (let attempt = 0; ; attempt++) {
      const result = await workService.linkPushedPullRequests({
        pullRequests,
        toolCallId: params.toolCallId,
        topicId: params.topicId,
      });
      if (result.status === 'linked') {
        if (result.linked.length > 0) await workService.refreshTopicPullRequests(params.topicId);
        return result.linked;
      }
      if (result.status === 'skipped' || attempt >= PUSH_LINK_RETRY_DELAYS.length) return [];
      await wait(PUSH_LINK_RETRY_DELAYS[attempt]);
    }
  } catch (error) {
    console.error('[linkPushedPullRequests] failed:', error);
    return [];
  }
};
