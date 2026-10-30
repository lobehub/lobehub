import {
  CUSTOM_DOCUMENT_FILE_TYPE,
  HTML_DOCUMENT_FILE_TYPE,
  PAGE_DOCUMENT_FILE_TYPES,
  PAGE_DOCUMENT_SOURCE_TYPES,
} from '@lobechat/const';
import type { DocumentItem } from '@lobechat/database/schemas';

import { definePagedReplica, defineReplica, type ReplicaPagedData } from '@/libs/replica';
import { documentService } from '@/services/document';
import type { DocsPageSectionKey, DocsPageSectionView } from '@/store/global/initialState';
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

/**
 * The Docs sidebar's page sections: `mine` lists the caller's own pages outside
 * every library, `shared` the workspace pages other members created and shared
 * (private ones never reach another member). Both narrow inside the query, so a
 * section shows a full head page instead of whatever survives a client filter.
 */
export type PageSectionScope = DocsPageSectionKey;

/** What a section lists and in which order; the section's view settings decide it. */
export interface PageSectionFilter {
  sortBy: DocsPageSectionView['sortBy'];
  type: DocsPageSectionView['type'];
}

export interface PageSectionParams extends PageSectionFilter {
  /** Rows shown; one more is fetched so the section knows whether to offer "View all". */
  limit: number;
  scope: PageSectionScope;
}

/**
 * Source types the page sections list. Only authored pages: `api` covers both
 * plain pages and pages written into a library (those carry a mirror `fileId`,
 * so `fileId` cannot tell them apart from uploads). Parsed uploads are `file`
 * rows with `custom/document` and must stay in the Drive, not here.
 */
const PAGE_SECTION_SOURCE_TYPES: string[] = [DocumentSourceType.API];

const SECTION_FILE_TYPES: Record<PageSectionFilter['type'], string[]> = {
  all: PAGE_DOCUMENT_FILE_TYPES,
  artifact: [HTML_DOCUMENT_FILE_TYPE],
  page: [CUSTOM_DOCUMENT_FILE_TYPE],
};

/** One offset page of a section's rows, narrowed by scope and type on the server. */
const fetchSectionPage = async (
  { scope, sortBy, type }: PageSectionFilter & { scope: PageSectionScope },
  current: number,
  pageSize: number,
): Promise<{ items: LobeDocument[]; total: number }> => {
  const result = await documentService.queryDocuments({
    creator: scope === 'mine' ? 'self' : 'others',
    current,
    fileTypes: SECTION_FILE_TYPES[type],
    pageSize,
    sortBy,
    sourceTypes: PAGE_SECTION_SOURCE_TYPES,
    standaloneOnly: true,
  });

  return {
    items: result.items
      .filter((doc) => PAGE_SECTION_SOURCE_TYPES.includes(doc.sourceType))
      .filter(isAllowedPageDocument)
      .map(documentItemToLobeDocument),
    total: result.total,
  };
};

export const pageSectionResource = defineReplica<PageSectionParams, LobeDocument[]>({
  fetcher: async ({ limit, ...params }) => (await fetchSectionPage(params, 0, limit + 1)).items,
  key: ({ scope }) => scope,
  name: 'pageSection',
  // The cached head only paints for the list options it was fetched under.
  query: ({ limit, sortBy, type }) => ({ limit, sortBy, type }),
  storage: 'localStorage',
  // v3 keys the cache by the section's list options.
  version: 3,
});

/** Rows per page of a section's full list. */
export const PAGE_SECTION_LIST_PAGE_SIZE = 30;

export interface PageSectionListParams extends PageSectionFilter {
  scope: PageSectionScope;
}

export type PageSectionListValue = ReplicaPagedData<LobeDocument, number>;

/**
 * Every page of one section, paged forward for the full-list panel. The
 * sidebar section only carries its capped head; this is how an older page is
 * still reachable.
 */
export const pageSectionListResource = definePagedReplica<
  PageSectionListParams,
  LobeDocument,
  number,
  PageSectionListValue
>({
  fetchPage: (params, cursor) => fetchSectionPage(params, cursor ?? 0, PAGE_SECTION_LIST_PAGE_SIZE),
  key: ({ scope }) => scope,
  name: 'pageSectionList',
  paging: pagePaging,
  query: ({ sortBy, type }) => ({ sortBy, type }),
  storage: 'indexedDB',
  version: 1,
});
