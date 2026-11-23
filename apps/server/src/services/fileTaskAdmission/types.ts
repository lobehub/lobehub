export type FileTaskKind = 'embedding' | 'parse';

export interface FileTaskRef {
  fileId: string;
  kind: FileTaskKind;
  taskId: string;
  userId: string;
  workspaceId?: string;
}

export interface FileTaskAdmission {
  /** Set when the task holds a slot the async route must release. */
  admissionScope?: string;
  queued: boolean;
}
