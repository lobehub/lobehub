import { type KnowledgeBaseStoreState } from '@/store/library/initialState';

import {
  AGENT_SPACE_LIST_KEY,
  knowledgeBaseListKey,
  type KnowledgeBaseVisibility,
} from './projection';

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

/** Agents' dedicated libraries; `undefined` until first read. */
const agentSpaceList = (s: KnowledgeBaseStoreState) => s.agentSpaceListMap[AGENT_SPACE_LIST_KEY];

export const knowledgeBaseSelectors = {
  activeKnowledgeBaseId,
  agentSpaceList,
  getKnowledgeBaseById,
  getKnowledgeBaseList,
  getKnowledgeBaseNameById,
  isKnowledgeBaseListInit,
};
