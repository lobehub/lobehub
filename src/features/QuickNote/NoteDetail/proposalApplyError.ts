/**
 * Maps an `applyProposal` failure to the note i18n key that explains it.
 *
 * Before:
 * - A tRPC client error with `data.code === 'CONFLICT'` (the Proposal was already dismissed)
 *
 * After:
 * - `'agentic.proposal.applyConflict'`
 */
export const resolveProposalApplyErrorKey = (error: unknown): string => {
  const code = (error as { data?: { code?: unknown } } | null)?.data?.code;

  switch (code) {
    case 'CONFLICT': {
      return 'agentic.proposal.applyConflict';
    }
    case 'BAD_REQUEST': {
      return 'agentic.proposal.applyInvalid';
    }
    default: {
      return 'agentic.proposal.applyFailed';
    }
  }
};
