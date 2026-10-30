import { createContext, use } from 'react';

import type { TopicListFilter } from '@/utils/client/topic';

export interface TopicListScopeAgent {
  avatar?: string | null;
  name?: string | null;
  title?: string | null;
}

/** Host identity keeps the shared list inside its Project route and data scope. */
export const TopicListScopeContext = createContext<{
  /** The main agent's display meta, for its group before it has any topic. */
  coordinatorAgent?: TopicListScopeAgent;
  coordinatorAgentId?: string;
  projectId: string;
} | null>(null);
export const useTopicListScope = () => use(TopicListScopeContext);

/**
 * Rows the Project sidebar reveals beyond `topicPageSize`. Owned by the host
 * so the list and its siblings (the collapse-all toggle) slice the same rows.
 * It must stay local: growing the global `topicPageSize` instead pushed it past
 * the server's `getTopics` page-size cap of 100 and broke every topic list.
 */
export interface TopicListRevealState {
  extraRows: number;
  revealMore: () => void;
}

export const TopicListRevealContext = createContext<TopicListRevealState | null>(null);
export const useTopicListReveal = () => use(TopicListRevealContext);

/**
 * Status / device narrowing of the Project sidebar. Owned by the host so the
 * filter menu and the list below it read one value; it resets with the host.
 */
export interface TopicListFilterState {
  filter: TopicListFilter;
  setFilter: (filter: TopicListFilter) => void;
}

export const TopicListFilterContext = createContext<TopicListFilterState | null>(null);
export const useTopicListFilter = () => use(TopicListFilterContext);
