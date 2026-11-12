import type {
  DocumentCommentAnchorList,
  DocumentCommentDetail,
  DocumentCommentSummary,
  DocumentLikeSummary,
} from '@lobechat/types';

import { createReplicaSlice, recordLens } from '@/libs/replica';
import { documentCommentService } from '@/services/documentComment';
import { documentLikeService } from '@/services/documentLike';
import type { StoreSetter } from '@/store/types';
import { isTrpcErrorCode } from '@/utils/trpcError';

import type { DocumentCommentState } from './initialState';
import {
  DOCUMENT_COMMENT_PAGE_SIZE,
  documentCommentAnchorResource,
  documentCommentDetailResource,
  type DocumentCommentReplyFeed,
  documentCommentReplyResource,
  documentCommentSummaryResource,
  type DocumentCommentThreadFeed,
  documentCommentThreadPageSize,
  documentCommentThreadResource,
  documentLikeSummaryResource,
  fetchThreadPage,
} from './projection';

type Setter = StoreSetter<DocumentCommentState>;

/** The server no longer shows this entry to the reader: a cached copy must stop painting. */
const isGone = (error: unknown) =>
  isTrpcErrorCode(error, 'NOT_FOUND') || isTrpcErrorCode(error, 'FORBIDDEN');

/**
 * Replica slices of the document comment domain. Every read paints its
 * persisted copy first and is confirmed by the network in the background;
 * transient failures keep the copy (stale-while-revalidate), while a document
 * or comment the server reports gone is dropped from memory and storage so a
 * reload cannot resurrect it.
 */
export class DocumentCommentPrivateAction {
  readonly anchors;
  readonly detail;
  readonly likeSummary;
  readonly replies;
  readonly summary;
  readonly thread;

  constructor(set: Setter, get: () => DocumentCommentState) {
    const dropWhenGone =
      (remove: (key: string, scope?: string) => void) =>
      (
        error: unknown,
        _params: unknown,
        { key, scope }: { key: string | undefined; scope: string },
      ) => {
        if (key && isGone(error)) remove(key, scope);
      };

    this.thread = createReplicaSlice(documentCommentThreadResource, {
      actionPrefix: 'documentComment/threads',
      effects: { onError: dropWhenGone((key, scope) => this.thread.remove(key, scope)) },
      fetcher: ({ documentId, scope }, cursor) =>
        fetchThreadPage(
          (next) =>
            documentCommentService.listThreads({
              anchored: scope === 'all' ? undefined : scope === 'anchored',
              cursor: next,
              documentId,
              limit: documentCommentThreadPageSize(scope),
            }),
          scope,
          cursor,
        ),
      get,
      set,
      stateKey: 'threadFeedReplica',
      view: recordLens<DocumentCommentState, DocumentCommentThreadFeed>('threadFeedMap'),
    });
    this.replies = createReplicaSlice(documentCommentReplyResource, {
      actionPrefix: 'documentComment/replies',
      effects: { onError: dropWhenGone((key, scope) => this.replies.remove(key, scope)) },
      fetcher: ({ rootCommentId }, cursor) =>
        documentCommentService.listReplies({
          cursor,
          limit: DOCUMENT_COMMENT_PAGE_SIZE,
          rootCommentId,
        }),
      get,
      set,
      stateKey: 'replyFeedReplica',
      view: recordLens<DocumentCommentState, DocumentCommentReplyFeed>('replyFeedMap'),
    });
    this.summary = createReplicaSlice(documentCommentSummaryResource, {
      actionPrefix: 'documentComment/summary',
      effects: { onError: dropWhenGone((key, scope) => this.summary.remove(key, scope)) },
      fetcher: (documentId) => documentCommentService.summary(documentId),
      get,
      set,
      stateKey: 'summaryReplica',
      view: recordLens<DocumentCommentState, DocumentCommentSummary>('summaryMap'),
    });
    this.anchors = createReplicaSlice(documentCommentAnchorResource, {
      actionPrefix: 'documentComment/anchors',
      effects: { onError: dropWhenGone((key, scope) => this.anchors.remove(key, scope)) },
      fetcher: (documentId) => documentCommentService.listAnchors(documentId),
      get,
      set,
      stateKey: 'anchorListReplica',
      view: recordLens<DocumentCommentState, DocumentCommentAnchorList>('anchorListMap'),
    });
    this.detail = createReplicaSlice(documentCommentDetailResource, {
      actionPrefix: 'documentComment/detail',
      // A deleted deep-link target must not paint from storage on the next visit.
      effects: { onError: dropWhenGone((key, scope) => this.detail.remove(key, scope)) },
      fetcher: (commentId) => documentCommentService.get(commentId),
      get,
      set,
      stateKey: 'detailReplica',
      view: recordLens<DocumentCommentState, DocumentCommentDetail>('detailMap'),
    });
    this.likeSummary = createReplicaSlice(documentLikeSummaryResource, {
      actionPrefix: 'documentComment/likeSummary',
      effects: { onError: dropWhenGone((key, scope) => this.likeSummary.remove(key, scope)) },
      fetcher: (documentId) => documentLikeService.summary(documentId),
      get,
      set,
      stateKey: 'likeSummaryReplica',
      view: recordLens<DocumentCommentState, DocumentLikeSummary>('likeSummaryMap'),
    });
  }
}
