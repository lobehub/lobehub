import type { TopicCommentItem, TopicCommentSummary, TopicCommentThread } from '@lobechat/types';

import { definePagedReplica, defineReplica, type ReplicaPagedData } from '@/libs/replica';

/** One server page of comments (`limit` caps it; the cursor walks backwards in time). */
export const TOPIC_COMMENT_PAGE_SIZE = 30;

/**
 * Root-comment feed of one topic, optionally narrowed to a single message.
 * The active workspace is part of the replica scope, so it is not repeated in
 * the key — only the topic and the message narrow the row set.
 */
export interface TopicCommentThreadsParams {
  messageId?: string;
  pageSize?: number;
  topicId: string;
}

/** Root-comment feed of one topic: `threadFeedMap[topicCommentThreadsKey(params)]`. */
export type TopicCommentThreadFeed = ReplicaPagedData<TopicCommentThread, string>;

/** Reply feed of one root comment: `replyFeedMap[rootCommentId]`. */
export interface TopicCommentRepliesParams {
  pageSize?: number;
  rootCommentId: string;
}

/** Reply feed of one root comment (`total` = the canonical live-reply count, head page only). */
export type TopicCommentReplyFeed = ReplicaPagedData<TopicCommentItem, string>;

/**
 * Feed identity of a root-comment thread view. A message-scoped view and the
 * topic-wide view are distinct entries: mounting one must not reset the other.
 */
export const topicCommentThreadsKey = ({
  messageId,
  topicId,
}: Pick<TopicCommentThreadsParams, 'messageId' | 'topicId'>) =>
  messageId ? `${topicId}:message:${messageId}` : `${topicId}:all`;

const threadPaging = {
  direction: 'forward',
  getId: (thread: TopicCommentThread) => thread.root.id,
  mode: 'cursor',
  // A reload repaints the head page the server would return, never a stale tail.
  persist: { pages: 1 },
} as const;

const replyPaging = {
  direction: 'forward',
  getId: (comment: TopicCommentItem) => comment.id,
  mode: 'cursor',
  persist: { pages: 1 },
} as const;

/** Root-comment threads of one topic (`threadFeedMap`). */
export const topicCommentThreadResource = definePagedReplica<
  TopicCommentThreadsParams,
  TopicCommentThread,
  string
>({
  key: topicCommentThreadsKey,
  name: 'topicCommentThreads',
  paging: threadPaging,
  storage: 'indexedDB',
  version: 1,
});

/** Replies of one root comment (`replyFeedMap`). */
export const topicCommentReplyResource = definePagedReplica<
  TopicCommentRepliesParams,
  TopicCommentItem,
  string
>({
  key: ({ rootCommentId }) => rootCommentId,
  name: 'topicCommentReplies',
  paging: replyPaging,
  storage: 'indexedDB',
  version: 1,
});

/** Per-topic comment counts (`commentSummaryMap[topicId]`). */
export const topicCommentSummaryResource = defineReplica<
  string,
  TopicCommentSummary,
  TopicCommentSummary
>({
  key: (topicId) => topicId,
  name: 'topicCommentSummary',
  storage: 'indexedDB',
  version: 1,
});

/** One comment by id (`commentDetailMap[commentId]`), for the standalone thread view. */
export const topicCommentDetailResource = defineReplica<string, TopicCommentItem, TopicCommentItem>(
  {
    key: (commentId) => commentId,
    name: 'topicCommentDetail',
    storage: 'indexedDB',
    version: 1,
  },
);
