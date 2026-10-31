import type { AgentDocumentListItem } from '@/services/agentDocument';
import {
  agentDocumentActions,
  agentDocumentSelectors,
  useAgentDocumentStore,
} from '@/store/agentDocument';

/**
 * Resolve the agent-document list row for a documents-table id. Reads the
 * agent's document-list replica (shared with the working sidebar), so it adds no
 * extra request — it surfaces the agentDocument row id (needed for delete/rename)
 * plus title / updatedAt for the page header. The persisted list paints the
 * header on a reload before the network answers.
 *
 * For a skill's `SKILL.md` index document the row title is the canonical
 * `SKILL.md` filename, so we also resolve the parent skill bundle — the page
 * shows the skill name (bundle title) instead and routes title edits to a
 * bundle rename.
 */
export const useAgentDocumentItem = (agentId: string | undefined, documentId: string) => {
  const { error, revalidate } = agentDocumentActions.useFetchDocumentList(agentId);
  const data = useAgentDocumentStore(agentDocumentSelectors.getDocumentList(agentId));
  const isConfirmed = useAgentDocumentStore(
    agentDocumentSelectors.isDocumentListConfirmed(agentId),
  );

  const item: AgentDocumentListItem | undefined = data?.find((d) => d.documentId === documentId);

  const skillBundle: AgentDocumentListItem | undefined =
    item?.isSkillIndex && item.parentId
      ? data?.find((d) => d.documentId === item.parentId)
      : undefined;

  // The server answered this session (not just the persisted copy of an earlier
  // one) and this documentId isn't in it → the doc genuinely doesn't exist for
  // this agent. Distinct from a fetch failure (`error`) and from still-loading.
  // A persisted list predates documents created since, so a row missing from it
  // is only "not loaded yet". The header title is sourced from this same list,
  // so gating not-found here keeps the whole module consistent instead of
  // letting the breadcrumb render a placeholder title over a 404 body.
  const isNotFound = !!agentId && isConfirmed && !error && !item;

  // Loading until this row can paint: a persisted list holding the row paints at
  // once, and a revalidation over it never flashes the loader.
  const isLoading = !!agentId && !item && !error && !isConfirmed;

  return { error, isLoading, isNotFound, item, mutate: revalidate, skillBundle };
};
