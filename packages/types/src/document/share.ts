export type DocumentShareVisibility = 'private' | 'link';

export type DocumentSharePermission = 'read' | 'comment' | 'edit';

export interface DocumentShareInfo {
  documentId: string;
  pageViewCount: number;
  permission: DocumentSharePermission;
  visibility: DocumentShareVisibility;
}

export interface SharedDocumentOwnerMeta {
  avatar: string | null;
  displayName: string | null;
}

export interface SharedDocumentPayload {
  content: string | null;
  description: string | null;
  editorData: Record<string, unknown> | null;
  fileType: string;
  id: string;
  metadata: Record<string, unknown> | null;
  pages: unknown[] | null;
  title: string | null;
  updatedAt: Date;
}

export interface SharedDocumentData {
  document: SharedDocumentPayload;
  isOwner: boolean;
  ownerMeta: SharedDocumentOwnerMeta;
  pageViewCount: number;
  permission: DocumentSharePermission;
  visibility: DocumentShareVisibility;
}
