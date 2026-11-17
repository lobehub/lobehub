import { type AgentDocumentModel, canReadDocument } from '@/database/models/agentDocuments';
import { isUuid } from '@/database/utils/uuid';

export interface AgentDocumentBindingState {
  accessSelf: number;
  deletedAt: Date | null;
  /** Backing `documents.id`. */
  documentId: string;
  /** `agent_documents.id`. */
  id: string;
}

/**
 * Which of the referenced ids point only at bindings that are no longer live.
 *
 * A reference is revoked when the agent has at least one binding for it and
 * none of them is both undeleted and readable. A binding id (UUID) with no
 * binding left was permanently deleted, so it is revoked too. Any other
 * reference with no binding — a knowledge-base document, an uploaded file,
 * another agent's document — is left alone, so only documents removed from
 * this agent are withheld.
 */
export const revokedAgentDocumentRefs = (
  refs: readonly string[],
  bindings: readonly AgentDocumentBindingState[],
): string[] =>
  [...new Set(refs)].filter((ref) => {
    const matches = bindings.filter((binding) => binding.id === ref || binding.documentId === ref);
    if (matches.length === 0) return isUuid(ref);
    return !matches.some((binding) => !binding.deletedAt && canReadDocument(binding));
  });

/**
 * Of the document ids that earlier turns of a conversation read, those whose
 * content must no longer reach the model for `agentId`:
 *
 * - every binding of the agent is deleted or lost read access, or the binding
 *   id no longer exists ({@link revokedAgentDocumentRefs});
 * - a `docs_*` id whose `documents` row no longer exists at all (permanently
 *   deleted, e.g. trash emptied — no tombstone is left to check);
 *
 * minus `docs_*` pages that are still knowledge-base items, which stay readable
 * there. Resolved with a constant number of queries for the whole batch.
 */
export const findRevokedDocumentReads = async (
  model: Pick<
    AgentDocumentModel,
    'listBindingStatesByRefs' | 'listExistingDocumentIds' | 'listKnowledgeBaseMemberIds'
  >,
  agentId: string,
  refs: readonly string[],
): Promise<string[]> => {
  const ids = [...new Set(refs)].filter((ref) => ref.length > 0);
  if (ids.length === 0) return [];

  const documentIds = ids.filter((ref) => ref.startsWith('docs_'));
  const [bindings, existing] = await Promise.all([
    model.listBindingStatesByRefs(agentId, ids),
    documentIds.length > 0 ? model.listExistingDocumentIds(documentIds) : [],
  ]);

  const existingIds = new Set(existing);
  const revoked = new Set(revokedAgentDocumentRefs(ids, bindings));
  for (const id of documentIds) if (!existingIds.has(id)) revoked.add(id);
  if (revoked.size === 0) return [];

  const knowledgeBaseMembers = new Set(
    await model.listKnowledgeBaseMemberIds([...revoked].filter((id) => existingIds.has(id))),
  );
  return [...revoked].filter((id) => !knowledgeBaseMembers.has(id)).sort();
};
