import type { BriefArtifactDocument } from '@lobechat/types';

/** What opening one brief artifact shows. */
export type BriefArtifactTarget =
  | { agentDocumentId: string; agentId: string; type: 'skill' }
  | { documentId: string; type: 'page' };

/**
 * A `skill` artifact names one of the agent's managed skills by its
 * `agent_documents` id — not a page id — so it opens as that skill. Without
 * its agent such a skill can't be resolved, and there is nothing to open.
 * Every other artifact is the page it names.
 */
export const resolveBriefArtifactTarget = (
  doc: BriefArtifactDocument,
  agentId?: string | null,
): BriefArtifactTarget | undefined => {
  if (doc.kind === 'skill') {
    return agentId ? { agentDocumentId: doc.id, agentId, type: 'skill' } : undefined;
  }

  return { documentId: doc.id, type: 'page' };
};
