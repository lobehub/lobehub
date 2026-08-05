import type { TopicCommentStore } from './store';

const draft = (key: string) => (s: TopicCommentStore) => s.drafts[key];
const optimisticMutation = (commentId: string | null | undefined) => (s: TopicCommentStore) =>
  commentId ? s.optimisticMutations[commentId] : undefined;
const optimisticReplyCountMutations =
  (rootCommentId: string | null | undefined) => (s: TopicCommentStore) =>
    rootCommentId
      ? Object.values(s.optimisticReplyCountMutations).filter(
          (mutation) => mutation.rootCommentId === rootCommentId,
        )
      : [];
const optimisticReplyCountMutationsByTopic =
  (workspaceId: string | null | undefined, topicId: string | null | undefined) =>
  (s: TopicCommentStore) =>
    workspaceId && topicId
      ? Object.values(s.optimisticReplyCountMutations).filter(
          (mutation) => mutation.workspaceId === workspaceId && mutation.topicId === topicId,
        )
      : [];
const optimisticReplyMutations =
  (workspaceId: string | null | undefined, rootCommentId: string | null | undefined) =>
  (s: TopicCommentStore) =>
    workspaceId && rootCommentId
      ? Object.values(s.optimisticMutations).filter(
          ({ comment }) =>
            comment.workspaceId === workspaceId && comment.parentCommentId === rootCommentId,
        )
      : [];
const optimisticReplies =
  (workspaceId: string | null | undefined, rootCommentId: string | null | undefined) =>
  (s: TopicCommentStore) =>
    workspaceId && rootCommentId
      ? Object.values(s.optimisticComments)
          .filter(
            ({ comment }) =>
              comment.workspaceId === workspaceId && comment.parentCommentId === rootCommentId,
          )
          .sort(
            (a, b) =>
              new Date(a.comment.createdAt).getTime() - new Date(b.comment.createdAt).getTime(),
          )
      : [];
const optimisticThreadMutations =
  (
    workspaceId: string | null | undefined,
    topicId: string | null | undefined,
    messageId?: string,
  ) =>
  (s: TopicCommentStore) =>
    workspaceId && topicId
      ? Object.values(s.optimisticMutations).filter(
          ({ comment }) =>
            comment.workspaceId === workspaceId &&
            comment.topicId === topicId &&
            !comment.parentCommentId &&
            (!messageId || comment.messageId === messageId),
        )
      : [];
const optimisticThreads =
  (
    workspaceId: string | null | undefined,
    topicId: string | null | undefined,
    messageId?: string,
  ) =>
  (s: TopicCommentStore) =>
    workspaceId && topicId
      ? Object.values(s.optimisticComments)
          .filter(
            ({ comment }) =>
              comment.workspaceId === workspaceId &&
              comment.topicId === topicId &&
              !comment.parentCommentId &&
              (!messageId || comment.messageId === messageId),
          )
          .sort(
            (a, b) =>
              new Date(b.comment.createdAt).getTime() - new Date(a.comment.createdAt).getTime(),
          )
      : [];
const summaryPendingComments =
  (workspaceId: string | null | undefined, topicId: string | null | undefined) =>
  (s: TopicCommentStore) =>
    workspaceId && topicId
      ? Object.values(s.optimisticComments).filter(
          ({ comment, pending }) =>
            pending &&
            comment.workspaceId === workspaceId &&
            comment.topicId === topicId &&
            !comment.deletedAt,
        )
      : [];
const summaryPendingDeletes =
  (workspaceId: string | null | undefined, topicId: string | null | undefined) =>
  (s: TopicCommentStore) =>
    workspaceId && topicId
      ? Object.values(s.optimisticMutations).filter(
          ({ comment, kind, pending }) =>
            pending &&
            kind === 'delete' &&
            comment.workspaceId === workspaceId &&
            comment.topicId === topicId,
        )
      : [];
const summaryPendingRestores =
  (workspaceId: string | null | undefined, topicId: string | null | undefined) =>
  (s: TopicCommentStore) =>
    workspaceId && topicId
      ? Object.values(s.optimisticMutations).filter(
          ({ comment, kind, pending }) =>
            pending &&
            kind === 'restore' &&
            comment.workspaceId === workspaceId &&
            comment.topicId === topicId,
        )
      : [];

export const topicCommentSelectors = {
  draft,
  optimisticMutation,
  optimisticReplyCountMutations,
  optimisticReplyCountMutationsByTopic,
  optimisticReplyMutations,
  optimisticReplies,
  optimisticThreadMutations,
  optimisticThreads,
  summaryPendingComments,
  summaryPendingDeletes,
  summaryPendingRestores,
};
