import { describe, expect, it } from 'vitest';

import { resolveRejectedCopyKey } from './resolveRejectedCopyKey';

describe('resolveRejectedCopyKey', () => {
  it('picks question-specific copy for a skipped askUserQuestion', () => {
    expect(resolveRejectedCopyKey({ apiName: 'askUserQuestion', skipped: true })).toBe(
      'tool.intervention.questionSkipped',
    );
  });

  // Regression: the skip path is shared by all custom interactions (e.g. the
  // onboarding marketplace picker) — those must not be labeled as questions.
  it('picks generic skipped copy for a skipped non-question interaction', () => {
    expect(resolveRejectedCopyKey({ apiName: 'showAgentMarketplace', skipped: true })).toBe(
      'tool.intervention.toolSkipped',
    );
  });

  it('picks generic skipped copy when apiName is missing', () => {
    expect(resolveRejectedCopyKey({ skipped: true })).toBe('tool.intervention.toolSkipped');
  });

  it('keeps the rejection warning for non-skipped rejections', () => {
    expect(resolveRejectedCopyKey({ apiName: 'askUserQuestion' })).toBe(
      'tool.intervention.toolRejected',
    );
  });

  it('uses the reason variant for non-skipped rejections with a reason', () => {
    expect(resolveRejectedCopyKey({ reason: 'not safe' })).toBe(
      'tool.intervention.rejectedWithReason',
    );
  });

  it('states a producer timeout as its own outcome, not as a user decision', () => {
    // A timeout is nobody's choice. Falling through to the skip or rejection
    // copy would tell the user they declined a question they never saw in time.
    expect(resolveRejectedCopyKey({ apiName: 'askUserQuestion', timedOut: true })).toBe(
      'tool.intervention.questionTimedOut',
    );
    expect(
      resolveRejectedCopyKey({ apiName: 'askUserQuestion', skipped: true, timedOut: true }),
    ).toBe('tool.intervention.questionTimedOut');
    expect(resolveRejectedCopyKey({ reason: 'not safe', timedOut: true })).toBe(
      'tool.intervention.questionTimedOut',
    );
  });
});
