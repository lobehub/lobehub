export type DocumentCommentActivityKind = 'commented' | 'mentioned' | 'replied';

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
