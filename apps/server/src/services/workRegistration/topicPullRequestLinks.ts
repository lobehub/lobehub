import type { TopicPullRequestLinkMeta, TopicPullRequestsMeta } from '@lobechat/types';
import isEqual from 'fast-deep-equal';

import type { TopicModel } from '@/database/models/topic';

/** Bounds what one topic can carry; the oldest links fall off first. */
const MAX_TOPIC_LINKS = 50;
const MAX_DISMISSED = 100;
/** Concurrent writers each retry against the row they lost to. */
const MAX_WRITE_ATTEMPTS = 3;

/** A github.com PR page, also one of its tabs (`/files`) or with a query / anchor. */
const PULL_URL_RE = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)(?:[/?#]\S*)?$/i;

/** `owner/repo#number` and the canonical URL of a github.com pull request URL. */
export const parsePullRequestUrl = (
  url: string,
): { identifier: string; number: number; repoFullName: string; url: string } | null => {
  const match = PULL_URL_RE.exec(url.trim());
  if (!match) return null;
  const repoFullName = `${match[1]}/${match[2]}`;
  const number = Number(match[3]);
  return {
    identifier: `${repoFullName}#${number}`,
    number,
    repoFullName,
    url: `https://github.com/${repoFullName}/pull/${number}`,
  };
};

const sameIdentifier = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Empty lists are dropped so "nothing" has one shape. */
const tidy = (meta: TopicPullRequestsMeta): TopicPullRequestsMeta => ({
  ...(meta.dismissed?.length ? { dismissed: meta.dismissed } : {}),
  ...(meta.links?.length ? { links: meta.links } : {}),
});

/**
 * Rewrite a topic's `metadata.pullRequests` atomically: `update` sees the
 * value the write will replace, and the write only lands if nobody changed it
 * since (else it retries on the newer value). False when the topic is not
 * the caller's, or the writers kept colliding.
 */
const updateTopicPullRequests = async (
  topicModel: TopicModel,
  topicId: string,
  update: (current: TopicPullRequestsMeta) => TopicPullRequestsMeta,
): Promise<boolean> => {
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
    const topic = await topicModel.findById(topicId);
    if (!topic) return false;
    const current = topic.metadata?.pullRequests;
    const next = tidy(update(tidy(current ?? {})));
    if (isEqual(tidy(current ?? {}), next)) return true;

    const rows = await topicModel.updateMetadata(
      topicId,
      { pullRequests: next },
      { onlyIf: (metadata) => isEqual(metadata?.pullRequests, current) },
    );
    if (rows.length > 0) return true;
  }
  return false;
};

/**
 * Keep a PR on the topic itself: one found on the topic's own branch, or one
 * the person linked by URL. Linking a PR also brings it back if it had been
 * removed. A by-hand link outranks a branch match of the same PR.
 */
export const linkTopicPullRequest = (
  topicModel: TopicModel,
  topicId: string,
  link: Omit<TopicPullRequestLinkMeta, 'linkedAt'>,
): Promise<boolean> =>
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

/** Hide a linked PR from the topic's lists (or show it again). The Work rows stay. */
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
  });
