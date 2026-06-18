import { useClientDataSWR } from '@/libs/swr';
import {
  type AgentDocumentListItem,
  agentDocumentService,
  agentDocumentSWRKeys,
} from '@/services/agentDocument';

/**
 * Resolve the agent-document list row for a documents-table id. Deduped against
 * the working-sidebar's documents list (same SWR key), so it adds no extra
 * request — it surfaces the agentDocument row id (needed for delete/rename) plus
 * title / updatedAt for the page header.
 */
export const useAgentDocumentItem = (agentId: string | undefined, documentId: string) => {
  const { data, mutate } = useClientDataSWR(
    agentId ? agentDocumentSWRKeys.documentsList(agentId) : null,
    () => agentDocumentService.listDocuments({ agentId: agentId! }),
  );

  const item: AgentDocumentListItem | undefined = data?.find((d) => d.documentId === documentId);

  return { item, mutate };
};
