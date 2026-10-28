import type {
  MessageKeywordSearchItem,
  MessageKeywordSearchParams,
  MessageKeywordSearchResult,
} from '@/database/models/message';
import type {
  FtsSearchGoalResult,
  FtsSearchResult,
  FtsSearchTimeRange,
} from '@/database/repositories/ftsSearch';
import type { GoalSearchOptions } from '@/database/repositories/goalSearch';

export const RECALL_TYPES = ['message', 'topic', 'goal', 'page'] as const;
export type RecallType = (typeof RECALL_TYPES)[number];

export const RECALL_MAX_LIMIT_PER_TYPE = 50;

/**
 * Messages are fetched in one wider page so the topic roll-up reflects more
 * history than the message list shows; it stays within the model's page cap.
 */
const MESSAGE_POOL_SIZE = 100;

export interface RecallInput {
  endDate?: Date;
  exact?: boolean;
  includeAutomatedPrompts?: boolean;
  limitPerType?: number;
  query: string;
  startDate?: Date;
  types?: RecallType[];
}

export interface RecallTopic {
  /** Matching messages in the window, counted within the fetched message pool. */
  hitCount: number;
  id: string;
  lastMatchedAt: Date | null;
  matchedBy: ('messages' | 'title')[];
  title: string | null;
  updatedAt: Date | null;
}

export interface RecallPage {
  description: string | null;
  id: string;
  title: string;
  updatedAt: Date;
}

export interface RecallResult {
  goals: FtsSearchGoalResult[];
  messages: { hasMore: boolean; items: MessageKeywordSearchItem[]; truncated: boolean };
  pages: RecallPage[];
  topics: RecallTopic[];
}

export interface RecallDependencies {
  /** Must apply `timeRange` during retrieval, not after a ranked cut. */
  searchEntities: (options: {
    limitPerType: number;
    query: string;
    timeRange?: FtsSearchTimeRange;
    type: 'page' | 'topic';
  }) => Promise<FtsSearchResult[]>;
  searchGoals: (options: GoalSearchOptions) => Promise<FtsSearchGoalResult[]>;
  searchMessages: (params: MessageKeywordSearchParams) => Promise<MessageKeywordSearchResult>;
}

/**
 * "What did I do about X in this period": one query across messages, topics,
 * goals and pages, each scoped to the caller and to the time window. Topics
 * merge title matches with the conversations whose messages matched, so a
 * topic named differently from the query still surfaces.
 */
export class RecallService {
  constructor(private readonly deps: RecallDependencies) {}

  recall = async ({
    endDate,
    exact,
    includeAutomatedPrompts,
    limitPerType = 10,
    query,
    startDate,
    types,
  }: RecallInput): Promise<RecallResult> => {
    const empty: RecallResult = {
      goals: [],
      messages: { hasMore: false, items: [], truncated: false },
      pages: [],
      topics: [],
    };
    const text = query.trim();
    if (!text) return empty;

    const limit = Math.min(Math.max(limitPerType, 1), RECALL_MAX_LIMIT_PER_TYPE);
    const wanted = new Set<RecallType>(types?.length ? types : RECALL_TYPES);
    const wantsMessagePool = wanted.has('message') || wanted.has('topic');
    // Topic titles and pages count as active in the window when last updated in it.
    const timeRange: FtsSearchTimeRange | undefined =
      startDate || endDate ? { end: endDate, field: 'updatedAt', start: startDate } : undefined;

    const [messagePool, topicHits, goals, pageHits] = await Promise.all([
      wantsMessagePool
        ? this.deps.searchMessages({
            endDate,
            exact,
            includeAutomatedPrompts,
            keyword: text,
            limit: Math.max(MESSAGE_POOL_SIZE, limit),
            startDate,
          })
        : undefined,
      wanted.has('topic')
        ? this.deps.searchEntities({ limitPerType: limit, query: text, timeRange, type: 'topic' })
        : [],
      wanted.has('goal') ? this.deps.searchGoals({ endDate, limit, query: text, startDate }) : [],
      wanted.has('page')
        ? this.deps.searchEntities({ limitPerType: limit, query: text, timeRange, type: 'page' })
        : [],
    ]);

    const poolItems = messagePool?.items ?? [];

    return {
      goals,
      messages: wanted.has('message')
        ? {
            hasMore: poolItems.length > limit || Boolean(messagePool?.hasMore),
            items: poolItems.slice(0, limit),
            truncated: Boolean(messagePool?.truncated),
          }
        : empty.messages,
      pages: pageHits
        .filter((hit) => hit.type === 'page')
        .slice(0, limit)
        .map(({ description, id, title, updatedAt }) => ({
          description: description ?? null,
          id,
          title,
          updatedAt,
        })),
      topics: wanted.has('topic') ? mergeTopics(poolItems, topicHits, limit) : [],
    };
  };
}

const mergeTopics = (
  messages: MessageKeywordSearchItem[],
  topicHits: FtsSearchResult[],
  limit: number,
): RecallTopic[] => {
  const topics = new Map<string, RecallTopic>();

  for (const message of messages) {
    if (!message.topicId) continue;
    const topic = topics.get(message.topicId);
    if (topic) {
      topic.hitCount += 1;
      continue;
    }
    // Messages arrive newest first, so the first one seen is the latest match.
    topics.set(message.topicId, {
      hitCount: 1,
      id: message.topicId,
      lastMatchedAt: message.createdAt,
      matchedBy: ['messages'],
      title: message.topicTitle,
      updatedAt: null,
    });
  }

  for (const hit of topicHits) {
    if (hit.type !== 'topic') continue;
    const topic = topics.get(hit.id);
    if (topic) {
      topic.matchedBy.unshift('title');
      topic.updatedAt = hit.updatedAt;
      continue;
    }
    topics.set(hit.id, {
      hitCount: 0,
      id: hit.id,
      lastMatchedAt: null,
      matchedBy: ['title'],
      title: hit.title,
      updatedAt: hit.updatedAt,
    });
  }

  const latest = (topic: RecallTopic) =>
    Math.max(topic.lastMatchedAt?.getTime() ?? 0, topic.updatedAt?.getTime() ?? 0);

  return [...topics.values()]
    .sort((a, b) => b.hitCount - a.hitCount || latest(b) - latest(a))
    .slice(0, limit);
};
