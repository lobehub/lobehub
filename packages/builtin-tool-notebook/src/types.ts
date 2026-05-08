/**
 * @deprecated The notebook builtin tool is deprecated. Topic-scoped documents
 * now flow through the agent-documents pipeline (see
 * `@lobechat/builtin-tool-agent-documents`) while retaining the
 * `topic_documents` junction for topic-scoped listing.
 *
 * The manifest is no longer registered with the LLM tools engine, so the model
 * can no longer invoke this tool. The identifier, executor, and server runtime
 * are preserved only to keep legacy tool-call messages rendering and
 * executing. Do not use these exports in new code.
 */
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
