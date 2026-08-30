import type { TopicQuerySortBy } from '../../topic';
import type { ProjectionRef, ProjectionSource } from '../base';
import type { ProjectionKeyOf } from '../runtime';
import { defineProjectionKeySpace } from '../runtime';

export const CHAT_AGENT_VIEW_TOPICS_INDEX_PREFIX = 'chat.agentViewTopics:';
export const CHAT_SIDEBAR_TOPICS_INDEX_PREFIX = 'chat.sidebarTopics:';
export const CHAT_TOPIC_SEARCH_INDEX_PREFIX = 'chat.topicSearch:';

export const chatIndexKeySpace = defineProjectionKeySpace({
  patterns: [
    { prefix: CHAT_AGENT_VIEW_TOPICS_INDEX_PREFIX },
    { prefix: CHAT_SIDEBAR_TOPICS_INDEX_PREFIX },
    { prefix: CHAT_TOPIC_SEARCH_INDEX_PREFIX },
  ],
  staticKeys: [],
});

export interface ChatTopicsQuerySignature {
  excludeStatuses?: string[];
  excludeTriggers?: string[];
  isInbox?: boolean;
  sortBy?: TopicQuerySortBy;
  withDetails?: boolean;
}

type ChatIndexKey = ProjectionKeyOf<typeof chatIndexKeySpace>;
export type ChatSidebarTopicsIndexKey = Extract<
  ChatIndexKey,
  `${typeof CHAT_SIDEBAR_TOPICS_INDEX_PREFIX}${string}`
>;
export type ChatAgentViewTopicsIndexKey = Extract<
  ChatIndexKey,
  `${typeof CHAT_AGENT_VIEW_TOPICS_INDEX_PREFIX}${string}`
>;
export type ChatTopicSearchIndexKey = Extract<
  ChatIndexKey,
  `${typeof CHAT_TOPIC_SEARCH_INDEX_PREFIX}${string}`
>;

interface ChatTopicsIndexBase<K extends string> {
  key: K;
  observedAt: number;
  /** Highest server page folded into the in-memory index. Hydrated indexes default to page 0. */
  page?: number;
  /** Durable writes keep only the first request page; memory retains the full coverage. */
  persistRefLimit: number;
  refs: ProjectionRef<'topic'>[];
  signature: ChatTopicsQuerySignature;
  source: ProjectionSource;
  total: number;
}

export interface ChatSidebarTopicsIndex extends ChatTopicsIndexBase<ChatSidebarTopicsIndexKey> {}
export interface ChatAgentViewTopicsIndex extends ChatTopicsIndexBase<ChatAgentViewTopicsIndexKey> {}

export type ChatTopicsIndex = ChatAgentViewTopicsIndex | ChatSidebarTopicsIndex;

export interface ChatTopicSearchSignature {
  agentId?: string;
  groupId?: string;
  keywords: string;
}

export interface ChatTopicSearchIndex {
  key: ChatTopicSearchIndexKey;
  observedAt: number;
  persistRefLimit: number;
  refs: ProjectionRef<'topic'>[];
  signature: ChatTopicSearchSignature;
  source: ProjectionSource;
  total: number;
}

export type ChatProjectionIndex = ChatTopicSearchIndex | ChatTopicsIndex;

export type ChatIndexMap = { [K in ChatAgentViewTopicsIndexKey]: ChatAgentViewTopicsIndex } & {
  [K in ChatSidebarTopicsIndexKey]: ChatSidebarTopicsIndex;
} & {
  [K in ChatTopicSearchIndexKey]: ChatTopicSearchIndex;
};

export const chatSidebarTopicsIndexKey = (containerKey: string): ChatSidebarTopicsIndexKey =>
  `${CHAT_SIDEBAR_TOPICS_INDEX_PREFIX}${containerKey}`;

export const chatAgentViewTopicsIndexKey = (containerKey: string): ChatAgentViewTopicsIndexKey =>
  `${CHAT_AGENT_VIEW_TOPICS_INDEX_PREFIX}${containerKey}`;

export const chatTopicSearchIndexKey = ({
  agentId,
  groupId,
  keywords,
}: ChatTopicSearchSignature): ChatTopicSearchIndexKey =>
  `${CHAT_TOPIC_SEARCH_INDEX_PREFIX}${encodeURIComponent(
    JSON.stringify([keywords.trim(), agentId ?? null, groupId ?? null]),
  )}`;
