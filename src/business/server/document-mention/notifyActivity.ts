/**
 * A workspace member was @-mentioned in the body of a document. Fired once per
 * newly added mention when the document is saved; the caller has already
 * narrowed recipients to active members who can view the document.
 */
export interface NotifyDocumentMentionParams {
  actorUserId: string;
  documentId: string;
  recipientUserId: string;
  /** Save timestamp of the snapshot that introduced the mention. */
  savedAt: Date;
  workspaceId: string;
}

export const notifyDocumentMention = (_params: NotifyDocumentMentionParams): Promise<void> =>
  Promise.resolve();
