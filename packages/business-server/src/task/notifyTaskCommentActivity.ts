export type TaskCommentActivityKind = 'commented' | 'mentioned';

export interface TaskCommentActivityRecipient {
  kind: TaskCommentActivityKind;
  userId: string;
}

export interface NotifyTaskCommentActivityParams {
  /**
   * The agent that wrote the comment on `actorUserId`'s behalf. When set, the
   * notification is attributed to the agent and `actorUserId` is an ordinary
   * recipient (an agent may @mention the member it runs for).
   */
  actorAgentId?: string;
  /** The member who wrote / edited the comment — never notified unless `actorAgentId` is set. */
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
