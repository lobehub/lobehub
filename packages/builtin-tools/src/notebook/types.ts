/**
 * @deprecated `lobe-notebook` is no longer registered with the LLM tools
 * engine. This render and its types are retained only to keep legacy tool-call
 * messages displaying. Plan to delete this folder ~3 months after 2026-05-04.
 */
export type DocumentSourceType = 'ai' | 'file' | 'user' | 'web';
export type DocumentType = 'article' | 'markdown' | 'note' | 'report';

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

export interface CreateDocumentArgs {
  content: string;
  description: string;
  title: string;
  type?: DocumentType;
}

export interface CreateDocumentState {
  document: NotebookDocument;
}
