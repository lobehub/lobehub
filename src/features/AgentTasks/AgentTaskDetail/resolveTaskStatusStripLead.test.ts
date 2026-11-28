import { describe, expect, it } from 'vitest';

import { resolveTaskStatusStripLead } from './resolveTaskStatusStripLead';

describe('resolveTaskStatusStripLead', () => {
  it('leads with a delivery that waits on your decision', () => {
    expect(resolveTaskStatusStripLead('paused', false, 'awaitingDecision')).toEqual({
      kind: 'acceptance',
      needsDecision: true,
      state: 'awaitingDecision',
    });
    expect(resolveTaskStatusStripLead('running', true, 'awaitingReview')).toEqual({
      kind: 'acceptance',
      needsDecision: true,
      state: 'awaitingReview',
    });
  });

  it('shows the run while the agent is executing, even with an acceptance on file', () => {
    expect(resolveTaskStatusStripLead('running', false, 'awaitingDecision')).toEqual({
      kind: 'status',
    });
  });

  it('keeps run as the primary action once nothing waits on you', () => {
    expect(resolveTaskStatusStripLead('completed', false, 'accepted')).toEqual({
      kind: 'acceptance',
      needsDecision: false,
      state: 'accepted',
    });
    expect(resolveTaskStatusStripLead('running', false, 'verifying')).toEqual({ kind: 'status' });
  });

  it('falls back to the waiting state before the acceptance aggregate loads', () => {
    expect(resolveTaskStatusStripLead('running', true, undefined)).toEqual({
      kind: 'awaitingAcceptance',
    });
    expect(resolveTaskStatusStripLead('backlog', false, undefined)).toEqual({ kind: 'status' });
  });
});
