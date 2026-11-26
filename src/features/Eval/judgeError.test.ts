import { describe, expect, it } from 'vitest';

import { getJudgeFailure } from './judgeError';

describe('trajectory Judge failure display', () => {
  it('shows the dedicated grading diagnostic before an older execution error', () => {
    expect(
      getJudgeFailure('judge_error', { judgeError: 'Judge unavailable', error: 'Old error' }),
    ).toEqual({ diagnostic: 'Judge unavailable' });
  });

  it('recognizes thread Judge errors without a topic errorPhase and does not need a reason to flag them', () => {
    expect(getJudgeFailure('judge_error')).toEqual({ diagnostic: undefined });
    expect(
      getJudgeFailure('passed', { errorPhase: 'judge', judgeError: 'Protocol failure' }),
    ).toEqual({ diagnostic: 'Protocol failure' });
  });

  it('does not replace genuine model failures or execution errors with grading failures', () => {
    expect(getJudgeFailure('failed', { error: 'Step cap' })).toBeUndefined();
    expect(getJudgeFailure('error', { error: 'Provider unavailable' })).toBeUndefined();
    expect(getJudgeFailure('passed')).toBeUndefined();
  });
});
