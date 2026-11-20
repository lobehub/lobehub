import type { TaskDetailActivity } from '@lobechat/types';

export interface CommentThreads {
  /** Each thread's replies, oldest first, keyed by the top-level comment's id. */
  repliesByRootId: Map<string, TaskDetailActivity[]>;
  /** The feed without replies: they are shown inside their thread instead. */
  topLevel: TaskDetailActivity[];
}

const timeOf = (activity: TaskDetailActivity) =>
  activity.time ? new Date(activity.time).getTime() : 0;

/**
 * Fold replies into their threads. A reply whose root is not in the feed (it
 * cannot be seen, or has not loaded) stays a top-level row rather than vanish.
 */
export const groupCommentThreads = (activities: TaskDetailActivity[]): CommentThreads => {
  const commentIds = new Set(
    activities.flatMap((a) => (a.type === 'comment' && a.id ? [a.id] : [])),
  );
  const repliesByRootId = new Map<string, TaskDetailActivity[]>();
  const topLevel: TaskDetailActivity[] = [];

  for (const activity of activities) {
    const rootId = activity.type === 'comment' ? activity.parentCommentId : undefined;
    if (!rootId || !commentIds.has(rootId)) {
      topLevel.push(activity);
      continue;
    }
    const replies = repliesByRootId.get(rootId);
    if (replies) replies.push(activity);
    else repliesByRootId.set(rootId, [activity]);
  }

  for (const replies of repliesByRootId.values()) replies.sort((a, b) => timeOf(a) - timeOf(b));

  return { repliesByRootId, topLevel };
};
