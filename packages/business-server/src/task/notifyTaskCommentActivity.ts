export type TaskCommentActivityKind = 'commented' | 'mentioned';

export interface TaskCommentActivityRecipient {
  kind: TaskCommentActivityKind;
  userId: string;
}

export interface NotifyTaskCommentActivityParams {
  /** The member who wrote / edited the comment — never notified. */
  actorUserId: string;
  commentId: string;
  /** Deduplicated by userId; `mentioned` wins over `commented` for the same member. */
  recipients: TaskCommentActivityRecipient[];
  taskId: string;
  workspaceId: string;
}

export async function notifyTaskCommentActivity(
  _params: NotifyTaskCommentActivityParams,
): Promise<void> {}
