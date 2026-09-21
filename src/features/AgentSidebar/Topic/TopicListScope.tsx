import { createContext, use } from 'react';

/** Host identity keeps the shared list inside its Project route and data scope. */
export const TopicListScopeContext = createContext<{ projectId: string } | null>(null);
export const useTopicListScope = () => use(TopicListScopeContext);
