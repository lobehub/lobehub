import { createContext, use } from 'react';

/** Host identity keeps the shared list inside its Project route and data scope. */
export const TopicListScopeContext = createContext<{
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
