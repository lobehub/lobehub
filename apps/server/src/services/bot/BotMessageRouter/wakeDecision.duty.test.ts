// @vitest-environment node
import type {
  WakeClassify,
  WakeDutyJudge,
} from '@/server/services/agentSignal/scenarios/botWake/policies';
import type { WakeConversationLine } from '@/server/services/agentSignal/scenarios/botWake/types';

import { createBotWakeRecorder, type WakeStatePort } from './wakeDecision';

const mockRecordSignalDecision = vi.hoisted(() => vi.fn());
vi.mock('@/server/services/agentSignal/persistence/recordDecision', () => ({
  recordSignalDecision: mockRecordSignalDecision,
}));
vi.mock('@/server/services/redis', () => ({ redisService: { botWake: {} } }));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const OWNER = 'owner-id';
const APP = 'app';
const BOT_NAME = 'Shadow Arvin';

/** A fake port with an in-memory conversation log keyed like Redis. */
const fakeState = (channel: Record<string, unknown> | undefined = undefined) => {
  const logs = new Map<string, WakeConversationLine[]>();

  const state = {
    countClassifierCall: vi.fn(async () => 1),
    logs,
    readChannel: vi.fn(async () => channel as never),
    readRecentMessages: vi.fn(async (key: string, limit: number, excludeId?: string) =>
      (logs.get(key) ?? []).filter((line) => line.id !== excludeId).slice(-limit),
    ),
    recordOwnerSpoke: vi.fn(async () => {}),
    rememberMessages: vi.fn(
      async (keys: readonly string[], lines: readonly WakeConversationLine[]) => {
        for (const key of keys) logs.set(key, [...(logs.get(key) ?? []), ...lines]);
      },
    ),
  } satisfies WakeStatePort & { logs: Map<string, WakeConversationLine[]> };

  return state;
};

const classifierAnswer = (addressedToBot: number): WakeClassify =>
  vi.fn(async () => ({ addressedToBot, kind: 'request', reason: `scored ${addressedToBot}` }));

const observation = (
  overrides: Record<string, unknown> = {},
  message: Record<string, unknown> = {},
) => ({
  entryPoint: 'catchAll' as const,
  message: {
    author: { isBot: false, isMe: false, userId: OWNER, userName: 'arvin' },
    id: 'm-now',
    isMention: false,
    text: `${BOT_NAME} 听得到吗`,
    ...message,
  },
  outcome: 'skip' as const,
  reason: 'not-addressed' as const,
  threadId: 'discord:g1:c1',
  ...overrides,
});

const dutyJudge = (inDuty: number, duty = '评估需求'): WakeDutyJudge =>
  vi.fn(async () => ({ duty, inDuty, reason: `p=${inDuty}` }));

const make = (
  botWake: Record<string, unknown>,
  state: ReturnType<typeof fakeState>,
  extra: Partial<Parameters<typeof createBotWakeRecorder>[0]> = {},
) => {
  const settings = { botWake: { enabled: true, ...botWake } };

  return createBotWakeRecorder({
    agentId: 'agt',
    applicationId: APP,
    botNames: async () => [BOT_NAME],
    botWakeConfig: settings.botWake as never,
    classify: classifierAnswer(0.05),
    db: {} as never,
    operatorUserId: OWNER,
    platform: 'discord',
    settings,
    state,
    userId: 'u1',
    ...extra,
  });
};

const REQUEST = '要是导出能保留文件夹结构就好了';
/** A teammate, not the owner, describing a feature they want, to nobody in particular. */
const request = (message: Record<string, unknown> = {}) =>
  observation(
    {},
    { author: { isBot: false, isMe: false, userId: 'bob' }, text: REQUEST, ...message },
  );

const DUTIES = (mode = 'enforce', rest: Record<string, unknown> = {}) => ({
  duties: { mode, text: '群里有人描述需求时评估一下，简单的给 dario 建任务', threshold: 0.7 },
  mode: 'enforce',
  ...rest,
});

const recorded = () => mockRecordSignalDecision.mock.calls.map(([, params]) => params.decision);

describe('bot-wake recorder: a message within the bot duties', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRecordSignalDecision.mockResolvedValue({ persisted: false });
  });

  it('steps in for anyone whose message falls within its duties, naming the duty', async () => {
    const judge = dutyJudge(0.85);
    const recorder = make(DUTIES(), fakeState(), { dutyJudge: judge });

    await expect(recorder.initiate(request())).resolves.toEqual({
      addressed: false,
      duty: '评估需求',
      reason: 'in-duty',
    });
    expect(judge).toHaveBeenCalledOnce();
    const [input] = vi.mocked(judge).mock.calls[0];
    expect(input.duties).toBe('群里有人描述需求时评估一下，简单的给 dario 建任务');
    expect(input.signal.author?.isOwner).toBe(false);
  });

  it('steps in to settle an open question that is not one of its duties, and says so', async () => {
    const judge: WakeDutyJudge = vi.fn(async () => ({
      duty: '评估需求',
      helpful: 0.8,
      inDuty: 0.3,
      reason: 'p=0.30 helpful=0.80',
    }));
    const recorder = make(DUTIES(), fakeState(), { dutyJudge: judge });

    // No duty is named: the agent is woken to answer, not to carry out a duty.
    await expect(
      recorder.initiate(request({ text: '话说我们能看到单个话题花了多少token么' })),
    ).resolves.toEqual({ addressed: false, helpful: true, reason: 'in-duty' });
  });

  it('stays out when the score is under the threshold', async () => {
    const recorder = make(DUTIES(), fakeState(), { dutyJudge: dutyJudge(0.4) });

    await expect(recorder.initiate(request())).resolves.toBeUndefined();
  });

  it('never asks the model without duties, while it is off, or without a judge', async () => {
    const judge = dutyJudge(1);

    await expect(
      make({ mode: 'enforce' }, fakeState(), { dutyJudge: judge }).initiate(request()),
    ).resolves.toBeUndefined();
    await expect(
      make(DUTIES('off'), fakeState(), { dutyJudge: judge }).initiate(request()),
    ).resolves.toBeUndefined();
    await expect(make(DUTIES(), fakeState()).initiate(request())).resolves.toBeUndefined();
    expect(judge).not.toHaveBeenCalled();
  });

  it('only scores in shadow, and records the score with the rules it ran after', async () => {
    const judge = dutyJudge(0.9);
    const recorder = make(DUTIES('shadow'), fakeState(), { dutyJudge: judge });

    await expect(recorder.initiate(request())).resolves.toBeUndefined();
    recorder.record(request());
    await flush();

    const verdicts = recorded()[0].verdicts.map((verdict: any) => [
      verdict.policyId,
      verdict.mode,
      verdict.verdict,
    ]);
    expect(verdicts).toContainEqual(['bot-wake:duty', 'shadow', 'allow']);
    expect(verdicts).toContainEqual(['bot-wake:owner-rules', 'enforce', 'abstain']);
    expect(judge).toHaveBeenCalledOnce();
  });

  it('records the wake with the duty in the stored reason, without judging again', async () => {
    const judge = dutyJudge(0.85);
    const classify = classifierAnswer(0.05);
    const recorder = make(DUTIES(), fakeState(), { classify, dutyJudge: judge });

    await expect(recorder.initiate(request())).resolves.toMatchObject({ reason: 'in-duty' });
    const classifierCalls = vi.mocked(classify).mock.calls.length;
    // Discord opens the reply thread between `initiate` and `record()`.
    recorder.record(
      observation(
        { outcome: 'wake', reason: 'in-duty', threadId: 'discord:g1:c1:t-reply' },
        { author: { isBot: false, isMe: false, userId: 'bob' }, text: REQUEST },
      ),
    );
    await flush();

    const [decision] = recorded();
    expect(decision).toMatchObject({ finalReason: 'in-duty', toTag: 'duty' });
    expect(
      decision.verdicts.find((verdict: any) => verdict.policyId === 'bot-wake:duty'),
    ).toMatchObject({ reason: '[评估需求] p=0.85', verdict: 'allow' });
    expect(judge).toHaveBeenCalledOnce();
    expect(classify).toHaveBeenCalledTimes(classifierCalls);
  });

  it('works while the other rules only watch: the owner can try it on its own', async () => {
    const recorder = make(DUTIES('enforce', { mode: 'shadow' }), fakeState(), {
      dutyJudge: dutyJudge(0.9),
    });

    await expect(recorder.initiate(request())).resolves.toMatchObject({ reason: 'in-duty' });
  });

  it('keeps out where a rule says no: a denied channel, an exhausted silent-wake budget', async () => {
    const judge = dutyJudge(1);

    await expect(
      make(DUTIES('enforce', { rules: { denyChannels: ['c1'] } }), fakeState(), {
        dutyJudge: judge,
      }).initiate(request()),
    ).resolves.toBeUndefined();
    await expect(
      make(DUTIES('enforce', { rules: { maxSilentWakes: 2 } }), fakeState({ silentWakes: 2 }), {
        dutyJudge: judge,
      }).initiate(request()),
    ).resolves.toBeUndefined();
    expect(judge).not.toHaveBeenCalled();
  });

  // The owner chatting in the channel kept every feature request in it from being logged.
  it('still steps in on its duties while the owner is around, and nowhere else', async () => {
    const ownerAround = () => fakeState({ ownerLastSpokeAt: Date.now() - 10_000 });
    const judge = dutyJudge(0.9);

    await expect(
      make(DUTIES(), ownerAround(), { dutyJudge: judge }).initiate(request()),
    ).resolves.toMatchObject({ reason: 'in-duty' });
    expect(judge).toHaveBeenCalledOnce();

    // Without duties, owner presence still keeps the bot out of the chatter.
    await expect(
      make({ mode: 'enforce' }, ownerAround()).initiate(request()),
    ).resolves.toBeUndefined();
    // A deny before presence (the budget) still wins over the duties.
    await expect(
      make(
        DUTIES('enforce', { rules: { maxSilentWakes: 2 } }),
        fakeState({ ownerLastSpokeAt: Date.now() - 10_000, silentWakes: 2 }),
        { dutyJudge: judge },
      ).initiate(request()),
    ).resolves.toBeUndefined();
    expect(judge).toHaveBeenCalledOnce();
  });

  it('leaves its name and a confirmed follow-up to their own paths', async () => {
    const judge = dutyJudge(1);
    const named = make(DUTIES(), fakeState(), { dutyJudge: judge });
    const inWindow = make(
      DUTIES(),
      fakeState({ botLastSpokeAt: Date.now() - 10_000, silentWakes: 0 }),
      { classify: classifierAnswer(0.9), dutyJudge: judge },
    );

    await expect(
      named.initiate(request({ text: `${BOT_NAME} ${REQUEST}` })),
    ).resolves.toMatchObject({ reason: 'named-in-text' });
    await expect(inWindow.initiate(request())).resolves.toMatchObject({
      reason: 'followup-window',
    });
    expect(judge).not.toHaveBeenCalled();
  });

  it('still steps in inside the follow-up window when the classifier says it is not for the bot', async () => {
    const judge = dutyJudge(0.9);
    const recorder = make(
      DUTIES(),
      fakeState({ botLastSpokeAt: Date.now() - 10_000, silentWakes: 0 }),
      { classify: classifierAnswer(0.1), dutyJudge: judge },
    );

    await expect(recorder.initiate(request())).resolves.toMatchObject({ reason: 'in-duty' });
  });

  it('shares the hourly model budget with the classifier', async () => {
    const judge = dutyJudge(1);
    const state = fakeState();
    state.countClassifierCall.mockResolvedValue(10_000);
    const recorder = make(DUTIES(), state, { dutyJudge: judge });

    await expect(recorder.initiate(request())).resolves.toBeUndefined();
    expect(judge).not.toHaveBeenCalled();
  });

  // The replaced paths: a message the classifier is sure is for the bot, and an owner remark it
  // could help with, no longer wake a bot without duties.
  it('no longer wakes on a confident classifier or an owner remark alone', async () => {
    const classify = classifierAnswer(0.99);
    const recorder = make({ mode: 'enforce' }, fakeState(), { classify });

    await expect(
      recorder.initiate(observation({}, { text: '我想知道明天杭州天气' })),
    ).resolves.toBeUndefined();
    await expect(
      recorder.initiate(observation({}, { text: '哎 这个 UI 还是太 vibe 了，得想想怎么refine' })),
    ).resolves.toBeUndefined();
    expect(classify).not.toHaveBeenCalled();
  });
});
