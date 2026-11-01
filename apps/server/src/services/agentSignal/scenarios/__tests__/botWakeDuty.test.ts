// @vitest-environment node
import { BOT_WAKE_SETTING_KEYS as K, parseBotWakeSettings } from '../botWake/config';
import type { WakeDutyJudge } from '../botWake/policies';
import { createDutyPolicy, DUTY_HELPFUL_TAG, DUTY_POLICY_ID } from '../botWake/policies';
import type { WakeAuthor, WakeConversationLine, WakeSignal } from '../botWake/types';

const teammate: WakeAuthor = {
  id: 'bob',
  isBot: false,
  isMe: false,
  isOwner: false,
  isSystem: false,
};

const NOW = 1_700_000_000_000;
const DUTIES = '群里有人描述需求时评估一下，简单的给 dario 建任务；PR 提了之后通知提需求的人';

const signal = (overrides: Partial<WakeSignal> = {}): WakeSignal => ({
  author: teammate,
  message: '要是导出能保留文件夹结构就好了',
  timestamp: NOW,
  ...overrides,
});

const rules = (threshold = 0.7, duties: string | undefined = DUTIES) =>
  parseBotWakeSettings({
    [K.customInstructions]: 'Leave release chatter alone.',
    [K.duties]: duties,
    [K.dutiesThreshold]: threshold,
    [K.disabled]: false,
  }).rules;

const judgeScoring = (inDuty: number, duty = '评估需求') =>
  vi.fn<WakeDutyJudge>(async () => ({ duty, inDuty, reason: `p=${inDuty}` }));

const run = (judge: WakeDutyJudge, s: WakeSignal = signal(), timeoutMs?: number) =>
  createDutyPolicy(rules(), judge, timeoutMs).evaluate({
    signal: s,
    state: { conversation: { botNames: ['Nasa'], recent: [] } },
  });

describe('duty policy', () => {
  it('steps in when a message falls within its duties and the score clears the bar', async () => {
    const judge = judgeScoring(0.82);
    const result = await run(judge);

    expect(result).toMatchObject({
      confidence: 0.82,
      matched: '评估需求',
      reason: '[评估需求] p=0.82',
      verdict: 'allow',
    });
    expect(judge).toHaveBeenCalledOnce();
    const [input] = judge.mock.calls[0];
    expect(input.duties).toBe(DUTIES);
    // The owner's custom instructions are context for this judgement too.
    expect(input.customInstructions).toBe('Leave release chatter alone.');
    expect(input.conversation?.botNames).toEqual(['Nasa']);
  });

  it('stays out under the threshold', async () => {
    expect(await run(judgeScoring(0.69))).toMatchObject({ confidence: 0.69, verdict: 'deny' });
  });

  it('judges anyone, the owner included: the duties are not owner-only', async () => {
    const judge = judgeScoring(0.9);

    expect((await run(judge, signal({ author: { ...teammate, isOwner: true } }))).verdict).toBe(
      'allow',
    );
    expect((await run(judge)).verdict).toBe('allow');
    expect(judge).toHaveBeenCalledTimes(2);
  });

  it('defaults to 0.65 and takes the threshold from the settings', async () => {
    const at = (score: number) =>
      createDutyPolicy(
        parseBotWakeSettings({ [K.duties]: DUTIES, [K.disabled]: false }).rules,
        judgeScoring(score),
      ).evaluate({ signal: signal(), state: {} });

    expect((await at(0.65)).verdict).toBe('allow');
    expect((await at(0.64)).verdict).toBe('deny');
  });

  it('never asks the model without duties', async () => {
    const judge = judgeScoring(1);
    const result = await createDutyPolicy(rules(0.7, '   '), judge).evaluate({
      signal: signal(),
      state: {},
    });

    expect([result.verdict, result.reason]).toEqual(['abstain', 'no-duties']);
    expect(judge).not.toHaveBeenCalled();
  });

  it('stays out of a reply to someone else, but not of a reply to itself or to the author', async () => {
    const judge = judgeScoring(1);
    const reply = (replyToAuthorId: string) =>
      run(judge, signal({ applicationId: 'bot-app', replyToAuthorId }));

    expect(await reply('carol')).toMatchObject({ reason: 'reply-to-other', verdict: 'abstain' });
    expect(judge).not.toHaveBeenCalled();

    expect((await reply('bot-app')).verdict).toBe('allow');
    expect((await reply('bob')).verdict).toBe('allow');
  });

  it('stays out right after another bot spoke, but asks the model after a person', async () => {
    const judge = judgeScoring(1);
    const after = (line: Partial<WakeConversationLine>, at = NOW - 30_000) =>
      createDutyPolicy(rules(), judge).evaluate({
        signal: signal({ applicationId: 'bot-app' }),
        state: {
          conversation: {
            botNames: ['Nasa'],
            recent: [
              { at, authorId: 'carol', id: 'm0', isBot: false, text: '我先这么改', ...line },
            ],
          },
        },
      });

    // Another agent in the thread: the owner is answering it, not asking this bot.
    expect(await after({ authorId: 'other-agent', isBot: true })).toMatchObject({
      reason: 'answering-other',
      verdict: 'abstain',
    });
    expect(judge).not.toHaveBeenCalled();

    expect((await after({ authorId: 'other-agent', isBot: true }, NOW - 5 * 60_000)).verdict).toBe(
      'allow',
    );
    expect((await after({})).verdict).toBe('allow');
    expect((await after({ authorId: 'bot-app', isBot: true })).verdict).toBe('allow');
    expect(judge).toHaveBeenCalledTimes(3);
  });

  it('steps in when stepping in would help, though the message is not one of its duties', async () => {
    const judge = vi.fn<WakeDutyJudge>(async () => ({
      duty: '评估需求',
      helpful: 0.77,
      inDuty: 0.4,
      reason: 'p=0.40 helpful=0.77',
    }));

    expect(await run(judge, signal({ message: '话说我们能看到单个话题花了多少token么' }))).toEqual({
      confidence: 0.77,
      reason: 'p=0.40 helpful=0.77',
      tags: ['duty', DUTY_HELPFUL_TAG],
      verdict: 'allow',
    });
  });

  it('stays out when neither the duty nor the help clears its bar', async () => {
    const judge = vi.fn<WakeDutyJudge>(async () => ({
      helpful: 0.69,
      inDuty: 0.64,
      reason: 'p=0.64 helpful=0.69',
    }));

    expect(await run(judge)).toMatchObject({ confidence: 0.64, verdict: 'deny' });
  });

  it('keeps the duty when both clear the bar, and reads a judge without `helpful` as before', async () => {
    const both = vi.fn<WakeDutyJudge>(async () => ({
      duty: '评估需求',
      helpful: 0.9,
      inDuty: 0.8,
      reason: 'p=0.80',
    }));
    expect(await run(both)).toMatchObject({
      confidence: 0.8,
      matched: '评估需求',
      tags: ['duty'],
      verdict: 'allow',
    });

    expect((await run(judgeScoring(0.5))).verdict).toBe('deny');
  });

  it('defaults the help threshold to 0.7 and takes one from a hand-written config', async () => {
    const judge = vi.fn<WakeDutyJudge>(async () => ({ helpful: 0.6, inDuty: 0.1, reason: '' }));
    const { rules: lowered } = parseBotWakeSettings({
      botWake: { duties: { helpfulThreshold: 0.55, text: DUTIES }, enabled: true },
    });

    expect(rules().duties.helpfulThreshold).toBe(0.7);
    expect(lowered.duties.helpfulThreshold).toBe(0.55);
    const result = await createDutyPolicy(lowered, judge).evaluate({
      signal: signal(),
      state: { conversation: { botNames: ['Nasa'], recent: [] } },
    });
    expect(result.verdict).toBe('allow');
  });

  it('does not ask about a message too short to act on', async () => {
    const judge = judgeScoring(1);

    for (const message of ['嗯', '+1', '🤔', '   ']) {
      expect((await run(judge, signal({ message }))).reason).toBe('too-short');
    }
    expect(judge).not.toHaveBeenCalled();
  });

  it('abstains when the model fails or answers late: no answer is not a yes', async () => {
    const failing = vi.fn<WakeDutyJudge>(async () => {
      throw new Error('boom');
    });
    const slow = vi.fn<WakeDutyJudge>(
      () => new Promise((resolve) => setTimeout(() => resolve({ inDuty: 1, reason: '' }), 50)),
    );

    expect(await run(failing)).toMatchObject({
      reason: 'duty-error: boom',
      tags: ['duty', 'degraded'],
      verdict: 'abstain',
    });
    expect(await run(slow, signal(), 5)).toMatchObject({
      reason: 'duty-timeout',
      verdict: 'abstain',
    });
  });

  it('hands the woken agent the whole duty and names it shortened in the stored reason', async () => {
    const long =
      '当有人在群里描述一个新需求、并且说明了使用场景和期望的结果时，先判断复杂度：简单的需求直接在 LobeHub 里给 dario 建一个任务，写清楚需求原文和验收标准，然后在原消息下回复任务链接；复杂的需求先和提需求的人确认范围，再拆成多个任务分给对应的人，PR 提了之后通知提需求的人';
    const result = await run(judgeScoring(0.9, long));

    expect(result.matched).toBe(long);
    const label = result.reason.slice(1, result.reason.indexOf(']'));
    expect(label).toHaveLength(120);
    expect(label.endsWith('…')).toBe(true);
    expect(long.startsWith(label.slice(0, -1))).toBe(true);
  });

  it('keeps the reason as it is when the model named no duty', async () => {
    const judge = vi.fn<WakeDutyJudge>(async () => ({ duty: ' ', inDuty: 0.9, reason: 'p=0.9' }));
    const result = await run(judge);

    expect(result).toMatchObject({ reason: 'p=0.9', verdict: 'allow' });
    expect(result.matched).toBeUndefined();
  });

  it('is a costly, enforcing policy by default', () => {
    expect(createDutyPolicy(rules(), judgeScoring(1))).toMatchObject({
      costly: true,
      id: DUTY_POLICY_ID,
      mode: 'enforce',
      version: 3,
    });
  });
});
