import type { TopicQuerySortBy } from '../../topic';
import type { ProjectionRef, ProjectionSource } from '../base';
import type { ProjectionKeyOf } from '../runtime';
import { defineProjectionKeySpace } from '../runtime';

export const CHAT_AGENT_VIEW_TOPICS_INDEX_PREFIX = 'chat.agentViewTopics:';
export const CHAT_SIDEBAR_TOPICS_INDEX_PREFIX = 'chat.sidebarTopics:';

export const chatIndexKeySpace = defineProjectionKeySpace({
  patterns: [
    { prefix: CHAT_AGENT_VIEW_TOPICS_INDEX_PREFIX },
    { prefix: CHAT_SIDEBAR_TOPICS_INDEX_PREFIX },
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

interface ChatTopicsIndexBase<K extends string> {
  key: K;
  observedAt: number;
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

export type ChatIndexMap = { [K in ChatAgentViewTopicsIndexKey]: ChatAgentViewTopicsIndex } & {
  [K in ChatSidebarTopicsIndexKey]: ChatSidebarTopicsIndex;
};

export const chatSidebarTopicsIndexKey = (containerKey: string): ChatSidebarTopicsIndexKey =>
  `${CHAT_SIDEBAR_TOPICS_INDEX_PREFIX}${containerKey}`;

export const chatAgentViewTopicsIndexKey = (containerKey: string): ChatAgentViewTopicsIndexKey =>
  `${CHAT_AGENT_VIEW_TOPICS_INDEX_PREFIX}${containerKey}`;
