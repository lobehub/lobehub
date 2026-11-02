import { describe, expect, it } from 'vitest';

import { resolveProposalApplyErrorKey } from './proposalApplyError';

describe('resolveProposalApplyErrorKey', () => {
  /** @example Server error codes become explanations the user can act on. */
  it.each([
    [{ data: { code: 'CONFLICT' } }, 'agentic.proposal.applyConflict'],
    [{ data: { code: 'BAD_REQUEST' } }, 'agentic.proposal.applyInvalid'],
    [{ data: { code: 'NOT_FOUND' } }, 'agentic.proposal.applyFailed'],
    [new Error('network'), 'agentic.proposal.applyFailed'],
    [null, 'agentic.proposal.applyFailed'],
  ])('maps %o to %s', (error, key) => {
    expect(resolveProposalApplyErrorKey(error)).toBe(key);
  });
});
