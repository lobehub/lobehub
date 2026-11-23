export interface OnThreadArchivedParams {
  channelId: string;
  threadId: string;
  /** The person who archived the Thread. */
  userId: string;
  workspaceId?: string;
}

/**
 * Follow-up for a channel Thread that was just archived, called after the
 * archive has been written. It must not slow the archive down, so an
 * implementation only enqueues its work. The default does nothing.
 */
export async function onThreadArchived(_params: OnThreadArchivedParams): Promise<void> {}
