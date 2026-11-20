import { type ChatTopic } from '@/types/topic';

/**
 * Topics whose linked PR has merged and that are still open — the ones the
 * "archive merged PR topics" actions mark as completed. Pass `ownerId` to keep
 * only that user's topics (a workspace member's own scope).
 */
export const getMergedPullRequestTopics = (
  topics: ChatTopic[],
  ownerId?: string | null,
): ChatTopic[] =>
  topics.filter((topic) => {
    if (ownerId !== undefined && (!ownerId || topic.userId !== ownerId)) return false;

    const pullRequest = topic.metadata?.workingDirectoryConfig?.git?.github?.pullRequest;
    const isMerged = !!pullRequest?.mergedAt || pullRequest?.state?.toLowerCase() === 'merged';

    return (
      isMerged &&
      topic.status !== 'completed' &&
      topic.status !== 'archived' &&
      topic.status !== 'unread'
    );
  });
