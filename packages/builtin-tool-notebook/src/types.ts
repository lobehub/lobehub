export const NotebookIdentifier = 'lobe-notebook';

export const NotebookApiName = {
  createDocument: 'createDocument',
  deleteDocument: 'deleteDocument',
  getDocument: 'getDocument',
  updateDocument: 'updateDocument',
} as const;

export type DocumentType = 'article' | 'markdown' | 'note' | 'report';
export type DocumentSourceType = 'ai' | 'file' | 'user' | 'web';

export interface NotebookDocument {
  content: string;
  createdAt: string;
  description: string;
  id: string;
  sourceType: DocumentSourceType;
  title: string;
  type: DocumentType;
  updatedAt: string;
  wordCount: number;
}

// ==================== API Arguments ====================

export interface CreateDocumentArgs {
  content: string;
  description: string;
  title: string;
  type?: DocumentType;
}

export interface UpdateDocumentArgs {
  append?: boolean;
  content?: string;
  id: string;
  title?: string;
}

export interface GetDocumentArgs {
  id: string;
}

export interface DeleteDocumentArgs {
  id: string;
}

// ==================== API States ====================

export interface CreateDocumentState {
  document: NotebookDocument;
}

export interface UpdateDocumentState {
  document: NotebookDocument;
}

export interface GetDocumentState {
  document: NotebookDocument;
}

export interface DeleteDocumentState {
  deletedId: string;
}
