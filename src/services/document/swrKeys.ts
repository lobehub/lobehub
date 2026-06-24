// Domain-namespaced SWR key roots. See the central registry in `@/libs/swr/keys`.
export const SWR_USE_FETCH_NOTEBOOK_DOCUMENTS = 'notebook:documents';

export const agentDocumentSWRKeys = {
  documents: (agentId: string) => ['agent:documents', agentId] as const,
  /**
   * UI-side list: raw AgentDocumentWithRules (includes documentId, sourceType, createdAt).
   * Kept separate from `documents` because the agent store writes mapAgentDocumentsToContext(...)
   * under that key, which drops those fields.
   */
  documentsList: (agentId: string) => ['agent:documentsList', agentId] as const,
  documentChatTopic: (agentId: string, documentId: string) =>
    ['agent:documentChatTopic', agentId, documentId] as const,
  readDocument: (agentId: string, id: string) => ['agent:documentEditor', agentId, id] as const,
};

export const documentSWRKeys = {
  editor: (documentId: string) => ['document:editor', documentId] as const,
  pageDetail: (documentId: string) => ['page:detail', documentId] as const,
  pageDocuments: () => ['page:list'] as const,
  pageMeta: (documentId: string) => ['page:meta', documentId] as const,
};

export const notebookSWRKeys = {
  documents: (topicId: string) => [SWR_USE_FETCH_NOTEBOOK_DOCUMENTS, topicId] as const,
};
