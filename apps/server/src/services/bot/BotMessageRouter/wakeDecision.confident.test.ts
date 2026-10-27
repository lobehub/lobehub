// @vitest-environment node
import type { WakeClassify } from '@/server/services/agentSignal/scenarios/botWake/policies';
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
  const initiations = new Map<string, string>();

  const state = {
    countClassifierCall: vi.fn(async () => 1),
    logs,
    readChannel: vi.fn(async () => channel as never),
    readRecentMessages: vi.fn(async (key: string, limit: number, excludeId?: string) =>
      (logs.get(key) ?? []).filter((line) => line.id !== excludeId).slice(-limit),
    ),
    initiations,
    readInitiation: vi.fn(async (app: string, id: string) => initiations.get(`${app}:${id}`)),
    recordOwnerSpoke: vi.fn(async () => {}),
    rememberInitiation: vi.fn(async (app: string, id: string, value: string) => {
      initiations.set(`${app}:${id}`, value);
    }),
    rememberMessages: vi.fn(
      async (keys: readonly string[], lines: readonly WakeConversationLine[]) => {
        for (const key of keys) logs.set(key, [...(logs.get(key) ?? []), ...lines]);
      },
    ),
  } satisfies WakeStatePort & {
    initiations: Map<string, string>;
    logs: Map<string, WakeConversationLine[]>;
  };

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

const make = (
  settings: Record<string, unknown> | null,
  state: ReturnType<typeof fakeState>,
  extra: Partial<Parameters<typeof createBotWakeRecorder>[0]> = {},
) =>
  createBotWakeRecorder({
    agentId: 'agt',
    applicationId: APP,
    botNames: async () => [BOT_NAME],
    botWakeConfig: settings?.botWake as never,
    classify: classifierAnswer(0.9),
    db: {} as never,
    operatorUserId: OWNER,
    platform: 'discord',
    rollout: async () => true,
    settings,
    state,
    userId: 'u1',
    ...extra,
  });

const ENFORCE = { botWake: { enabled: true, mode: 'enforce' } };
const WITH_CLASSIFIER = (mode: string) => ({
  botWake: { classifier: { mode, threshold: 0.5 }, enabled: true, mode: 'enforce' },
});

/** The bot spoke 4m49s ago, inside the default 5 minute window. */
const spokeRecently = () => ({ botLastSpokeAt: Date.now() - 289_000, silentWakes: 0 });

const recorded = () => mockRecordSignalDecision.mock.calls.map(([, params]) => params.decision);

const WEATHER = '我想知道明天杭州天气';
const weather = (message: Record<string, unknown> = {}) =>
  observation(
    {},
    { author: { isBot: false, isMe: false, userId: 'bob' }, text: WEATHER, ...message },
  );

describe('bot-wake recorder: a confident classifier outside the follow-up window', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRecordSignalDecision.mockResolvedValue({ persisted: false });
  });

  it('wakes on a message plainly meant for it, at once like its name (the reported case)', async () => {
    const recorder = make(ENFORCE, fakeState(), { classify: classifierAnswer(0.89) });

    await expect(recorder.initiate(weather())).resolves.toEqual({
      addressed: true,
      reason: 'classifier-confident',
    });
  });

  it('starts from 0.65, a stricter bar than the 0.5 that confirms a follow-up', async () => {
    const at = (score: number) =>
      make(ENFORCE, fakeState(), { classify: classifierAnswer(score) }).initiate(weather());

    await expect(at(0.68)).resolves.toMatchObject({ reason: 'classifier-confident' });
    await expect(at(0.6)).resolves.toBeUndefined();
  });

  it('records the classifier at the bar it was held to', async () => {
    const recorder = make(ENFORCE, fakeState(), { classify: classifierAnswer(0.6) });

    await recorder.initiate(weather());
    recorder.record(weather());
    await flush();

    expect(
      recorded()[0].verdicts.map((v: any) => [v.policyId, v.mode, v.verdict, v.confidence]),
    ).toContainEqual(['bot-wake:classifier', 'enforce', 'deny', 0.6]);
  });

  it('can be turned off, and never runs while the classifier or the rules only watch', async () => {
    const classify = classifierAnswer(0.99);
    const off = { botWake: { classifier: { initiateThreshold: 0 }, enabled: true } };
    const switchedOff = { botWake: { classifier: { initiateEnabled: false }, enabled: true } };
    const classifierShadow = WITH_CLASSIFIER('shadow');
    const rulesShadow = { botWake: { enabled: true, mode: 'shadow' } };

    for (const settings of [off, switchedOff, classifierShadow, rulesShadow]) {
      await expect(
        make(settings, fakeState(), { classify }).initiate(weather()),
      ).resolves.toBeUndefined();
    }
  });

  it('keeps out where a rule says no, and on a classifier that did not answer', async () => {
    const denied = make(
      { botWake: { enabled: true, mode: 'enforce', rules: { denyChannels: ['c1'] } } },
      fakeState(),
      { classify: classifierAnswer(0.99) },
    );
    const failing = make(ENFORCE, fakeState(), {
      classify: vi.fn(async () => {
        throw new Error('boom');
      }),
    });

    await expect(denied.initiate(weather())).resolves.toBeUndefined();
    await expect(failing.initiate(weather())).resolves.toBeUndefined();
  });

  it('records who wrote the message, by id and whether it is the owner', async () => {
    const recorder = make(ENFORCE, fakeState(), { classify: classifierAnswer(0.1) });

    await recorder.initiate(weather());
    recorder.record(weather());
    await flush();

    expect(recorded()[0].metadata.stateSnapshot.author).toEqual({ id: 'bob', isOwner: false });
  });
});

describe('bot-wake recorder: the replay of a parked message', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRecordSignalDecision.mockResolvedValue({ persisted: false });
  });

  const parked = (text = '稍微看一下') => observation({}, { id: 'm-1', text });
  const replay = (text = '稍微看一下') =>
    observation({}, { id: 'm-1:replay:1793089241000:0', text });

  it('runs on the wake decided when it was parked instead of judging again (the reported case)', async () => {
    const classify = vi
      .fn<WakeClassify>()
      .mockResolvedValueOnce({ addressedToBot: 0.51, kind: 'request', reason: 'p=0.51' })
      .mockResolvedValueOnce({ addressedToBot: 0.13, kind: 'chitchat', reason: 'p=0.13' });
    const state = fakeState(spokeRecently());
    const recorder = make(ENFORCE, state, { classify });

    await expect(recorder.initiate(parked())).resolves.toMatchObject({
      reason: 'followup-window',
    });
    await expect(recorder.initiate(replay())).resolves.toMatchObject({
      reason: 'followup-window',
    });
    expect(classify).toHaveBeenCalledOnce();

    // The replay's row keeps the verdicts the decision was made on.
    recorder.record({ ...replay(), outcome: 'wake', reason: 'followup-window' });
    await flush();
    expect(
      recorded()[0].verdicts.map((v: any) => [v.policyId, v.verdict, v.confidence]),
    ).toContainEqual(['bot-wake:classifier', 'allow', 0.51]);
  });

  it('judges again when nothing was kept, or what was kept cannot be read', async () => {
    const classify = classifierAnswer(0.9);
    const state = fakeState(spokeRecently());
    state.initiations.set(`${APP}:m-1`, '{not json');

    await expect(make(ENFORCE, state, { classify }).initiate(replay())).resolves.toMatchObject({
      reason: 'followup-window',
    });
    expect(classify).toHaveBeenCalledOnce();
  });

  it('only reuses a decision for a replay, never for a new message with the same text', async () => {
    const classify = classifierAnswer(0.1);
    const state = fakeState(spokeRecently());
    state.initiations.set(
      `${APP}:m-1`,
      JSON.stringify({ reason: 'followup-window', verdicts: [] }),
    );

    await expect(make(ENFORCE, state, { classify }).initiate(parked())).resolves.toBeUndefined();
    expect(classify).toHaveBeenCalledOnce();
  });
});
