export interface NotifyTopicCommentModerationParams {
  authorUserId: string;
  commentId: string;
  event: 'removed' | 'restored';
  eventId: string;
  rootCommentId: string;
  topicId: string;
  workspaceId: string;
}

/** Optional integration hook for comment moderation activity. */
export async function notifyTopicCommentModeration(
  _params: NotifyTopicCommentModerationParams,
): Promise<void> {}
