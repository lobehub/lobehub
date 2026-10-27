// @vitest-environment node
import type {
  WakeClassify,
  WakeProactiveJudge,
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

const proactiveJudge = (helpful: number): WakeProactiveJudge =>
  vi.fn(async () => ({ helpful, reason: `p=${helpful}` }));

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
    rollout: async () => true,
    settings,
    state,
    userId: 'u1',
    ...extra,
  });
};

const MUSING = '哎 这个 UI 一眼看上去还是太 vibe 了，得想想怎么refine';
const musing = (message: Record<string, unknown> = {}) =>
  observation({}, { text: MUSING, ...message });

const PROACTIVE = (mode: string, rest: Record<string, unknown> = {}) => ({
  mode: 'enforce',
  proactive: { mode, threshold: 0.7 },
  ...rest,
});

const recorded = () => mockRecordSignalDecision.mock.calls.map(([, params]) => params.decision);

describe('bot-wake recorder: offering the owner help nobody asked for', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRecordSignalDecision.mockResolvedValue({ persisted: false });
  });

  it('steps in when the owner raises something it can help with (the reported case)', async () => {
    const judge = proactiveJudge(0.85);
    const recorder = make(PROACTIVE('enforce'), fakeState(), { proactiveJudge: judge });

    await expect(recorder.initiate(musing())).resolves.toEqual({
      addressed: false,
      reason: 'proactive-help',
    });
    expect(judge).toHaveBeenCalledOnce();
    // The judge is told the owner wrote the message.
    expect(vi.mocked(judge).mock.calls[0][0].signal.author?.isOwner).toBe(true);
  });

  it('stays out when the score is under the threshold', async () => {
    const recorder = make(PROACTIVE('enforce'), fakeState(), {
      proactiveJudge: proactiveJudge(0.4),
    });

    await expect(recorder.initiate(musing())).resolves.toBeUndefined();
  });

  it('only scores in shadow, and records the score with the rules it ran after', async () => {
    const judge = proactiveJudge(0.9);
    const recorder = make(PROACTIVE('shadow'), fakeState(), { proactiveJudge: judge });

    await expect(recorder.initiate(musing())).resolves.toBeUndefined();
    recorder.record(musing());
    await flush();

    const verdicts = recorded()[0].verdicts.map((verdict: any) => [
      verdict.policyId,
      verdict.mode,
      verdict.verdict,
    ]);
    expect(verdicts).toContainEqual(['bot-wake:proactive', 'shadow', 'allow']);
    expect(verdicts).toContainEqual(['bot-wake:owner-rules', 'enforce', 'abstain']);
    expect(judge).toHaveBeenCalledOnce();
  });

  // Discord opens the reply thread between `initiate` and `record()`: the wake is recorded under
  // the new thread. The row must keep the verdict that woke the bot, not re-run the policies on
  // the new thread's empty log (a shadow classifier scored 0.88 there for a 0.45 proactive wake).
  it('records the verdict that woke it when the reply moved to a new thread', async () => {
    const judge = proactiveJudge(0.85);
    const classify = classifierAnswer(0.05);
    const recorder = make(PROACTIVE('enforce'), fakeState(), { classify, proactiveJudge: judge });

    await expect(recorder.initiate(musing())).resolves.toMatchObject({ reason: 'proactive-help' });
    const classifierCalls = vi.mocked(classify).mock.calls.length;
    recorder.record(
      observation(
        { outcome: 'wake', reason: 'proactive-help', threadId: 'discord:g1:c1:t-reply' },
        { text: MUSING },
      ),
    );
    await flush();

    const policyIds = recorded()[0].verdicts.map((verdict: any) => verdict.policyId);
    expect(policyIds).toContain('bot-wake:proactive');
    // Nothing was judged again for the row.
    expect(judge).toHaveBeenCalledOnce();
    expect(classify).toHaveBeenCalledTimes(classifierCalls);
  });

  it('works while the other rules only watch: the owner can try it on its own', async () => {
    const recorder = make(PROACTIVE('enforce', { mode: 'shadow' }), fakeState(), {
      proactiveJudge: proactiveJudge(0.9),
    });

    await expect(recorder.initiate(musing())).resolves.toEqual({
      addressed: false,
      reason: 'proactive-help',
    });
  });

  it('never asks the model while it is off, or without a judge', async () => {
    const judge = proactiveJudge(1);

    await expect(
      make(PROACTIVE('off'), fakeState(), { proactiveJudge: judge }).initiate(musing()),
    ).resolves.toBeUndefined();
    await expect(
      make(PROACTIVE('enforce'), fakeState()).initiate(musing()),
    ).resolves.toBeUndefined();
    expect(judge).not.toHaveBeenCalled();
  });

  it('only offers its owner help, never someone else', async () => {
    const judge = proactiveJudge(1);
    const recorder = make(PROACTIVE('enforce'), fakeState(), { proactiveJudge: judge });

    await expect(
      recorder.initiate(musing({ author: { isBot: false, isMe: false, userId: 'someone-else' } })),
    ).resolves.toBeUndefined();
    expect(judge).not.toHaveBeenCalled();
  });

  it('keeps out where a rule says no: a denied channel, an exhausted silent-wake budget', async () => {
    const judge = proactiveJudge(1);

    await expect(
      make(PROACTIVE('enforce', { rules: { denyChannels: ['c1'] } }), fakeState(), {
        proactiveJudge: judge,
      }).initiate(musing()),
    ).resolves.toBeUndefined();
    await expect(
      make(PROACTIVE('enforce', { rules: { maxSilentWakes: 2 } }), fakeState({ silentWakes: 2 }), {
        proactiveJudge: judge,
      }).initiate(musing()),
    ).resolves.toBeUndefined();
    expect(judge).not.toHaveBeenCalled();
  });

  it('leaves its name and the follow-up window to their own paths', async () => {
    const judge = proactiveJudge(1);
    const named = make(PROACTIVE('enforce'), fakeState(), { proactiveJudge: judge });
    // The classifier enforces by default: inside the window it is what confirms the wake.
    const inWindow = make(
      PROACTIVE('enforce'),
      fakeState({ botLastSpokeAt: Date.now() - 10_000, silentWakes: 0 }),
      { classify: classifierAnswer(0.9), proactiveJudge: judge },
    );

    await expect(named.initiate(musing({ text: `${BOT_NAME} ${MUSING}` }))).resolves.toMatchObject({
      reason: 'named-in-text',
    });
    await expect(inWindow.initiate(musing())).resolves.toMatchObject({
      reason: 'followup-window',
    });
    expect(judge).not.toHaveBeenCalled();
  });

  it('shares the hourly model budget with the classifier', async () => {
    const judge = proactiveJudge(1);
    const state = fakeState();
    state.countClassifierCall.mockResolvedValue(10_000);
    const recorder = make(PROACTIVE('enforce'), state, { proactiveJudge: judge });

    await expect(recorder.initiate(musing())).resolves.toBeUndefined();
    expect(judge).not.toHaveBeenCalled();
  });
});
