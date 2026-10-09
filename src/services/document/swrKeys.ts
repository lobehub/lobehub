// Domain-namespaced SWR key roots. See the central registry in `@/libs/swr/keys`.
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
  readerDocument: (agentId: string, documentId: string) =>
    ['agent:documentReader', agentId, documentId] as const,
  readDocument: (agentId: string, id: string) => ['agent:documentEditor', agentId, id] as const,
};
