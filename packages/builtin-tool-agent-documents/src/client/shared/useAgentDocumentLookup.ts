import { useMemo } from 'react';

import type { AgentDocumentListItem } from '@/services/agentDocument';
import { useAgentStore } from '@/store/agent';
import {
  agentDocumentActions,
  agentDocumentSelectors,
  useAgentDocumentStore,
} from '@/store/agentDocument';

export type AgentDocumentLookup = (ref?: string | null) => AgentDocumentListItem | undefined;

/**
 * Resolve the document ids a tool call carries (either the row `id` or the
 * `docs_…` documentId) to the rows the user knows by title. Reads the active
 * agent's document-list replica the sidebar shares, so it adds no request while
 * the documents panel is mounted and paints from the persisted list on reload.
 */
export const useAgentDocumentLookup = (): { isLoading: boolean; lookup: AgentDocumentLookup } => {
  const agentId = useAgentStore((s) => s.activeAgentId);
  const { error } = agentDocumentActions.useFetchDocumentList(agentId);
  const data = useAgentDocumentStore(agentDocumentSelectors.getDocumentList(agentId));
  const isLoading = !!agentId && !data && !error;

  const lookup = useMemo<AgentDocumentLookup>(() => {
    const byRef = new Map<string, AgentDocumentListItem>();
    for (const doc of data ?? []) {
      byRef.set(doc.id, doc);
      byRef.set(doc.documentId, doc);
    }
    return (ref) => (ref ? byRef.get(ref) : undefined);
  }, [data]);

  return { isLoading, lookup };
};
