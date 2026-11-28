import { describe, expect, it } from 'vitest';

import { resolveTaskAcceptanceState } from './resolveTaskAcceptanceState';

describe('resolveTaskAcceptanceState', () => {
  it('reads a delivered round that did not fail as waiting for your review', () => {
    // T-90: every check passed verification and waits on the human; the round
    // itself is `delivered`, not `passed`.
    expect(resolveTaskAcceptanceState('delivered', 'delivered')).toBe('awaitingReview');
    expect(resolveTaskAcceptanceState('delivered', 'passed')).toBe('awaitingReview');
    expect(resolveTaskAcceptanceState('delivered', null)).toBe('awaitingReview');
  });

  it('asks for a decision only when the latest round failed', () => {
    expect(resolveTaskAcceptanceState('delivered', 'failed')).toBe('awaitingDecision');
  });
});
