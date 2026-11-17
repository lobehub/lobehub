import { canReadDocument } from '@/database/models/agentDocuments';
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
