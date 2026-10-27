// @vitest-environment node
import { parseBotWakeSettings } from '../botWake/config';
import type { WakeProactiveJudge } from '../botWake/policies';
import { createProactivePolicy, PROACTIVE_POLICY_ID } from '../botWake/policies';
import type { WakeAuthor, WakeSignal } from '../botWake/types';

const owner: WakeAuthor = { id: 'o1', isBot: false, isMe: false, isOwner: true, isSystem: false };

const signal = (overrides: Partial<WakeSignal> = {}): WakeSignal => ({
  author: owner,
  message: '哎 这个 UI 一眼看上去还是太 vibe 了，得想想怎么refine',
  timestamp: 1_700_000_000_000,
  ...overrides,
});

const rules = (threshold = 0.7) =>
  parseBotWakeSettings({ botWake: { enabled: true, proactive: { mode: 'enforce', threshold } } })
    .rules;

const judgeScoring = (helpful: number) =>
  vi.fn<WakeProactiveJudge>(async () => ({ helpful, reason: `p=${helpful}` }));

const run = (judge: WakeProactiveJudge, s: WakeSignal = signal(), timeoutMs?: number) =>
  createProactivePolicy(rules(), judge, timeoutMs).evaluate({
    signal: s,
    state: { conversation: { botNames: ['Nasa'], recent: [] } },
  });

describe('proactive policy', () => {
  it('steps in when the owner raises something it can help with and the score clears the bar', async () => {
    const judge = judgeScoring(0.82);
    const result = await run(judge);

    expect(result).toMatchObject({ confidence: 0.82, verdict: 'allow' });
    expect(judge).toHaveBeenCalledOnce();
    expect(judge.mock.calls[0][0].conversation?.botNames).toEqual(['Nasa']);
  });

  it('stays out under the threshold', async () => {
    expect(await run(judgeScoring(0.69))).toMatchObject({ confidence: 0.69, verdict: 'deny' });
  });

  it('never asks the model about anyone but the owner', async () => {
    const judge = judgeScoring(1);
    const result = await run(judge, signal({ author: { ...owner, isOwner: false } }));

    expect([result.verdict, result.reason]).toEqual(['abstain', 'not-owner']);
    expect(judge).not.toHaveBeenCalled();
  });

  it('does not ask about a message too short to act on', async () => {
    const judge = judgeScoring(1);

    for (const message of ['嗯', '+1', '🤔', '   ']) {
      expect((await run(judge, signal({ message }))).reason).toBe('too-short');
    }
    expect(judge).not.toHaveBeenCalled();
  });

  it('abstains when the model fails or answers late: no answer is not a yes', async () => {
    const failing = vi.fn<WakeProactiveJudge>(async () => {
      throw new Error('boom');
    });
    const slow = vi.fn<WakeProactiveJudge>(
      () => new Promise((resolve) => setTimeout(() => resolve({ helpful: 1, reason: '' }), 50)),
    );

    expect(await run(failing)).toMatchObject({
      reason: 'proactive-error: boom',
      tags: ['proactive', 'degraded'],
      verdict: 'abstain',
    });
    expect(await run(slow, signal(), 5)).toMatchObject({
      reason: 'proactive-timeout',
      verdict: 'abstain',
    });
  });

  it('takes its mode from the owner settings', () => {
    const policy = createProactivePolicy(rules(), judgeScoring(1));

    expect(policy).toMatchObject({ costly: true, id: PROACTIVE_POLICY_ID, mode: 'enforce' });
  });
});
