import { defineReplica } from '@/libs/replica';
import { knowledgeBaseService } from '@/services/knowledgeBase';
import type { KnowledgeBaseItem } from '@/types/knowledgeBase';

/**
 * Workspace-scoped visibility of a KB. `private` rows are visible to their
 * creator only, `public` rows to the whole workspace.
 */
export type KnowledgeBaseVisibility = 'private' | 'public';

/**
 * Entry key of the unfiltered KB list. The sidebar renders exactly one of the
 * `private` / `public` surfaces at a time, while the home quick-access and the
 * library switcher read the unfiltered list — each surface is its own entry so
 * switching the sidebar mode never overwrites the other surface's rows.
 */
export const KNOWLEDGE_BASE_LIST_ALL_KEY = 'all';

export interface KnowledgeBaseListParams {
  visibility?: KnowledgeBaseVisibility;
}

/** Entry identity of one list surface (`all` / `private` / `public`). */
export const knowledgeBaseListKey = (visibility?: KnowledgeBaseVisibility) =>
  visibility ?? KNOWLEDGE_BASE_LIST_ALL_KEY;

/**
 * The KB list. The address is `knowledgeBaseListMap[all|private|public]`; every
 * selector reads it from there and the crud slice is the only writer.
 */
export const knowledgeBaseListResource = defineReplica<
  KnowledgeBaseListParams,
  KnowledgeBaseItem[],
  KnowledgeBaseItem[]
>({
  fetcher: ({ visibility }) => knowledgeBaseService.getKnowledgeBaseList(visibility),
  key: ({ visibility }) => knowledgeBaseListKey(visibility),
  name: 'knowledgeBaseList',
  storage: 'indexedDB',
  version: 1,
});

/**
 * One KB by id (`knowledgeBaseDetailMap[id]`), for a KB that is not in the
 * loaded list (deep link, permission page, route layout). The fetcher answers
 * `undefined` for a KB the server no longer has; the crud slice then drops the
 * cached projection, so the route resolves to `<NotFound />`.
 */
export const knowledgeBaseItemResource = defineReplica<
  string,
  KnowledgeBaseItem,
  KnowledgeBaseItem | undefined
>({
  key: (id) => id,
  name: 'knowledgeBaseItem',
  storage: 'indexedDB',
  version: 1,
});
