import type {
  DocumentCommentAnchorList,
  DocumentCommentDetail,
  DocumentCommentItem,
  DocumentCommentSummary,
  DocumentCommentThread,
  DocumentCommentThreadPage,
  DocumentLikeSummary,
} from '@lobechat/types';

import { definePagedReplica, defineReplica, type ReplicaPagedData } from '@/libs/replica';

/** One server page of document-level roots and of replies. */
export const DOCUMENT_COMMENT_PAGE_SIZE = 20;
/**
 * The gutter needs every anchored thread mounted at once (each card sits at
 * its own height), so its pages are fetched at the router's cap and drained
 * in the background rather than behind a "load more" button.
 */
export const DOCUMENT_COMMENT_ANCHORED_PAGE_SIZE = 50;

/**
 * `'anchored'` / `'document'` page one subset of a document's roots (the
 * gutter beside the text / the list below the body); `'all'` pages every root.
 */
export type DocumentCommentThreadScope = 'all' | 'anchored' | 'document';

/**
 * Root-comment feed of one document. The active workspace is part of the
 * replica scope, so it is not repeated in the key.
 */
export interface DocumentCommentThreadsParams {
  documentId: string;
  scope: DocumentCommentThreadScope;
}

export interface DocumentCommentRepliesParams {
  rootCommentId: string;
}

/** Root-comment feed: `threadFeedMap[documentCommentThreadsKey(params)]`. */
export type DocumentCommentThreadFeed = ReplicaPagedData<DocumentCommentThread, string>;

/** Reply feed of one root: `replyFeedMap[rootCommentId]`. */
export type DocumentCommentReplyFeed = ReplicaPagedData<DocumentCommentItem, string>;

export const documentCommentThreadsKey = ({ documentId, scope }: DocumentCommentThreadsParams) =>
  `${documentId}:${scope}`;

export const documentCommentThreadPageSize = (scope: DocumentCommentThreadScope) =>
  scope === 'anchored' ? DOCUMENT_COMMENT_ANCHORED_PAGE_SIZE : DOCUMENT_COMMENT_PAGE_SIZE;

/**
 * Keeps a page to its scope's own subset even when the backend ignored the
 * `anchored` parameter — a production server predating it strips the unknown
 * key and answers both scopes with the same mixed pages (the documented debug
 * proxy runs the latest SPA against exactly that). Without this, the two
 * feeds overlap and the list below the body renders every such thread
 * twice. The cursor still walks the server's own order, so paging stays
 * consistent; a page may just carry fewer items than asked for.
 */
export const partitionThreadPage = (
  page: DocumentCommentThreadPage,
  scope: DocumentCommentThreadScope,
): DocumentCommentThreadPage => {
  if (scope === 'all') return page;
  const wantsAnchored = scope === 'anchored';
  const items = page.items.filter(({ root }) => Boolean(root.selectionAnchor) === wantsAnchored);
  return items.length === page.items.length ? page : { ...page, items };
};

/**
 * Server pages a scope may skip in one fetch. A page that filters down to
 * nothing (see {@link partitionThreadPage}) would end the feed — the replica
 * reads an empty page as the last one — so the fetch follows its cursor until
 * a page keeps a row or the server runs out. Bounded so a document with many
 * roots of the other scope cannot fan out into an unbounded request chain.
 */
export const MAX_EMPTY_THREAD_PAGE_HOPS = 10;

/** One page of a scope's roots, following the server cursor past pages filtered to nothing. */
export const fetchThreadPage = async (
  listThreads: (cursor: string | undefined) => Promise<DocumentCommentThreadPage>,
  scope: DocumentCommentThreadScope,
  cursor?: string,
): Promise<DocumentCommentThreadPage> => {
  let page = partitionThreadPage(await listThreads(cursor), scope);
  for (
    let hop = 0;
    page.items.length === 0 && page.nextCursor && hop < MAX_EMPTY_THREAD_PAGE_HOPS;
    hop++
  ) {
    page = partitionThreadPage(await listThreads(page.nextCursor), scope);
  }
  return page;
};

/** Persisted rows per resource and scope; the least recently used beyond it are evicted. */
const MAX_PERSISTED_DOCUMENTS = 50;
/** Reply feeds are per root, so a few documents already hold many of them. */
const MAX_PERSISTED_REPLY_FEEDS = 200;
/** Deep-link targets only: a pinned root or reply. */
const MAX_PERSISTED_DETAILS = 20;

/** Root-comment threads of one document, per scope (`threadFeedMap`). */
export const documentCommentThreadResource = definePagedReplica<
  DocumentCommentThreadsParams,
  DocumentCommentThread,
  string
>({
  key: documentCommentThreadsKey,
  name: 'documentCommentThreads',
  paging: {
    direction: 'forward',
    getId: (thread) => thread.root.id,
    mode: 'cursor',
    // A reload repaints the head page the server would return, never a stale tail.
    persist: { pages: 1 },
  },
  // Two scopes per document.
  persist: { maxEntries: MAX_PERSISTED_DOCUMENTS * 2 },
  storage: 'indexedDB',
  version: 1,
});

/** Replies of one root comment (`replyFeedMap`). */
export const documentCommentReplyResource = definePagedReplica<
  DocumentCommentRepliesParams,
  DocumentCommentItem,
  string
>({
  key: ({ rootCommentId }) => rootCommentId,
  name: 'documentCommentReplies',
  paging: {
    direction: 'forward',
    getId: (comment) => comment.id,
    mode: 'cursor',
    persist: { pages: 1 },
  },
  persist: { maxEntries: MAX_PERSISTED_REPLY_FEEDS },
  storage: 'indexedDB',
  version: 1,
});

/** Per-document comment count (`summaryMap[documentId]`). */
export const documentCommentSummaryResource = defineReplica<string, DocumentCommentSummary>({
  key: (documentId) => documentId,
  name: 'documentCommentSummary',
  persist: { maxEntries: MAX_PERSISTED_DOCUMENTS },
  storage: 'indexedDB',
  version: 1,
});

/** Every anchored root of a document, for the body highlights (`anchorListMap[documentId]`). */
export const documentCommentAnchorResource = defineReplica<string, DocumentCommentAnchorList>({
  key: (documentId) => documentId,
  name: 'documentCommentAnchors',
  persist: { maxEntries: MAX_PERSISTED_DOCUMENTS },
  storage: 'indexedDB',
  version: 1,
});

/** One comment by id, for a deep-link target (`detailMap[commentId]`). */
export const documentCommentDetailResource = defineReplica<string, DocumentCommentDetail>({
  key: (commentId) => commentId,
  name: 'documentCommentDetail',
  persist: { maxEntries: MAX_PERSISTED_DETAILS },
  storage: 'indexedDB',
  version: 1,
});

/** Like count, likers and the reader's own like (`likeSummaryMap[documentId]`). */
export const documentLikeSummaryResource = defineReplica<string, DocumentLikeSummary>({
  key: (documentId) => documentId,
  name: 'documentLikeSummary',
  persist: { maxEntries: MAX_PERSISTED_DOCUMENTS },
  storage: 'indexedDB',
  version: 1,
});
