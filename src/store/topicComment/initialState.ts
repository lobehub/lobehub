import type { TopicCommentItem, TopicCommentJson } from '@lobechat/types';

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
  drafts: Record<string, TopicCommentDraft>;
  optimisticComments: Record<string, OptimisticTopicComment>;
  optimisticMutations: Record<string, OptimisticTopicCommentMutation>;
  optimisticReplyCountMutations: Record<string, OptimisticTopicCommentReplyCountMutation>;
}

export const initialState: TopicCommentState = {
  drafts: {},
  optimisticComments: {},
  optimisticMutations: {},
  optimisticReplyCountMutations: {},
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
