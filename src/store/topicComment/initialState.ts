import type { TopicCommentItem, TopicCommentJson, TopicCommentSummary } from '@lobechat/types';

import { createReplicaState, type ReplicaState } from '@/libs/replica';

import type { TopicCommentReplyFeed, TopicCommentThreadFeed } from './projection';

export interface TopicCommentDraft {
  clientId?: string;
  content: string;
  editorData?: TopicCommentJson;
}

export interface OptimisticTopicComment {
  comment: TopicCommentItem;
  pending: boolean;
  targetKey: string;
}

export interface OptimisticTopicCommentMutation {
  affectsMessageCount?: boolean;
  comment: TopicCommentItem;
  deleteMode?: 'hard' | 'moderated' | 'soft';
  kind: 'delete' | 'restore' | 'update';
  pending: boolean;
}

export interface OptimisticTopicCommentReplyCountMutation {
  baselineCount: number;
  delta: -1 | 1;
  id: string;
  pending: boolean;
  rootCommentId: string;
  topicId: string;
  workspaceId: string;
}

export interface TopicCommentState {
  /** One comment by id (`commentDetailMap[commentId]`), read by the standalone thread view. */
  commentDetailMap: Record<string, TopicCommentItem>;
  /** Replica bookkeeping for `commentDetailMap`. */
  commentDetailReplica: ReplicaState<TopicCommentItem>;
  /** Per-topic comment counts (`commentSummaryMap[topicId]`), read by the badge + list. */
  commentSummaryMap: Record<string, TopicCommentSummary>;
  /** Replica bookkeeping for `commentSummaryMap`. */
  commentSummaryReplica: ReplicaState<TopicCommentSummary>;
  drafts: Record<string, TopicCommentDraft>;
  optimisticComments: Record<string, OptimisticTopicComment>;
  optimisticMutations: Record<string, OptimisticTopicCommentMutation>;
  optimisticReplyCountMutations: Record<string, OptimisticTopicCommentReplyCountMutation>;
  /** Replies per root comment (`replyFeedMap[rootCommentId]`). */
  replyFeedMap: Record<string, TopicCommentReplyFeed>;
  /** Replica bookkeeping for `replyFeedMap`. */
  replyFeedReplica: ReplicaState<TopicCommentReplyFeed>;
  /** Root-comment feeds per (topic, message) (`threadFeedMap[threadKey]`). */
  threadFeedMap: Record<string, TopicCommentThreadFeed>;
  /** Replica bookkeeping for `threadFeedMap`. */
  threadFeedReplica: ReplicaState<TopicCommentThreadFeed>;
}

export const initialState: TopicCommentState = {
  commentDetailMap: {},
  commentDetailReplica: createReplicaState(),
  commentSummaryMap: {},
  commentSummaryReplica: createReplicaState(),
  drafts: {},
  optimisticComments: {},
  optimisticMutations: {},
  optimisticReplyCountMutations: {},
  replyFeedMap: {},
  replyFeedReplica: createReplicaState(),
  threadFeedMap: {},
  threadFeedReplica: createReplicaState(),
};

export const createTopicCommentDraftKey = ({
  messageId,
  parentCommentId,
  topicId,
  workspaceId,
}: {
  messageId?: string;
  parentCommentId?: string;
  topicId: string;
  workspaceId: string;
}) =>
  `${workspaceId}:${topicId}:${parentCommentId ? `reply:${parentCommentId}` : `message:${messageId ?? 'all'}`}`;

export const createOptimisticTopicCommentKey = (targetKey: string, clientId: string) =>
  `${targetKey}:${clientId}`;
