import { PAGE_DOCUMENT_FILE_TYPES, PAGE_DOCUMENT_SOURCE_TYPES } from '@lobechat/const';
import type { DocumentItem } from '@lobechat/database/schemas';

import { definePagedReplica, defineReplica, type ReplicaPagedData } from '@/libs/replica';
import { documentService } from '@/services/document';
import { DocumentSourceType, type LobeDocument } from '@/types/document';

/**
 * The Pages sidebar renders one global list, so its paged replica keeps a single
 * entry and every selector reads `pageListMap[PAGE_LIST_KEY]`. A page opened
 * outside the loaded list (deep link, mobile, task modal) lives in
 * `pageDetailMap[id]` — both locations are read through `pageSelectors`.
 */
export const PAGE_LIST_KEY = 'all';

/** Client-minted id prefix of a page whose server row does not exist yet. */
export const TEMP_PAGE_ID_PREFIX = 'temp-page-';

/** Whether `id` is an optimistic page row that has no server row yet. */
export const isTempPageId = (id: string): boolean => id.startsWith(TEMP_PAGE_ID_PREFIX);

/**
 * The Pages list is one query. The page size is its only identity beyond the
 * entry key, so changing it resets the loaded depth instead of merging pages
 * fetched under another size.
 */
export interface PageListParams {
  pageSize: number;
}

/** `pageListMap[PAGE_LIST_KEY]` — the paged view every page selector reads. */
export type PageListValue = ReplicaPagedData<LobeDocument, number>;

// EDITOR is a client-only stamp on in-memory drafts; DB rows never carry it.
const ALLOWED_PAGE_SOURCE_TYPES: Set<string> = new Set([
  DocumentSourceType.EDITOR,
  ...PAGE_DOCUMENT_SOURCE_TYPES,
]);
const ALLOWED_PAGE_FILE_TYPES: Set<string> = new Set(PAGE_DOCUMENT_FILE_TYPES);

/**
 * Whether a document row belongs in the Pages list. Mirrors the guard the old
 * `getPageDocuments()` / `loadMoreDocuments()` pair applied before the rows
 * reached the store.
 */
export const isAllowedPageDocument = (doc: { fileType: string; sourceType: string }): boolean =>
  ALLOWED_PAGE_SOURCE_TYPES.has(doc.sourceType) && ALLOWED_PAGE_FILE_TYPES.has(doc.fileType);

/**
 * DB row → the `LobeDocument` selectors and the editor read.
 *
 * The server's own `sourceType` is kept (created pages come back as `api`,
 * uploaded PDFs as `file` — the sidebar's bucket selectors still drop the
 * latter), and `parentId` / `visibility` / `workspaceId` are carried through
 * because the rename and bucket flows read them back.
 */
export const documentItemToLobeDocument = (document: DocumentItem): LobeDocument => ({
  content: document.content || null,
  createdAt: document.createdAt ? new Date(document.createdAt) : new Date(),
  editorData:
    typeof document.editorData === 'string'
      ? JSON.parse(document.editorData)
      : document.editorData || null,
  fileType: document.fileType,
  filename: document.title || document.filename || 'Untitled',
  id: document.id,
  metadata: document.metadata || {},
  parentId: document.parentId ?? null,
  source: 'document',
  sourceType: document.sourceType as DocumentSourceType,
  title: document.title || '',
  totalCharCount: document.totalCharCount ?? document.content?.length ?? 0,
  totalLineCount: document.totalLineCount ?? 0,
  updatedAt: document.updatedAt ? new Date(document.updatedAt) : new Date(),
  userId: document.userId,
  visibility: document.visibility ?? null,
  workspaceId: document.workspaceId ?? null,
});

/**
 * Offset paging over `document.queryDocuments` (`current` is the page index,
 * the server orders by `updatedAt` desc and reports the real `total`). The
 * sidebar pages forward — "load more" appends older rows below the head page —
 * and only the head page survives a reload.
 */
const pagePaging = {
  direction: 'forward',
  getId: (doc: LobeDocument) => doc.id,
  mode: 'offset',
  persist: { pages: 1 },
} as const;

/**
 * The one page list of the active scope. Rows are converted at the boundary so
 * the whole store (selectors, optimistic writes, the editor) speaks
 * `LobeDocument`.
 */
export const pageListResource = definePagedReplica<
  PageListParams,
  LobeDocument,
  number,
  PageListValue
>({
  fetchPage: async (params, cursor) => {
    const result = await documentService.queryDocuments({
      current: cursor ?? 0,
      fileTypes: PAGE_DOCUMENT_FILE_TYPES,
      pageSize: params.pageSize,
      sourceTypes: PAGE_DOCUMENT_SOURCE_TYPES,
    });

    return {
      items: result.items.filter(isAllowedPageDocument).map(documentItemToLobeDocument),
      total: result.total,
    };
  },
  key: () => PAGE_LIST_KEY,
  name: 'pageList',
  paging: pagePaging,
  query: ({ pageSize }) => ({ pageSize }),
  storage: 'indexedDB',
  version: 1,
});

/**
 * One page by id, for pages that are not in the loaded list (mobile mounts no
 * sidebar, a workspace modal deeplinks a page). `pageSelectors.getDocumentById`
 * reads it as a fallback behind the list. The fetcher (owned by the store
 * slice) answers with `undefined` for a page the server no longer has, and the
 * merge then keeps whatever is cached.
 */
export const pageDetailResource = defineReplica<string, LobeDocument, LobeDocument | undefined>({
  key: (pageId) => pageId,
  name: 'pageDetail',
  storage: 'indexedDB',
  version: 1,
});
