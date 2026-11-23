export type FileTaskKind = 'embedding' | 'parse';

export interface FileTaskRef {
  fileId: string;
  kind: FileTaskKind;
  taskId: string;
  userId: string;
  workspaceId?: string;
}

/**
 * A task as it travels through the queue. `queuedUntil` doubles as the message's token: it must
 * match the marker on the task row, so a stale copy of a requeued message does nothing.
 */
export interface QueuedFileTask extends FileTaskRef {
  queuedUntil: string;
}

export interface FileTaskAdmission {
  /** Set when the task holds a slot the async route must release. */
  admissionScope?: string;
  queued: boolean;
}
