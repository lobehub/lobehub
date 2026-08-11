import type { TopicQuerySortBy } from '../../topic';
import type { ProjectionRef, ProjectionSource } from '../base';

export interface ChatTopicsQuerySignature {
  excludeStatuses?: string[];
  excludeTriggers?: string[];
  isInbox?: boolean;
  sortBy?: TopicQuerySortBy;
  withDetails?: boolean;
}

export type ChatSidebarTopicsIndexKey = `chat.sidebarTopics:${string}`;
export type ChatAgentViewTopicsIndexKey = `chat.agentViewTopics:${string}`;

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
  `chat.sidebarTopics:${containerKey}`;

export const chatAgentViewTopicsIndexKey = (containerKey: string): ChatAgentViewTopicsIndexKey =>
  `chat.agentViewTopics:${containerKey}`;
