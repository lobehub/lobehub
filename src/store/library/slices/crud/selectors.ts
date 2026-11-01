import { type KnowledgeBaseStoreState } from '@/store/library/initialState';

import { knowledgeBaseListKey, type KnowledgeBaseVisibility } from './projection';

const activeKnowledgeBaseId = (s: KnowledgeBaseStoreState) => s.activeKnowledgeBaseId;

/** One KB by id — backed by the `knowledgeBaseItem` replica. */
const getKnowledgeBaseById = (id: string) => (s: KnowledgeBaseStoreState) =>
  s.knowledgeBaseDetailMap[id];

const getKnowledgeBaseNameById = (id: string) => (s: KnowledgeBaseStoreState) =>
  getKnowledgeBaseById(id)(s)?.name;

/** One KB list surface (`all` / `private` / `public`) — backed by the `knowledgeBaseList` replica. */
const getKnowledgeBaseList =
  (visibility?: KnowledgeBaseVisibility) => (s: KnowledgeBaseStoreState) =>
    s.knowledgeBaseListMap[knowledgeBaseListKey(visibility)];

/** Whether a list surface has been read (hydrated or fetched) at least once. */
const isKnowledgeBaseListInit =
  (visibility?: KnowledgeBaseVisibility) => (s: KnowledgeBaseStoreState) =>
    s.knowledgeBaseListMap[knowledgeBaseListKey(visibility)] !== undefined;

export const knowledgeBaseSelectors = {
  activeKnowledgeBaseId,
  getKnowledgeBaseById,
  getKnowledgeBaseList,
  getKnowledgeBaseNameById,
  isKnowledgeBaseListInit,
};
