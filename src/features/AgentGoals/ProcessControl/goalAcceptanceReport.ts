/**
 * What the terminal Goal acceptance means to the person who owns the Goal.
 *
 * `delivered` alone cannot be rendered honestly: a round that passed and is
 * waiting for sign-off lands there, and so does one that ran out of rounds
 * without passing. The latest round's status tells them apart.
 */
export type GoalAcceptanceState =
  'accepted' | 'awaitingAcceptance' | 'awaitingDecision' | 'errored' | 'inProgress' | 'rejected';

export const goalAcceptanceState = (
  status: string,
  latestRunStatus?: string | null,
): GoalAcceptanceState | undefined => {
  switch (status) {
    case 'accepted': {
      return 'accepted';
    }
    case 'delivered': {
      return latestRunStatus === 'passed' ? 'awaitingAcceptance' : 'awaitingDecision';
    }
    case 'errored': {
      return 'errored';
    }
    case 'pending':
    case 'planned':
    case 'repairing':
    case 'verifying': {
      return 'inProgress';
    }
    case 'rejected': {
      return 'rejected';
    }
    default: {
      return undefined;
    }
  }
};

/**
 * Whether the final acceptance has earned its report view: the acceptance Task
 * finished (its node resolved) and the only thing left is the owner's sign-off,
 * or it was already signed off. Anything short of that — still running, lost,
 * failed, parked on a gate — is ordinary work and keeps the ordinary row.
 */
export const isFinalAcceptanceReady = (
  nodeStatus: string,
  state: GoalAcceptanceState | undefined,
): boolean => nodeStatus === 'resolved' && (state === 'awaitingAcceptance' || state === 'accepted');

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

interface RoundLike {
  run: { status: string | null };
}

/** Rounds arrive in round order; the newest one decides the state. */
export const latestRunStatus = (rounds: RoundLike[]): string | null | undefined =>
  rounds.at(-1)?.run.status;
