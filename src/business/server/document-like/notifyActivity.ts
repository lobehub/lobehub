export interface DocumentLikeActivityParams {
  actorUserId: string;
  documentId: string;
  recipientUserId: string;
  workspaceId: string;
}

/** Notify the document author that a member liked their document. */
export const notifyDocumentLiked = (_params: DocumentLikeActivityParams): Promise<void> =>
  Promise.resolve();

/** Withdraw the like notification after the member removes their like. */
export const revokeDocumentLikeNotification = (
  _params: DocumentLikeActivityParams,
): Promise<void> => Promise.resolve();
