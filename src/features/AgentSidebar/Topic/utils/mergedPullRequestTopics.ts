import type { DeviceGitPullRequestDetail, TopicPullRequestItem } from '@lobechat/types';

import {
  resolvePullRequestView,
  type TopicPullRequestView,
} from '@/features/TopicPullRequests/pullRequestView';
import { type ChatTopic } from '@/types/topic';

/** `owner/repo#number`, lower-cased: how device reads are matched to linked PRs. */
export const pullRequestIdentityKey = (repoFullName: string, number: number) =>
  `${repoFullName.toLowerCase()}#${number}`;

/**
 * Topics the "archive merged PR topics" actions may touch: still open (not
 * completed, archived or unread). Pass `ownerId` to keep only that user's
 * topics (a workspace member's own scope); `null` keeps none.
 */
export const getArchivableTopics = (topics: ChatTopic[], ownerId?: string | null): ChatTopic[] =>
  topics.filter((topic) => {
    if (ownerId !== undefined && (!ownerId || topic.userId !== ownerId)) return false;
    return topic.status !== 'completed' && topic.status !== 'archived' && topic.status !== 'unread';
  });

/**
 * Whether a topic's linked pull requests say its work has landed:
 *
 * - at least one of them is merged, and
 * - none is still open (a draft is open too) — the topic is still in flight.
 *
 * A PR closed without merging (superseded, abandoned) neither counts nor
 * blocks. Only PRs the app can vouch belong to the topic count at all: a
 * branch-name match it cannot vouch for may be someone else's PR. A PR whose
 * state nothing confirmed reads as the status the agent's commands left, open
 * when there is none — so an unknown PR keeps the topic.
 */
export const hasLandedPullRequests = (
  views: Pick<TopicPullRequestView, 'state' | 'vouched'>[],
): boolean => {
  const vouched = views.filter((view) => view.vouched);
  return (
    vouched.some((view) => view.state === 'merged') &&
    !vouched.some((view) => view.state === 'open')
  );
};

/**
 * The topics whose pull requests have landed (see {@link hasLandedPullRequests}),
 * from their Work-row listing. `deviceMerges` are execution-device
 * `gh pr view` reads showing a merge, keyed by {@link pullRequestIdentityKey}:
 * without the GitHub App they are what knows a PR was merged on GitHub rather
 * than by the agent. Pass merged reads only — a stale "open" read would hide a
 * merge the server already knows of.
 */
export const getMergedPullRequestTopics = (
  topics: ChatTopic[],
  pullRequestsByTopic: Record<string, TopicPullRequestItem[]>,
  deviceMerges: Map<string, DeviceGitPullRequestDetail> = new Map(),
): ChatTopic[] =>
  topics.filter((topic) => {
    const items = pullRequestsByTopic[topic.id];
    if (!items?.length) return false;
    return hasLandedPullRequests(
      items.map((item) => {
        const detail = deviceMerges.get(pullRequestIdentityKey(item.repoFullName, item.number));
        return resolvePullRequestView(item, detail ? { confirmed: false, detail } : undefined);
      }),
    );
  });
