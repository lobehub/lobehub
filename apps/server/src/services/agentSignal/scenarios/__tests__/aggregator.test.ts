// @vitest-environment node
import { aggregateWakeVerdicts, isExplicitWake } from '../botWake/aggregator';
import type {
  WakePolicy,
  WakePolicyMode,
  WakeSignal,
  WakeStateSnapshot,
  WakeVerdict,
} from '../botWake/types';

const signal: WakeSignal = { message: 'hello', timestamp: 1 };
const idle: WakeStateSnapshot = {
  explicitMention: false,
  replyToBot: false,
  threadSubscribed: true,
};

const policy = (
  id: string,
  mode: WakePolicyMode,
  verdict: WakeVerdict,
  evaluate = vi.fn(),
): WakePolicy => {
  evaluate.mockReturnValue({ confidence: 0.9, reason: `${id}-${verdict}`, tags: [id], verdict });

  return { evaluate, id, mode, requires: [], version: 1 };
};

describe('isExplicitWake', () => {
  it.each([
    { explicitMention: true, expected: true, replyToBot: false },
    { explicitMention: false, expected: true, replyToBot: true },
    { explicitMention: false, expected: false, replyToBot: false },
  ])('mention=$explicitMention reply=$replyToBot -> $expected', ({ expected, ...state }) => {
    expect(isExplicitWake(state)).toBe(expected);
  });
});

describe('aggregateWakeVerdicts', () => {
  const cases: {
    expected: {
      decidedBy?: string;
      effectiveRecords: boolean[];
      evaluated: string[];
      verdict: WakeVerdict;
    };
    name: string;
    policies: [string, WakePolicyMode, WakeVerdict][];
  }[] = [
    {
      expected: { effectiveRecords: [], evaluated: [], verdict: 'abstain' },
      name: 'no policies abstains',
      policies: [],
    },
    {
      expected: { decidedBy: 'a', effectiveRecords: [true], evaluated: ['a'], verdict: 'allow' },
      name: 'enforce allow wins',
      policies: [['a', 'enforce', 'allow']],
    },
    {
      expected: { decidedBy: 'a', effectiveRecords: [true], evaluated: ['a'], verdict: 'deny' },
      name: 'enforce deny decides',
      policies: [['a', 'enforce', 'deny']],
    },
    {
      expected: {
        decidedBy: 'b',
        effectiveRecords: [true, true],
        evaluated: ['a', 'b'],
        verdict: 'deny',
      },
      name: 'enforce deny beats an earlier enforce allow',
      policies: [
        ['a', 'enforce', 'allow'],
        ['b', 'enforce', 'deny'],
      ],
    },
    {
      expected: { decidedBy: 'a', effectiveRecords: [true], evaluated: ['a'], verdict: 'deny' },
      name: 'enforce deny short-circuits later policies',
      policies: [
        ['a', 'enforce', 'deny'],
        ['b', 'enforce', 'allow'],
        ['c', 'shadow', 'deny'],
      ],
    },
    {
      expected: { effectiveRecords: [false], evaluated: ['a'], verdict: 'abstain' },
      name: 'shadow deny is recorded but has no effect',
      policies: [['a', 'shadow', 'deny']],
    },
    {
      expected: { effectiveRecords: [false], evaluated: ['a'], verdict: 'abstain' },
      name: 'shadow allow is recorded but has no effect',
      policies: [['a', 'shadow', 'allow']],
    },
    {
      expected: {
        decidedBy: 'b',
        effectiveRecords: [false, true],
        evaluated: ['a', 'b'],
        verdict: 'allow',
      },
      name: 'shadow deny does not short-circuit',
      policies: [
        ['a', 'shadow', 'deny'],
        ['b', 'enforce', 'allow'],
      ],
    },
    {
      expected: { effectiveRecords: [], evaluated: [], verdict: 'abstain' },
      name: 'off policies are skipped',
      policies: [['a', 'off', 'deny']],
    },
    {
      expected: { effectiveRecords: [true], evaluated: ['a'], verdict: 'abstain' },
      name: 'enforce abstain stays abstain',
      policies: [['a', 'enforce', 'abstain']],
    },
  ];

  it.each(cases)('$name', ({ expected, policies }) => {
    const spies = new Map<string, ReturnType<typeof vi.fn>>();
    const built = policies.map(([id, mode, verdict]) => {
      const spy = vi.fn();
      spies.set(id, spy);

      return policy(id, mode, verdict, spy);
    });

    const decision = aggregateWakeVerdicts(built, signal, idle);

    expect(decision.verdict).toBe(expected.verdict);
    expect(decision.decidedBy).toBe(expected.decidedBy);
    expect(decision.fastPath).toBe(false);
    expect(decision.records.map((record) => record.effective)).toEqual(expected.effectiveRecords);
    expect(decision.records.map((record) => record.policyId)).toEqual(expected.evaluated);
    for (const [id, spy] of spies) {
      expect(spy).toHaveBeenCalledTimes(expected.evaluated.includes(id) ? 1 : 0);
    }
  });

  it.each([
    { explicitMention: true, reason: 'explicit-mention', replyToBot: false },
    { explicitMention: false, reason: 'reply-to-bot', replyToBot: true },
  ])('takes the fast path without running policies ($reason)', ({ reason, ...flags }) => {
    const evaluate = vi.fn();
    const decision = aggregateWakeVerdicts([policy('a', 'enforce', 'deny', evaluate)], signal, {
      ...idle,
      ...flags,
    });

    expect(decision).toMatchObject({ fastPath: true, reason, records: [], verdict: 'allow' });
    expect(evaluate).not.toHaveBeenCalled();
  });

  it('passes only the declared state keys to a policy', () => {
    const evaluate = vi
      .fn()
      .mockReturnValue({ confidence: 1, reason: 'r', tags: [], verdict: 'abstain' });

    aggregateWakeVerdicts(
      [{ evaluate, id: 'a', mode: 'enforce', requires: ['threadSubscribed'], version: 2 }],
      signal,
      { ...idle, lastBotReplyAt: 5 },
    );

    expect(evaluate).toHaveBeenCalledWith({ signal, state: { threadSubscribed: true } });
  });

  it('records the policy version and turns a thrown policy into an abstain', () => {
    const boom: WakePolicy = {
      evaluate: () => {
        throw new Error('boom');
      },
      id: 'boom',
      mode: 'enforce',
      requires: [],
      version: 7,
    };

    const decision = aggregateWakeVerdicts([boom], signal, idle);

    expect(decision.verdict).toBe('abstain');
    expect(decision.records[0]).toMatchObject({
      policyId: 'boom',
      policyVersion: 7,
      reason: 'policy-error: boom',
      tags: ['policy-error'],
      verdict: 'abstain',
    });
  });
});
