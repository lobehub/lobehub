export interface OnChangeRequestSettledParams {
  changeRequestId: string;
  /** When the provider recorded the merge or close. */
  settledAt: Date;
  state: 'closed' | 'merged';
  userId: string;
  /** The `external` Work registered for the change request, when there is one. */
  workId?: string | null;
  workspaceId?: string | null;
}

/**
 * Follow-up for a change request the provider reported as merged or closed,
 * called after the row has been persisted. Webhook deliveries replay, so an
 * implementation must be idempotent. The default does nothing.
 */
export async function onChangeRequestSettled(
  _params: OnChangeRequestSettledParams,
): Promise<void> {}
