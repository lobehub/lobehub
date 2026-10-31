import type { SignalDecisionVerdict } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { pickWakeJudgeScore } from '../judgeScore';

const v = (
  policyId: string,
  verdict: SignalDecisionVerdict['verdict'],
  confidence: number,
  reason = 'score',
): SignalDecisionVerdict => ({
  confidence,
  latencyMs: 300,
  mode: 'enforce',
  policyId,
  reason,
  verdict,
  version: 1,
});

const CLASSIFIER = 'bot-wake:classifier';
const DUTY = 'bot-wake:duty';

describe('pickWakeJudgeScore', () => {
  it('uses the duty judge for an in-duty wake', () => {
    expect(
      pickWakeJudgeScore([v(CLASSIFIER, 'deny', 0.12), v(DUTY, 'allow', 0.81)], 'in-duty'),
    ).toEqual({ kind: 'duty', score: 0.81, verdict: 'allow' });
  });

  it('uses the addressed classifier otherwise', () => {
    expect(
      pickWakeJudgeScore([v(DUTY, 'deny', 0.3), v(CLASSIFIER, 'allow', 0.74)], 'named-in-text'),
    ).toEqual({ kind: 'addressed', score: 0.74, verdict: 'allow' });
  });

  it('falls back to the other judge when the preferred one did not score', () => {
    expect(
      pickWakeJudgeScore(
        [v(DUTY, 'abstain', 0, 'too-short'), v(CLASSIFIER, 'deny', 0.2)],
        'in-duty',
      ),
    ).toEqual({ kind: 'addressed', score: 0.2, verdict: 'deny' });
  });

  it.each([
    ['a classifier timeout', [v(CLASSIFIER, 'allow', 0, 'classifier-timeout')]],
    ['a classifier error', [v(CLASSIFIER, 'allow', 0, 'classifier-error: 500')]],
    ['a duty timeout', [v(DUTY, 'abstain', 0, 'duty-timeout')]],
    ['only rule policies', [v('bot-wake:owner-rules', 'deny', 1, 'owner-present')]],
    ['no verdicts', []],
  ])('has no score for %s', (_case, verdicts) => {
    expect(pickWakeJudgeScore(verdicts, 'not-addressed')).toBeUndefined();
  });

  it('has no score without verdicts at all', () => {
    expect(pickWakeJudgeScore(null, null)).toBeUndefined();
  });
});
