// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { canInitiateWake, decideWakeInitiation } from '../initiation';
import {
  CLASSIFIER_POLICY_ID,
  DUTY_HELPFUL_TAG,
  DUTY_POLICY_ID,
  INTERNAL_RULES_POLICY_ID,
  OWNER_RULES_POLICY_ID,
} from '../policies';
import type {
  WakePolicy,
  WakePolicyMode,
  WakePolicyResult,
  WakeSignal,
  WakeStateSnapshot,
} from '../types';

const signal: WakeSignal = { message: 'can someone check the export?', timestamp: 1 };

const snapshot: WakeStateSnapshot = {
  conversation: {
    botNames: ['Coder'],
    recent: [
      { at: 1, authorId: 'self', id: 'm1', isBot: true, text: 'Done.' },
      { at: 2, authorId: 'u2', authorName: 'Ada', id: 'm2', isBot: false, text: 'thanks' },
    ],
  },
  explicitMention: false,
  replyToBot: false,
  threadSubscribed: true,
};

const result = (verdict: WakePolicyResult['verdict'], reason: string, extra = {}) => ({
  confidence: verdict === 'abstain' ? 0 : 0.9,
  reason,
  tags: [],
  verdict,
  ...extra,
});

const policy = (
  id: string,
  outcome: WakePolicyResult,
  mode: WakePolicyMode = 'enforce',
): WakePolicy => ({
  evaluate: () => outcome,
  id,
  mode,
  requires: [],
  version: 1,
});

const rules = (outcome: WakePolicyResult) => policy(OWNER_RULES_POLICY_ID, outcome);
const classifier = (outcome: WakePolicyResult, mode: WakePolicyMode = 'enforce') =>
  policy(CLASSIFIER_POLICY_ID, outcome, mode);
const duty = (outcome: WakePolicyResult) => policy(DUTY_POLICY_ID, outcome);

const decide = (policies: WakePolicy[], dutyPolicy?: WakePolicy) =>
  decideWakeInitiation({ dutyPolicy, policies, selfId: 'self', signal, snapshot });

describe('decideWakeInitiation', () => {
  it('wakes a participant its text names, without asking the classifier', async () => {
    const outcome = await decide([
      policy(INTERNAL_RULES_POLICY_ID, result('allow', 'named-in-text')),
      classifier(result('deny', 'not-addressed')),
    ]);

    expect(outcome.initiation).toEqual({ addressed: true, reason: 'named-in-text' });
    expect(outcome.verdicts?.map((verdict) => verdict.policyId)).toEqual([
      INTERNAL_RULES_POLICY_ID,
    ]);
  });

  it('opens a follow-up with the classifier score and the other participants', async () => {
    const outcome = await decide([
      rules(result('allow', 'inside-followup-window')),
      classifier(result('allow', 'addressed', { confidence: 0.82 })),
    ]);

    expect(outcome.initiation).toEqual({
      addressed: false,
      followup: { participants: [{ isBot: false, isOwner: false, name: 'Ada' }], score: 0.82 },
      reason: 'followup-window',
    });
  });

  it('falls back to the duty judge when an enforcing classifier declines', async () => {
    const outcome = await decide(
      [rules(result('allow', 'inside-followup-window')), classifier(result('deny', 'other'))],
      duty(result('allow', 'in-duty', { matched: 'exports', tags: [DUTY_HELPFUL_TAG] })),
    );

    expect(outcome.initiation).toEqual({
      addressed: false,
      duty: 'exports',
      helpful: true,
      reason: 'in-duty',
    });
    expect(outcome.verdicts?.map((verdict) => verdict.policyId)).toEqual([
      OWNER_RULES_POLICY_ID,
      CLASSIFIER_POLICY_ID,
      DUTY_POLICY_ID,
    ]);
  });

  it('does not count a degraded classifier as a yes', async () => {
    const outcome = await decide([
      rules(result('allow', 'inside-followup-window')),
      classifier(result('allow', 'classifier-timeout', { tags: ['degraded'] })),
    ]);

    expect(outcome.initiation).toBeUndefined();
    expect(outcome.verdicts).toHaveLength(2);
  });

  it('keeps an enforcing deny on the record and never asks the duty judge', async () => {
    let judged = false;
    const outcome = await decide([rules(result('deny', 'budget-exhausted'))], {
      ...duty(result('allow', 'in-duty')),
      evaluate: () => {
        judged = true;
        return result('allow', 'in-duty');
      },
    });

    expect(outcome.initiation).toBeUndefined();
    expect(judged).toBe(false);
    expect(outcome.verdicts?.[0]).toMatchObject({ reason: 'budget-exhausted', verdict: 'deny' });
  });

  it('lets the duty judge act when the only objection is the owner being present', async () => {
    const outcome = await decide(
      [rules(result('deny', 'owner-present'))],
      duty(result('allow', 'in-duty', { matched: 'triage' })),
    );

    expect(outcome.initiation).toMatchObject({ duty: 'triage', reason: 'in-duty' });
  });

  it('leaves the verdicts for the record to replay when no rule had an opinion', async () => {
    const outcome = await decide([rules(result('abstain', 'no-rule-hit'))]);

    expect(outcome).toEqual({ verdicts: undefined });
  });
});

describe('canInitiateWake', () => {
  it('needs an enforcing rule or a duty judge', () => {
    const shadowRules = policy(OWNER_RULES_POLICY_ID, result('abstain', 'x'), 'shadow');

    expect(canInitiateWake({ policies: [shadowRules, classifier(result('allow', 'x'))] })).toBe(
      false,
    );
    expect(canInitiateWake({ policies: [rules(result('abstain', 'x'))] })).toBe(true);
    expect(
      canInitiateWake({ dutyPolicy: duty(result('abstain', 'x')), policies: [shadowRules] }),
    ).toBe(true);
  });
});
