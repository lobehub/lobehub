import type { TopicPullRequestLinkMeta, TopicPullRequestsMeta } from '@lobechat/types';
import isEqual from 'fast-deep-equal';

import type { TopicModel } from '@/database/models/topic';

/** Bounds what one topic can carry; the oldest links fall off first. */
const MAX_TOPIC_LINKS = 50;
const MAX_DISMISSED = 100;
/** Concurrent writers each retry against the row they lost to. */
const MAX_WRITE_ATTEMPTS = 3;

export { parsePullRequestUrl } from '@lobechat/utils/githubPullRequest';

const sameIdentifier = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Empty lists are dropped so "nothing" has one shape. */
const tidy = (meta: TopicPullRequestsMeta): TopicPullRequestsMeta => ({
  ...(meta.dismissed?.length ? { dismissed: meta.dismissed } : {}),
  ...(meta.links?.length ? { links: meta.links } : {}),
});

/**
 * Rewrite a topic's `metadata.pullRequests` atomically: `update` sees the
 * value the write will replace, and the write only lands if nobody changed it
 * since (else it retries on the newer value). Resolves to the value now
 * stored; `null` when the topic is not the caller's, or the writers kept
 * colliding.
 */
const updateTopicPullRequests = async (
  topicModel: TopicModel,
  topicId: string,
  update: (current: TopicPullRequestsMeta) => TopicPullRequestsMeta,
): Promise<TopicPullRequestsMeta | null> => {
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
    const topic = await topicModel.findById(topicId);
    if (!topic) return null;
    const current = topic.metadata?.pullRequests;
    const next = tidy(update(tidy(current ?? {})));
    if (isEqual(tidy(current ?? {}), next)) return next;

    const rows = await topicModel.updateMetadata(
      topicId,
      { pullRequests: next },
      { onlyIf: (metadata) => isEqual(metadata?.pullRequests, current) },
    );
    if (rows.length > 0) return next;
  }
  return null;
};

/** Whether the topic keeps `identifier` as a link of its own and shows it. */
export const isTopicPullRequestListed = (
  meta: TopicPullRequestsMeta | null | undefined,
  identifier: string,
): boolean =>
  !!meta?.links?.some((item) => sameIdentifier(item.identifier, identifier)) &&
  !meta.dismissed?.some((id) => sameIdentifier(id, identifier));

/**
 * Keep a PR on the topic itself: one found on the topic's own branch, or one
 * the person linked by URL. Linking a PR also brings it back if it had been
 * removed. A by-hand link outranks a branch match of the same PR. Resolves to
 * the topic's PR links after the write (see {@link isTopicPullRequestListed}
 * for whether this PR is now on its list); `null` when nothing was saved.
 */
export const linkTopicPullRequest = (
  topicModel: TopicModel,
  topicId: string,
  link: Omit<TopicPullRequestLinkMeta, 'linkedAt'>,
): Promise<TopicPullRequestsMeta | null> =>
  updateTopicPullRequests(topicModel, topicId, (current) => {
    const links = current.links ?? [];
    const existing = links.find((item) => sameIdentifier(item.identifier, link.identifier));
    // A branch match never downgrades a by-hand link, nor re-links one removed by hand.
    if (link.source === 'branch') {
      if (existing?.source === 'manual') return current;
      if (current.dismissed?.some((id) => sameIdentifier(id, link.identifier))) return current;
    }
    const next: TopicPullRequestLinkMeta = {
      ...link,
      linkedAt: existing?.linkedAt ?? new Date().toISOString(),
    };
    return {
      ...current,
      dismissed: current.dismissed?.filter((id) => !sameIdentifier(id, link.identifier)),
      links: [...links.filter((item) => item !== existing), next].slice(-MAX_TOPIC_LINKS),
    };
  });

/**
 * Hide a linked PR from the topic's lists (or show it again). The Work rows
 * stay; the conversation a link of this topic made Auto-fix wake is released
 * by the caller (see `releaseTopicPullRequestWake`).
 */
export const setTopicPullRequestDismissed = (
  topicModel: TopicModel,
  topicId: string,
  identifier: string,
  dismissed: boolean,
): Promise<boolean> =>
  updateTopicPullRequests(topicModel, topicId, (current) => {
    const rest = (current.dismissed ?? []).filter((id) => !sameIdentifier(id, identifier));
    return {
      ...current,
      dismissed: dismissed ? [...rest, identifier].slice(-MAX_DISMISSED) : rest,
    };
  }).then((meta) => meta !== null);
