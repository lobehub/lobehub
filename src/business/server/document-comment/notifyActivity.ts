/**
 * - `commented`: a new root comment on a document the recipient authored
 * - `replied`: a reply whose direct target the recipient authored
 * - `thread`: a reply in a thread the recipient already participates in
 * - `mentioned`: the recipient was @-mentioned in the comment
 */
export type DocumentCommentActivityKind = 'commented' | 'mentioned' | 'replied' | 'thread';

export interface NotifyDocumentCommentActivityParams {
  actorUserId: string;
  commentId: string;
  documentId: string;
  kind: DocumentCommentActivityKind;
  recipientUserId: string;
  rootCommentId: string;
  workspaceId: string;
}

export const notifyDocumentCommentActivity = (
  _params: NotifyDocumentCommentActivityParams,
): Promise<void> => Promise.resolve();
