import type { DocumentCommentState } from './initialState';
import { documentCommentThreadsKey, type DocumentCommentThreadsParams } from './projection';

const anchorList = (documentId: string | null | undefined) => (s: DocumentCommentState) =>
  documentId ? s.anchorListMap[documentId] : undefined;

const detail = (commentId: string | null | undefined) => (s: DocumentCommentState) =>
  commentId ? s.detailMap[commentId] : undefined;

const likeSummary = (documentId: string | null | undefined) => (s: DocumentCommentState) =>
  documentId ? s.likeSummaryMap[documentId] : undefined;

const replyFeed = (rootCommentId: string | null | undefined) => (s: DocumentCommentState) =>
  rootCommentId ? s.replyFeedMap[rootCommentId] : undefined;

const summary = (documentId: string | null | undefined) => (s: DocumentCommentState) =>
  documentId ? s.summaryMap[documentId] : undefined;

const threadFeed =
  (params: DocumentCommentThreadsParams | null | undefined) => (s: DocumentCommentState) =>
    params ? s.threadFeedMap[documentCommentThreadsKey(params)] : undefined;

/** Every read returns the replica view; `undefined` means nothing is loaded for it yet. */
export const documentCommentSelectors = {
  anchorList,
  detail,
  likeSummary,
  replyFeed,
  summary,
  threadFeed,
};
