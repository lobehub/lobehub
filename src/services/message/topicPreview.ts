import debug from 'debug';

import { lambdaClient } from '@/libs/trpc/client';

const log = debug('lobe-client:topic-preview');

export const TOPIC_PREVIEW_TTL_MS = 60_000;
export const TOPIC_PREVIEW_MAX_ENTRIES = 50;

type TopicPreviewItem = Awaited<
  ReturnType<typeof lambdaClient.message.getTopicPreviews.query>
>[number];

export type TopicPreview = Extract<TopicPreviewItem, { status: 'ok' }>;

interface CacheEntry {
  fetchedAt: number;
  preview: TopicPreview;
}

const previews = new Map<string, CacheEntry>();
// Skipped and failed answers are not cached as previews, but asking again within
// the TTL would only repeat the same server read.
const attempts = new Map<string, number>();
let generation = 0;
const invalidatedAt = new Map<string, number>();

const isFresh = (entry: CacheEntry) => Date.now() - entry.fetchedAt <= TOPIC_PREVIEW_TTL_MS;

const recordAttempt = (topicId: string) => {
  attempts.delete(topicId);
  attempts.set(topicId, Date.now());
  while (attempts.size > TOPIC_PREVIEW_MAX_ENTRIES) {
    const oldest = attempts.keys().next().value;
    if (oldest === undefined) break;
    attempts.delete(oldest);
  }
};

const store = (preview: TopicPreview) => {
  previews.delete(preview.topicId);
  previews.set(preview.topicId, { fetchedAt: Date.now(), preview });
  while (previews.size > TOPIC_PREVIEW_MAX_ENTRIES) {
    const oldest = previews.keys().next().value;
    if (oldest === undefined) break;
    previews.delete(oldest);
  }
};

export const fetchTopicPreviews = async (params: {
  agentId?: string | null;
  groupId?: string | null;
  topicIds: string[];
}): Promise<TopicPreviewItem[]> => {
  const requestedAt = ++generation;
  try {
    const items = await lambdaClient.message.getTopicPreviews.query({
      agentId: params.agentId,
      groupId: params.groupId,
      topicIds: params.topicIds,
    });
    for (const item of items) {
      recordAttempt(item.topicId);
      if (item.status !== 'ok') continue;
      // A local change landed while the request was out: the answer may predate it.
      if ((invalidatedAt.get(item.topicId) ?? 0) > requestedAt) continue;
      store(item);
    }
    return items;
  } catch (error) {
    log('Failed to fetch topic previews: %O', error);
    for (const topicId of params.topicIds) recordAttempt(topicId);
    return [];
  }
};

export const hasTopicPreview = (topicId: string): boolean => {
  const entry = previews.get(topicId);
  if (!entry) return false;
  if (isFresh(entry)) return true;
  previews.delete(topicId);
  return false;
};

export const hasRecentTopicPreviewAttempt = (topicId: string): boolean => {
  const attemptedAt = attempts.get(topicId);
  if (attemptedAt === undefined) return false;
  if (Date.now() - attemptedAt <= TOPIC_PREVIEW_TTL_MS) return true;
  attempts.delete(topicId);
  return false;
};

const toTime = (value: Date | string | number) => new Date(value).getTime();

export const getValidTopicPreview = (
  topicId: string,
  topic: { running?: boolean; topicUpdatedAt?: Date | string | number | null },
): TopicPreview | undefined => {
  const entry = previews.get(topicId);
  if (!entry) return undefined;

  const valid =
    isFresh(entry) &&
    !topic.running &&
    topic.topicUpdatedAt != null &&
    toTime(topic.topicUpdatedAt) === toTime(entry.preview.topicUpdatedAt);
  if (valid) return entry.preview;

  previews.delete(topicId);
  return undefined;
};

export const invalidateTopicPreview = (topicId: string): void => {
  invalidatedAt.set(topicId, ++generation);
  previews.delete(topicId);
  attempts.delete(topicId);
};

export const resetTopicPreviews = (): void => {
  previews.clear();
  attempts.clear();
  invalidatedAt.clear();
};
