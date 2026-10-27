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
/** The bot spoke 4m49s ago, inside the default 5 minute window. */
const spokeRecently = () => ({ botLastSpokeAt: Date.now() - 289_000, silentWakes: 0 });

const recorded = () => mockRecordSignalDecision.mock.calls.map(([, params]) => params.decision);

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

  it('keeps the matched duty for the replay of a message parked for its duties', async () => {
    const dutyJudge = vi.fn(async () => ({ duty: '评估需求', inDuty: 0.9, reason: 'p=0.9' }));
    const state = fakeState();
    const recorder = make(
      { botWake: { duties: { text: '评估需求' }, enabled: true, mode: 'enforce' } },
      state,
      { classify: classifierAnswer(0.05), dutyJudge },
    );

    await expect(recorder.initiate(parked('要是导出能保留文件夹结构就好了'))).resolves.toEqual({
      addressed: false,
      duty: '评估需求',
      reason: 'in-duty',
    });
    await expect(recorder.initiate(replay('要是导出能保留文件夹结构就好了'))).resolves.toEqual({
      addressed: false,
      duty: '评估需求',
      reason: 'in-duty',
    });
    expect(dutyJudge).toHaveBeenCalledOnce();
  });

  // Kept by a build that still had them: the replay is judged again rather than trusted.
  it.each(['classifier-confident', 'proactive-help'])(
    'judges again a replay kept for the retired %s wake',
    async (reason) => {
      const classify = classifierAnswer(0.9);
      const state = fakeState(spokeRecently());
      state.initiations.set(`${APP}:m-1`, JSON.stringify({ reason, verdicts: [] }));

      await expect(make(ENFORCE, state, { classify }).initiate(replay())).resolves.toMatchObject({
        reason: 'followup-window',
      });
      expect(classify).toHaveBeenCalledOnce();
    },
  );
});
