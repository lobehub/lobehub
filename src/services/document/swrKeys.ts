// Domain-namespaced SWR key roots. See the central registry in `@/libs/swr/keys`.
// The agent's document list and the read-only reader are replicas
// (`@/store/agentDocument`), so they have no SWR key here.
export const agentDocumentSWRKeys = {
  documentChatTopic: (agentId: string, documentId: string) =>
    ['agent:documentChatTopic', agentId, documentId] as const,
};
