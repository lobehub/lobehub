interface ArtifactLike {
  agentDocumentId?: string;
  createdAt: Date;
  nodeId: string;
  resourceId: string | null;
  title: string | null;
  type: string;
}

export interface FinalDeliverable {
  agentDocumentId?: string;
  documentId: string;
  /** The task node that produced it. */
  nodeId: string;
  title: string | null;
}

/**
 * The document the Goal produced — the product itself, which is what the owner
 * opens a finished Goal to read. Never the acceptance report or a synthesized
 * finding: those describe the product.
 *
 * The newest document wins, but one written by the work outranks one written by
 * the final acceptance Task, whose job is to check the product rather than to
 * be it. Returns nothing when the Goal left no document behind.
 */
export const pickFinalDeliverable = (
  artifacts: ArtifactLike[],
  acceptanceNodeId: string,
): FinalDeliverable | undefined => {
  const documents = artifacts
    .filter((artifact) => artifact.type === 'document' && artifact.resourceId)
    .sort(
      (a, b) =>
        Number(a.nodeId === acceptanceNodeId) - Number(b.nodeId === acceptanceNodeId) ||
        b.createdAt.getTime() - a.createdAt.getTime(),
    );
  const picked = documents[0];
  if (!picked?.resourceId) return undefined;

  return {
    ...(picked.agentDocumentId ? { agentDocumentId: picked.agentDocumentId } : {}),
    documentId: picked.resourceId,
    nodeId: picked.nodeId,
    title: picked.title,
  };
};
