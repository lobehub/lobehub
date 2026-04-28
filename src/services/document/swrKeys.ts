export const SWR_USE_FETCH_NOTEBOOK_DOCUMENTS = 'SWR_USE_FETCH_NOTEBOOK_DOCUMENTS';

export const agentDocumentSWRKeys = {
  documents: (agentId: string) => ['agent-documents', agentId] as const,
  /**
   * UI-side list: raw AgentDocumentWithRules (includes documentId, sourceType, createdAt).
   * Kept separate from `documents` because the agent store writes mapAgentDocumentsToContext(...)
   * under that key, which drops those fields.
   */
  documentsList: (agentId: string) => ['agent-documents-list', agentId] as const,
  readDocument: (agentId: string, id: string) =>
    ['workspace-agent-document-editor', agentId, id] as const,
};

export const documentSWRKeys = {
  editor: (documentId: string) => ['document/editor', documentId] as const,
  pageDetail: (documentId: string) => ['pageDetail', documentId] as const,
  pageDocuments: () => ['pageDocuments'] as const,
  pageMeta: (documentId: string) => ['page-document-meta', documentId] as const,
};

export const notebookSWRKeys = {
  documents: (topicId: string) => [SWR_USE_FETCH_NOTEBOOK_DOCUMENTS, topicId] as const,
};
