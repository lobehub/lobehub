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
 *
 * For a skill's `SKILL.md` index document the row title is the canonical
 * `SKILL.md` filename, so we also resolve the parent skill bundle — the page
 * shows the skill name (bundle title) instead and routes title edits to a
 * bundle rename.
 */
export const useAgentDocumentItem = (agentId: string | undefined, documentId: string) => {
  const { data, error, mutate } = useClientDataSWR(
    agentId ? agentDocumentSWRKeys.documentsList(agentId) : null,
    () => agentDocumentService.listDocuments({ agentId: agentId! }),
  );

  const item: AgentDocumentListItem | undefined = data?.find((d) => d.documentId === documentId);

  const skillBundle: AgentDocumentListItem | undefined =
    item?.isSkillIndex && item.parentId
      ? data?.find((d) => d.documentId === item.parentId)
      : undefined;

  // The list resolved successfully (`data` defined, no `error`) but this
  // documentId isn't in it → the doc genuinely doesn't exist for this agent.
  // Distinct from a fetch failure (`error`) and from still-loading
  // (`data === undefined`). The header title is sourced from this same list, so
  // gating not-found here keeps the whole module consistent instead of letting
  // the breadcrumb render a placeholder title over a 404 body.
  const isNotFound = !!agentId && data !== undefined && !error && !item;

  return { error, isNotFound, item, mutate, skillBundle };
};
