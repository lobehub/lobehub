export type TaskAcceptanceStateKey =
  | 'accepted'
  | 'awaitingDecision'
  | 'awaitingReview'
  | 'awaitingVerification'
  | 'closed'
  | 'errored'
  | 'rejected'
  | 'repairing'
  | 'verifying';

/**
 * The human layer of a task's acceptance, from the aggregate status and its
 * latest round's run status.
 *
 * `delivered` means the round is in front of the human. Only a round whose
 * verifier actually failed is "not passed — your call"; any other delivered
 * round (passed, or still carrying checks only a human can judge) is waiting
 * for review, which is what the acceptance panel says too.
 */
export const resolveTaskAcceptanceState = (
  status: string,
  latestRunStatus?: string | null,
): TaskAcceptanceStateKey | undefined => {
  switch (status) {
    case 'accepted': {
      return 'accepted';
    }
    case 'closed': {
      return 'closed';
    }
    case 'delivered': {
      return latestRunStatus === 'failed' ? 'awaitingDecision' : 'awaitingReview';
    }
    case 'errored': {
      return 'errored';
    }
    // The checklist existing is not the same as it being checked. While the
    // round is still producing the delivery, nothing is under verification —
    // saying "verifying" here claims work that hasn't started.
    case 'pending':
    case 'planned': {
      return 'awaitingVerification';
    }
    case 'verifying': {
      return 'verifying';
    }
    case 'rejected': {
      return 'rejected';
    }
    case 'repairing': {
      return 'repairing';
    }
    default: {
      return undefined;
    }
  }
};
