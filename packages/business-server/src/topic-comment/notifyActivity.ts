export type TopicCommentActivityKind = 'commented' | 'commentedOnMessage' | 'mentioned' | 'replied';

export interface TopicCommentActivityRecipient {
  kind: TopicCommentActivityKind;
  userId: string;
}

export interface NotifyTopicCommentActivityParams {
  actorUserId: string;
  commentId: string;
  recipients: TopicCommentActivityRecipient[];
  rootCommentId: string;
  topicId: string;
  workspaceId: string;
}

/** Optional integration hook for delivering comment activity to recipients. */
export async function notifyTopicCommentActivity(
  _params: NotifyTopicCommentActivityParams,
): Promise<void> {}
