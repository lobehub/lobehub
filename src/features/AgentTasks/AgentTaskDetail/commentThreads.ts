import type { TaskDetailActivity } from '@lobechat/types';

export interface CommentThreadEntry {
  activity: TaskDetailActivity;
  replies: TaskDetailActivity[];
}

/** Keep the API's original root/lifecycle order; only replies move into threads. */
export const groupCommentThreads = (activities: TaskDetailActivity[]): CommentThreadEntry[] => {
  const comments = new Map(
    activities
      .filter((activity) => activity.type === 'comment' && activity.id)
      .map((activity) => [activity.id!, activity]),
  );
  const threads = new Map<string, CommentThreadEntry>();
  const entries: CommentThreadEntry[] = [];
  const pending: TaskDetailActivity[] = [];

  for (const activity of activities) {
    const parent = activity.type === 'comment' && activity.parentCommentId;
    if (parent && parent !== activity.id && comments.has(parent)) {
      pending.push(activity);
      continue;
    }
    const entry = { activity, replies: [] };
    entries.push(entry);
    if (activity.type === 'comment' && activity.id) threads.set(activity.id, entry);
  }

  for (const reply of pending) {
    const thread = threads.get(reply.parentCommentId!);
    if (thread) thread.replies.push(reply);
    // Invalid legacy linkage must not make a comment disappear. The server
    // normalizes all new replies to roots; malformed nested/cyclic data stays visible.
    else entries.push({ activity: reply, replies: [] });
  }
  for (const { replies } of threads.values()) {
    replies.sort(
      (a, b) =>
        (a.time ? new Date(a.time).getTime() : 0) - (b.time ? new Date(b.time).getTime() : 0),
    );
  }
  return entries;
};
