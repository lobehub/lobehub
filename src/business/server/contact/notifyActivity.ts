/**
 * A contact request reached a person: `received` is a new request to them, `accepted` means
 * the request they sent was accepted. Fired once per outcome.
 */
export interface NotifyContactRequestParams {
  /** Who sent the request (`received`) or accepted it (`accepted`). */
  actorUserId: string;
  kind: 'accepted' | 'received';
  recipientUserId: string;
  requestId: string;
}

export const notifyContactRequest = (_params: NotifyContactRequestParams): Promise<void> =>
  Promise.resolve();
