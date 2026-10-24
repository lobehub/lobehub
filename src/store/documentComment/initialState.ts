import type {
  DocumentCommentAnchorList,
  DocumentCommentDetail,
  DocumentCommentSummary,
  DocumentLikeSummary,
} from '@lobechat/types';

import { createReplicaState, type ReplicaState } from '@/libs/replica';

import type { DocumentCommentReplyFeed, DocumentCommentThreadFeed } from './projection';

export interface DocumentCommentState {
  /** Anchored roots per document (`anchorListMap[documentId]`), painted as body highlights. */
  anchorListMap: Record<string, DocumentCommentAnchorList>;
  anchorListReplica: ReplicaState<DocumentCommentAnchorList>;
  /** One comment by id (`detailMap[commentId]`), read by a deep-link landing. */
  detailMap: Record<string, DocumentCommentDetail>;
  detailReplica: ReplicaState<DocumentCommentDetail>;
  /** Like summary per document (`likeSummaryMap[documentId]`). */
  likeSummaryMap: Record<string, DocumentLikeSummary>;
  likeSummaryReplica: ReplicaState<DocumentLikeSummary>;
  /** Replies per root comment (`replyFeedMap[rootCommentId]`). */
  replyFeedMap: Record<string, DocumentCommentReplyFeed>;
  replyFeedReplica: ReplicaState<DocumentCommentReplyFeed>;
  /** Comment count per document (`summaryMap[documentId]`). */
  summaryMap: Record<string, DocumentCommentSummary>;
  summaryReplica: ReplicaState<DocumentCommentSummary>;
  /** Root feeds per (document, scope) (`threadFeedMap[documentCommentThreadsKey(params)]`). */
  threadFeedMap: Record<string, DocumentCommentThreadFeed>;
  threadFeedReplica: ReplicaState<DocumentCommentThreadFeed>;
}

export const initialState: DocumentCommentState = {
  anchorListMap: {},
  anchorListReplica: createReplicaState(),
  detailMap: {},
  detailReplica: createReplicaState(),
  likeSummaryMap: {},
  likeSummaryReplica: createReplicaState(),
  replyFeedMap: {},
  replyFeedReplica: createReplicaState(),
  summaryMap: {},
  summaryReplica: createReplicaState(),
  threadFeedMap: {},
  threadFeedReplica: createReplicaState(),
};
