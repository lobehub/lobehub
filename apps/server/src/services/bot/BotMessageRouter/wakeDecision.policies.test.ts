// @vitest-environment node
import type { WakeClassify } from '@/server/services/agentSignal/scenarios/botWake/policies';

import { createBotWakeRecorder, type WakeStatePort } from './wakeDecision';

const mockRecordSignalDecision = vi.hoisted(() => vi.fn());
vi.mock('@/server/services/agentSignal/persistence/recordDecision', () => ({
  recordSignalDecision: mockRecordSignalDecision,
}));
vi.mock('@/server/services/redis', () => ({ redisService: { botWake: {} } }));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const fakeState = (channel: Record<string, unknown> | undefined = undefined) => {
  const state = {
    countClassifierCall: vi.fn(async () => 1),
    readChannel: vi.fn(async () => channel as never),
    recordOwnerSpoke: vi.fn(async () => {}),
  } satisfies WakeStatePort;

  return state;
};

const classify: WakeClassify = vi.fn(async () => ({
  addressedToBot: 0.2,
  kind: 'chitchat',
  reason: 'two people talking',
}));

const OWNER = 'owner-id';
const observation = (
  overrides: Record<string, unknown> = {},
  message: Record<string, unknown> = {},
) => ({
  entryPoint: 'onSubscribedMessage' as const,
  message: {
    author: { isBot: false, isMe: false, userId: 'alice-id' },
    id: 'm1',
    isMention: false,
    text: 'does anyone know how rollouts work?',
    ...message,
  },
  outcome: 'skip' as const,
  reason: 'not-addressed' as const,
  threadId: 'discord:g1:c1',
  threadSubscribed: true,
  ...overrides,
});

const make = (
  settings: Record<string, unknown> | null,
  state = fakeState(),
  extra: Partial<Parameters<typeof createBotWakeRecorder>[0]> = {},
) =>
  createBotWakeRecorder({
    agentId: 'agt',
    applicationId: 'app',
    botWakeConfig: settings?.botWake as never,
    classify,
    db: {} as never,
    operatorUserId: OWNER,
    platform: 'discord',
    settings,
    state,
    userId: 'u1',
    ...extra,
  });

const recorded = () => mockRecordSignalDecision.mock.calls.map(([, params]) => params.decision);

describe('bot-wake recorder policy set', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRecordSignalDecision.mockResolvedValue({ persisted: false });
  });

  it('does nothing at all for a bot with bot-wake switched off: no row, no state read or write, no model call', async () => {
    const state = fakeState();
    const recorder = make({ botWakeDisabled: true }, state);

    recorder.record(observation({ outcome: 'wake', reason: 'watch-keyword' }));
    await flush();

    expect(recorder.enabled).toBe(false);
    expect(await recorder.judge(observation())).toBeUndefined();
    expect(mockRecordSignalDecision).not.toHaveBeenCalled();
    expect(state.readChannel).not.toHaveBeenCalled();
    expect(state.recordOwnerSpoke).not.toHaveBeenCalled();
    expect(classify).not.toHaveBeenCalled();
  });

  it('records every policy as shadow beside the router verdict, and the router verdict is unchanged', async () => {
    make({ botWake: { enabled: true } }).record(observation());
    await flush();

    const { outcome, verdicts } = recorded()[0];
    expect(outcome).toBe('skip');
    expect(
      verdicts.map((verdict: any) => [verdict.policyId, verdict.mode, verdict.verdict]),
    ).toEqual([
      ['legacy-router', 'enforce', 'deny'],
      ['bot-wake:internal-rules', 'shadow', 'abstain'],
      ['bot-wake:owner-rules', 'shadow', 'abstain'],
      ['bot-wake:classifier', 'shadow', 'deny'],
    ]);
    expect(verdicts.at(-1)).toMatchObject({ confidence: 0.2, reason: 'two people talking' });
  });

  it('runs the same policies from the keys the settings form writes', async () => {
    make({ botWakeClassifierMode: 'shadow', botWakeDisabled: false }).record(observation());
    await flush();

    const { verdicts } = recorded()[0];
    expect(verdicts.map((verdict: any) => verdict.policyId)).toEqual([
      'legacy-router',
      'bot-wake:internal-rules',
      'bot-wake:owner-rules',
      'bot-wake:classifier',
    ]);
    expect(classify).toHaveBeenCalledTimes(1);
  });

  it('never lets the classifier veto a watch-keyword wake: a keyword exists to wake the bot unaddressed', async () => {
    const lowScore: WakeClassify = vi.fn(async () => ({
      addressedToBot: 0,
      kind: 'other',
      reason: 'not for the bot',
    }));
    const recorder = make({ botWake: { enabled: true } }, fakeState(), { classify: lowScore });

    const decision = await recorder.judge(
      observation(
        { outcome: 'wake', reason: 'watch-keyword' },
        { text: 'we have a bug in checkout' },
      ),
    );

    // The rules still judge it (they enforce by default); the classifier is not asked at all.
    expect(decision).toBeDefined();
    expect(decision!.verdict).not.toBe('deny');
    expect(lowScore).not.toHaveBeenCalled();
  });

  it('still lets an enforcing owner rule veto a watch-keyword wake', async () => {
    const recorder = make(
      { botWake: { enabled: true, rules: { denyChannels: ['c1'] } } },
      fakeState(),
      { classify },
    );

    const decision = await recorder.judge(
      observation({ outcome: 'wake', reason: 'watch-keyword', threadId: 'discord:g1:c1' }),
    );

    expect(decision).toMatchObject({ decidedBy: 'bot-wake:owner-rules', verdict: 'deny' });
  });

  it('records nothing for a bot whose form was saved with bot-wake off', async () => {
    const state = fakeState();
    make({ botWakeDisabled: true, botWakeMode: 'shadow', botWakeScope: 'all' }, state).record(
      observation(),
    );
    await flush();

    expect(mockRecordSignalDecision).not.toHaveBeenCalled();
    expect(state.readChannel).not.toHaveBeenCalled();
    expect(classify).not.toHaveBeenCalled();
  });

  it('shadow mode never turns a router wake into a skip, even when every policy denies', async () => {
    make({ botWake: { enabled: true, rules: { scope: 'none' } } }).record(
      observation({ outcome: 'wake', reason: 'watch-keyword' }, { text: '👍' }),
    );
    await flush();

    expect(recorded()[0].outcome).toBe('wake');
    expect(recorded()[0].verdicts.map((v: any) => v.verdict)).toEqual(['allow', 'deny', 'deny']);
  });

  it.each([
    {
      author: { isBot: true, isMe: false, userId: 'other-bot' },
      reason: 'bot-message',
      text: 'hi',
    },
    { author: { isBot: false, isMe: true, userId: 'app' }, reason: 'self-message', text: 'hi' },
    {
      author: { isBot: false, isMe: false, userId: 'u' },
      reason: 'broadcast-mention',
      text: '@everyone deploy',
    },
    {
      author: { isBot: false, isMe: false, userId: 'u' },
      reason: 'broadcast-mention',
      text: '@here deploy',
    },
    {
      author: { isBot: false, isMe: false, userId: 'u' },
      reason: 'role-only-mention',
      text: '<@&77> deploy',
    },
    {
      author: { isBot: false, isMe: false, userId: 'u' },
      reason: 'mentions-someone-else',
      text: '<@999> deploy?',
    },
    {
      author: { isBot: false, isMe: false, userId: 'u' },
      reason: 'empty-or-emoji-only',
      text: '🎉',
    },
  ])(
    'denies "$text" ($reason) in shadow and spends nothing on the classifier',
    async ({ author, reason, text }) => {
      make({ botWake: { enabled: true } }).record(observation({}, { author, text }));
      await flush();

      const internal = recorded()[0].verdicts.find(
        (v: any) => v.policyId === 'bot-wake:internal-rules',
      );
      expect(internal).toMatchObject({ mode: 'shadow', reason, verdict: 'deny' });
      expect(classify).not.toHaveBeenCalled();
    },
  );

  // The chat SDK's Discord adapter reports isMention=true for these when `respondToGlobalMentions`
  // or `mentionRoleIds` is configured. The policy must re-decide instead of trusting the flag.
  it.each([
    { reason: 'broadcast-mention', text: '@everyone standup', what: '@everyone' },
    { reason: 'broadcast-mention', text: '@here standup', what: '@here' },
    { reason: 'role-only-mention', text: '<@&77> review please', what: 'a role-only ping' },
  ])('rejects $what even though the adapter reported isMention=true', async ({ reason, text }) => {
    make({ botWake: { enabled: true } }, fakeState(), { applicationId: '555' }).record(
      observation({ outcome: 'wake', reason: 'explicit-mention' }, { isMention: true, text }),
    );
    await flush();

    const verdicts = recorded()[0].verdicts;
    // `isMention: true` would have taken the explicit fast path (no policy runs); the
    // re-judgement does not, so the internal rules ran and denied.
    expect(verdicts.find((v: any) => v.policyId === 'bot-wake:internal-rules')).toMatchObject({
      mode: 'shadow',
      reason,
      verdict: 'deny',
    });
    expect(classify).not.toHaveBeenCalled();
  });

  it('takes the fast path for a real @bot, running no policy', async () => {
    // Discord renders the bot as its numeric application id.
    make({ botWake: { enabled: true } }, fakeState(), { applicationId: '555' }).record(
      observation(
        { outcome: 'wake', reason: 'explicit-mention' },
        { isMention: true, text: '<@555> hi' },
      ),
    );
    await flush();

    expect(recorded()[0].verdicts).toHaveLength(1);
    expect(classify).not.toHaveBeenCalled();
  });

  it("remembers the owner's message under the channel and the thread", async () => {
    const state = fakeState();
    make({ botWake: { enabled: true } }, state).record(
      observation(
        { threadId: 'discord:g1:c1:t9' },
        { author: { isBot: false, isMe: false, userId: OWNER } },
      ),
    );
    await flush();

    expect(state.recordOwnerSpoke).toHaveBeenCalledWith(
      ['discord:app:g1:c1', 'discord:app:g1:c1:t9'],
      expect.any(Number),
    );
  });

  it('remembers who woke the bot on the conversation it will reply in, and nobody it skipped', async () => {
    const state = { ...fakeState(), recordWakeAuthor: vi.fn(async () => {}) };
    const recorder = make({ botWake: { enabled: true } }, state);

    recorder.record(
      observation(
        { outcome: 'wake', reason: 'explicit-mention', threadId: 'discord:g1:c1:t9' },
        { isMention: true, text: '<@555> hi' },
      ),
    );
    recorder.record(observation({ threadId: 'discord:g1:c1:t9' }, { id: 'm2' }));
    await flush();

    expect(state.recordWakeAuthor).toHaveBeenCalledOnce();
    expect(state.recordWakeAuthor).toHaveBeenCalledWith('discord:app:g1:c1:t9', 'alice-id');
  });

  it('feeds recorded channel state into the owner rules', async () => {
    const state = fakeState({ ownerLastSpokeAt: Date.now() - 1000, silentWakes: 0 });
    make({ botWake: { enabled: true } }, state).record(observation());
    await flush();

    const owner = recorded()[0].verdicts.find((v: any) => v.policyId === 'bot-wake:owner-rules');
    expect(owner).toMatchObject({ reason: 'owner-present', verdict: 'deny' });
    expect(state.readChannel).toHaveBeenCalledWith(['discord:app:g1:c1']);
  });

  it('degrades the classifier to a recorded pass once the hourly budget is spent', async () => {
    const state = fakeState();
    state.countClassifierCall.mockResolvedValue(301);
    make({ botWake: { enabled: true } }, state).record(observation());
    await flush();

    const verdict = recorded()[0].verdicts.at(-1);
    expect(classify).not.toHaveBeenCalled();
    expect(verdict).toMatchObject({ policyId: 'bot-wake:classifier', verdict: 'allow' });
    expect(verdict.reason).toContain('classifier-budget');
  });

  it('classifier mode off removes the model call', async () => {
    make({ botWake: { classifier: { mode: 'off' }, enabled: true } }).record(observation());
    await flush();

    expect(classify).not.toHaveBeenCalled();
    expect(recorded()[0].verdicts.map((v: any) => v.policyId)).not.toContain('bot-wake:classifier');
  });
});

describe('bot-wake recorder judge (enforcement)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is silent when an operator override has everything shadowing', async () => {
    const recorder = make({
      botWake: { classifier: { mode: 'shadow' }, enabled: true, mode: 'shadow' },
    });

    expect(await recorder.judge(observation({ outcome: 'wake' }))).toBeUndefined();
    expect(classify).not.toHaveBeenCalled();
  });

  it('is silent for a bot with bot-wake switched off', async () => {
    expect(await make({ botWakeDisabled: true }).judge(observation())).toBeUndefined();
  });

  it('denies a follow-up wake when the owner switched the rules to enforce', async () => {
    const decision = await make({
      botWake: { enabled: true, mode: 'enforce', rules: { denyChannels: ['c1'] } },
    }).judge(observation({ outcome: 'wake', reason: 'watch-keyword' }));

    expect(decision).toMatchObject({
      decidedBy: 'bot-wake:owner-rules',
      reason: 'channel-denied',
      verdict: 'deny',
    });
  });

  it('does not ask the classifier about a keyword wake, however it is set', async () => {
    const decision = await make({
      botWake: { classifier: { mode: 'enforce' }, enabled: true },
    }).judge(observation({ outcome: 'wake', reason: 'watch-keyword' }));

    expect(decision?.verdict).not.toBe('deny');
    expect(classify).not.toHaveBeenCalled();
  });

  it('fails open when the policies throw', async () => {
    const state = fakeState();
    state.readChannel.mockRejectedValue(new Error('redis down'));

    expect(
      await make({ botWake: { enabled: true, mode: 'enforce' } }, state).judge(observation()),
    ).toBeUndefined();
  });

  describe('edits', () => {
    const signals = () => mockRecordSignalDecision.mock.calls.map(([, params]) => params.signal);

    it('records the wake an edit started apart from the decision made when it was sent', async () => {
      const recorder = make({ botWake: { enabled: true } });
      recorder.record(observation());
      recorder.record(
        observation(
          { entryPoint: 'onNewMention', outcome: 'wake', reason: 'explicit-mention' },
          { metadata: { edited: true, editedAt: new Date(1_700_000_000_000) } },
        ),
      );
      await flush();

      expect(signals().map((signal) => signal.externalId)).toEqual([
        'app:discord:g1:c1:m1',
        'app:discord:g1:c1:m1:edit:1700000000000',
      ]);
      expect(signals()[0].metadata.trigger).toBeUndefined();
      expect(signals()[1].metadata.trigger).toBe('edit');
    });

    it('remembers the messages the bot answers even while the wake switch is off', async () => {
      const state = { ...fakeState(), markEditWakeEngaged: vi.fn(async () => {}) };
      const recorder = make({}, state);

      await recorder.rememberEngaged(['m1', 'm2']);

      expect(state.markEditWakeEngaged).toHaveBeenCalledWith('app', ['m1', 'm2']);
    });

    it('never throws when remembering fails', async () => {
      const state = {
        ...fakeState(),
        markEditWakeEngaged: vi.fn(async () => {
          throw new Error('redis down');
        }),
      };

      await expect(make({}, state).rememberEngaged(['m1'])).resolves.toBeUndefined();
    });
  });
});
