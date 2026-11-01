import type { TransferResourceType } from '@lobechat/types';

/**
 * Member-to-member transfer lifecycle moments worth telling someone about:
 * - `requested` — a pending request was created; the recipient must act.
 * - `accepted` / `declined` — the recipient answered; the initiator hears the
 *   outcome. On accept, a previous owner different from the initiator (primary
 *   owner reassignment) additionally gets a courtesy notice.
 */
export interface NotifyResourceTransferParams {
  event: 'accepted' | 'declined' | 'requested';
  /** Null when the initiator account was deleted after the request was created. */
  initiatorId: string | null;
  previousOwnerId?: string | null;
  recipientId: string;
  requestId: string;
  resourceId: string;
  resourceType: TransferResourceType;
  workspaceId: string;
}

/** Optional integration hook for delivering transfer lifecycle notifications. */
export async function notifyResourceTransfer(
  _params: NotifyResourceTransferParams,
): Promise<void> {}
