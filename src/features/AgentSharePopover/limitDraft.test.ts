import { describe, expect, it } from 'vitest';

import { clearCommittedLimitDraft } from './limitDraft';

describe('clearCommittedLimitDraft', () => {
  it('clears fields whose current draft was acknowledged', () => {
    expect(
      clearCommittedLimitDraft(
        { maxTopicsPerVisitor: 8, maxTurnsPerTopic: 30 },
        { maxTopicsPerVisitor: 8 },
      ),
    ).toEqual({ maxTurnsPerTopic: 30 });
  });

  it('preserves a newer edit made while the committed request was in flight', () => {
    expect(
      clearCommittedLimitDraft(
        { maxTopicsPerVisitor: 9, maxTurnsPerTopic: 30 },
        { maxTopicsPerVisitor: 8 },
      ),
    ).toEqual({ maxTopicsPerVisitor: 9, maxTurnsPerTopic: 30 });
  });
});
