export interface OnTaskSettledParams {
  status: 'canceled' | 'completed';
  /** Every task that moved into `status` in this one transition. */
  taskIds: string[];
  userId: string;
  workspaceId?: string;
}

/**
 * Follow-up for tasks a status transition just moved into `completed` or
 * `canceled`, called after the write. The default does nothing.
 */
export async function onTaskSettled(_params: OnTaskSettledParams): Promise<void> {}
