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

describe('bot-wake recorder: initiating a wake nobody addressed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRecordSignalDecision.mockResolvedValue({ persisted: false });
  });

  it('wakes the bot when the owner calls it by name, with no classifier call (the reported case)', async () => {
    const classify = classifierAnswer(0.02);
    const state = fakeState(spokeRecently());
    const recorder = make(WITH_CLASSIFIER('enforce'), state, { classify });

    await expect(recorder.initiate(observation())).resolves.toEqual({
      addressed: true,
      reason: 'named-in-text',
    });
    expect(classify).not.toHaveBeenCalled();
  });

  it('wakes on the name even when the bot has not spoken lately', async () => {
    const recorder = make(ENFORCE, fakeState());

    await expect(recorder.initiate(observation())).resolves.toEqual({
      addressed: true,
      reason: 'named-in-text',
    });
  });

  // Outside the window only the duties may start a wake: the classifier's "is it for me?" no
  // longer does, however sure it is.
  it('does not initiate outside the window, and does not ask the classifier there', async () => {
    const classify = classifierAnswer(0.99);
    const recorder = make(WITH_CLASSIFIER('enforce'), fakeState(), { classify });

    await expect(
      recorder.initiate(observation({}, { text: 'anyone seen the deploy logs?' })),
    ).resolves.toBeUndefined();
    expect(classify).not.toHaveBeenCalled();
  });

  it('only watches while the rules are in shadow: naming the bot changes nothing', async () => {
    const recorder = make({ botWake: { enabled: true, mode: 'shadow' } }, fakeState());

    await expect(recorder.initiate(observation())).resolves.toBeUndefined();
  });

  it('does nothing while the rollout is off', async () => {
    const state = fakeState(spokeRecently());
    const recorder = make(ENFORCE, state, { rollout: async () => false });

    await expect(recorder.initiate(observation())).resolves.toBeUndefined();
    expect(state.readChannel).not.toHaveBeenCalled();
    expect(state.readRecentMessages).not.toHaveBeenCalled();
  });

  it('does nothing when the bot has bot-wake switched off', async () => {
    const recorder = make({ botWake: { enabled: false, mode: 'enforce' } }, fakeState());

    await expect(recorder.initiate(observation())).resolves.toBeUndefined();
  });

  it.each([
    { reason: 'scope none', rules: { scope: 'none' } },
    { reason: 'channel denied', rules: { denyChannels: ['c1'] } },
  ])('an owner rule still vetoes a message that names the bot ($reason)', async ({ rules }) => {
    const state = fakeState({ ...spokeRecently(), ownerLastSpokeAt: Date.now() - 1000 });
    const recorder = make({ botWake: { enabled: true, mode: 'enforce', rules } }, state);

    await expect(
      recorder.initiate(
        observation({}, { author: { isBot: false, isMe: false, userId: 'someone-else' } }),
      ),
    ).resolves.toBeUndefined();
  });

  it('wakes when someone else names the bot while the owner is around', async () => {
    const state = fakeState({ ownerLastSpokeAt: Date.now() - 10_000, silentWakes: 0 });
    const recorder = make(
      { botWake: { enabled: true, mode: 'enforce', rules: { ownerPresenceSeconds: 120 } } },
      state,
    );

    await expect(
      recorder.initiate(
        observation({}, { author: { isBot: false, isMe: false, userId: 'someone-else' } }),
      ),
    ).resolves.toEqual({ addressed: true, reason: 'named-in-text' });
  });

  it('never wakes on its own message or another bot, even naming itself', async () => {
    const recorder = make(ENFORCE, fakeState());

    await expect(
      recorder.initiate(observation({}, { author: { isBot: false, isMe: true, userId: APP } })),
    ).resolves.toBeUndefined();
    await expect(
      recorder.initiate(
        observation({}, { author: { isBot: true, isMe: false, userId: 'other-bot' } }),
      ),
    ).resolves.toBeUndefined();
  });

  describe('a plain message inside the follow-up window', () => {
    const plain = { text: '那这个怎么处理?' };

    it('wakes when the enforcing classifier says it is for the bot', async () => {
      const recorder = make(WITH_CLASSIFIER('enforce'), fakeState(spokeRecently()), {
        classify: classifierAnswer(0.9),
      });

      await expect(recorder.initiate(observation({}, plain))).resolves.toEqual({
        addressed: false,
        reason: 'followup-window',
      });
    });

    it('stays silent when the enforcing classifier says it is not', async () => {
      const recorder = make(WITH_CLASSIFIER('enforce'), fakeState(spokeRecently()), {
        classify: classifierAnswer(0.1),
      });

      await expect(recorder.initiate(observation({}, plain))).resolves.toBeUndefined();
    });

    it('does not wake on a degraded classifier (error or budget): no answer is not a yes', async () => {
      const failing: WakeClassify = vi.fn(async () => {
        throw new Error('boom');
      });
      const recorder = make(WITH_CLASSIFIER('enforce'), fakeState(spokeRecently()), {
        classify: failing,
      });

      await expect(recorder.initiate(observation({}, plain))).resolves.toBeUndefined();
    });

    it('wakes on the window alone while the classifier only watches, and still scores it', async () => {
      const classify = classifierAnswer(0.1);
      const recorder = make(WITH_CLASSIFIER('shadow'), fakeState(spokeRecently()), { classify });

      await expect(recorder.initiate(observation({}, plain))).resolves.toEqual({
        addressed: false,
        reason: 'followup-window',
      });
      expect(classify).toHaveBeenCalledTimes(1);
    });

    it('hands the classifier who the bot is and what everyone said, including other people', async () => {
      const classify = classifierAnswer(0.9);
      const state = fakeState(spokeRecently());
      const lines: WakeConversationLine[] = [
        { at: 1, authorId: 'bob', authorName: 'bob', id: 'a', isBot: false, text: 'ship it?' },
        { at: 2, authorId: APP, authorName: BOT_NAME, id: 'b', isBot: true, text: 'Shipped.' },
        { at: 3, authorId: 'carol', authorName: 'carol', id: 'c', isBot: false, text: 'nice' },
      ];
      state.logs.set('discord:g1:c1', lines);
      const recorder = make(WITH_CLASSIFIER('enforce'), state, { classify });

      await recorder.initiate(observation({}, plain));

      const input = (classify as any).mock.calls[0][0];
      expect(input.conversation.botNames).toEqual([BOT_NAME]);
      expect(input.conversation.lastBotMessage).toBe('Shipped.');
      expect(input.conversation.recent.map((line: WakeConversationLine) => line.text)).toEqual([
        'ship it?',
        'Shipped.',
        'nice',
      ]);
    });

    it('hands the classifier the agent, the owner, and what the owner goes by on the platform', async () => {
      const classify = classifierAnswer(0.9);
      const state = fakeState(spokeRecently());
      state.logs.set('discord:g1:c1', [
        { at: 1, authorId: OWNER, authorName: 'arvin_x', id: 'a', isBot: false, text: 'ship it' },
      ]);
      const recorder = make(WITH_CLASSIFIER('enforce'), state, {
        classify,
        identity: async () => ({
          agentName: 'Arvin Agent',
          agentTitle: 'Release helper',
          ownerNames: ['Arvin Zhang'],
        }),
      });

      await recorder.initiate(observation({}, plain));

      const { conversation } = (classify as any).mock.calls[0][0];
      expect(conversation.agent).toEqual({ name: 'Arvin Agent', title: 'Release helper' });
      expect(conversation.ownerId).toBe(OWNER);
      // The LobeHub name, the name on the log's lines, and the name on the message being judged.
      expect(conversation.ownerNames).toEqual(['Arvin Zhang', 'arvin_x', 'arvin']);
    });

    it('still judges when the identity cannot be read', async () => {
      const classify = classifierAnswer(0.9);
      const recorder = make(WITH_CLASSIFIER('enforce'), fakeState(spokeRecently()), {
        classify,
        identity: async () => {
          throw new Error('db down');
        },
      });

      await expect(recorder.initiate(observation({}, plain))).resolves.toEqual({
        addressed: false,
        reason: 'followup-window',
      });
      expect((classify as any).mock.calls[0][0].conversation.agent).toBeUndefined();
    });

    it('does not read the message being judged as its own context', async () => {
      const classify = classifierAnswer(0.9);
      const state = fakeState(spokeRecently());
      state.logs.set('discord:g1:c1', [
        { at: 1, authorId: OWNER, id: 'm-now', isBot: false, text: plain.text },
      ]);
      const recorder = make(WITH_CLASSIFIER('enforce'), state, { classify });

      await recorder.initiate(observation({}, plain));

      expect((classify as any).mock.calls[0][0].conversation.recent).toEqual([]);
    });
  });

  it('follows the platform’s own name refresh: a renamed bot answers to the new name, not the old', async () => {
    const names = vi.fn(async () => ['Shadow Arvin']);
    // Not sure the old name is for it: only the name can start the wake here.
    const recorder = make(ENFORCE, fakeState(), {
      botNames: names,
      classify: classifierAnswer(0.1),
    });

    await expect(recorder.initiate(observation())).resolves.toEqual({
      addressed: true,
      reason: 'named-in-text',
    });

    // The platform client refreshed its names (the bot was renamed).
    names.mockResolvedValue(['Arvin Prime']);

    await expect(
      recorder.initiate(observation({}, { id: 'm-2', text: 'Shadow Arvin 听得到吗' })),
    ).resolves.toBeUndefined();
    await expect(
      recorder.initiate(observation({}, { id: 'm-3', text: 'Arvin Prime 听得到吗' })),
    ).resolves.toEqual({ addressed: true, reason: 'named-in-text' });
  });

  it('records the decision it made without asking the classifier a second time', async () => {
    const classify = classifierAnswer(0.9);
    const state = fakeState(spokeRecently());
    const recorder = make(WITH_CLASSIFIER('enforce'), state, { classify });
    const message = observation({}, { text: '那这个怎么处理?' });

    expect(await recorder.initiate(message)).toEqual({
      addressed: false,
      reason: 'followup-window',
    });
    recorder.record({ ...message, outcome: 'wake', reason: 'followup-window' });
    await flush();

    expect(classify).toHaveBeenCalledTimes(1);
    const [decision] = recorded();
    expect(decision).toMatchObject({ outcome: 'wake', finalReason: 'followup-window' });
    expect(decision.toTag).toBe('followup');
    expect(
      decision.verdicts.map((verdict: any) => [verdict.policyId, verdict.mode, verdict.verdict]),
    ).toContainEqual(['bot-wake:classifier', 'enforce', 'allow']);
  });

  it('records the decision for a named wake with the conversation it judged from', async () => {
    const state = fakeState(spokeRecently());
    const recorder = make(ENFORCE, state);

    expect(await recorder.initiate(observation())).toEqual({
      addressed: true,
      reason: 'named-in-text',
    });
    recorder.record({ ...observation(), outcome: 'wake', reason: 'named-in-text' });
    await flush();

    const [decision] = recorded();
    expect(decision.toTag).toBe('named');
    expect(decision.metadata.stateSnapshot.conversation.botNames).toEqual([BOT_NAME]);
  });

  it('records the enforcing rule that stopped a named wake, not a shadow replay of it', async () => {
    const recorder = make(
      { botWake: { enabled: true, mode: 'enforce', rules: { denyChannels: ['c1'] } } },
      fakeState(),
    );

    expect(await recorder.initiate(observation())).toBeUndefined();
    recorder.record(observation());
    await flush();

    const verdicts = recorded()[0].verdicts.map((verdict: any) => [
      verdict.policyId,
      verdict.mode,
      verdict.verdict,
      verdict.reason,
    ]);
    expect(verdicts).toContainEqual(['bot-wake:owner-rules', 'enforce', 'deny', 'channel-denied']);
    expect(verdicts.some(([, mode]: string[]) => mode === 'shadow')).toBe(false);
  });

  it('a message that did not wake the bot is still recorded as it was judged', async () => {
    const state = fakeState();
    const classify = classifierAnswer(0.3);
    const recorder = make(WITH_CLASSIFIER('shadow'), state, { classify });
    const message = observation({}, { text: 'anyone seen the deploy logs?' });

    expect(await recorder.initiate(message)).toBeUndefined();
    recorder.record(message);
    await flush();

    expect(recorded()[0].outcome).toBe('skip');
    expect(classify).toHaveBeenCalledTimes(1);
  });
});

describe('bot-wake recorder: watch keywords marked as the bot names', () => {
  const SOMEONE = { author: { isBot: false, isMe: false, userId: 'someone-else' } };
  const OWNER_AROUND = {
    botWake: { enabled: true, mode: 'enforce', rules: { ownerPresenceSeconds: 120 } },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRecordSignalDecision.mockResolvedValue({ persisted: false });
  });

  it('wakes as named-in-text on a keyword name, even when the platform name lookup fails', async () => {
    const recorder = make(ENFORCE, fakeState(), {
      botNames: async () => {
        throw new Error('discord down');
      },
      classify: classifierAnswer(0.1),
      nameKeywords: ['canis', '倏昱'],
    });

    await expect(recorder.initiate(observation({}, { text: 'canis 你看下这个' }))).resolves.toEqual(
      { addressed: true, reason: 'named-in-text' },
    );
    await expect(
      recorder.initiate(observation({}, { id: 'm-2', text: '倏昱在吗' })),
    ).resolves.toEqual({ addressed: true, reason: 'named-in-text' });
  });

  it('hands the classifier the keyword names beside the platform names', async () => {
    const classify = classifierAnswer(0.9);
    const recorder = make(WITH_CLASSIFIER('enforce'), fakeState(spokeRecently()), {
      classify,
      nameKeywords: ['canis'],
    });

    await recorder.initiate(observation({}, { text: 'what about the release?' }));

    const [input] = (classify as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(input.conversation.botNames).toEqual([BOT_NAME, 'canis']);
  });

  it('keeps a keyword-name wake from being vetoed by owner presence; a plain keyword still is', async () => {
    const state = fakeState({ ownerLastSpokeAt: Date.now() - 10_000, silentWakes: 0 });
    const recorder = make(OWNER_AROUND, state, { nameKeywords: ['canis'] });
    const keywordWake = (text: string) =>
      observation({ outcome: 'wake', reason: 'watch-keyword' }, { ...SOMEONE, text });

    expect(
      (await recorder.judge(keywordWake('canis, can you check the build?')))?.verdict,
    ).not.toBe('deny');
    expect(await recorder.judge(keywordWake('the mobile build is broken'))).toMatchObject({
      reason: 'owner-present',
      verdict: 'deny',
    });
  });
});

describe('bot-wake recorder: remembering what was said', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRecordSignalDecision.mockResolvedValue({ persisted: false });
  });

  it("keeps everyone's messages, not just the owner's, under the place they were said", async () => {
    const state = fakeState();
    const recorder = make(ENFORCE, state);

    await recorder.remember(
      observation(
        {},
        {
          author: { isBot: false, isMe: false, userId: 'bob', userName: 'bob' },
          id: 'b1',
          text: 'hello',
        },
      ),
    );
    await recorder.remember(observation({}, { id: 'a1', text: 'hi' }));

    expect(state.logs.get('discord:g1:c1')?.map((line) => [line.authorName, line.text])).toEqual([
      ['bob', 'hello'],
      ['arvin', 'hi'],
    ]);
  });

  it('files a thread message under the thread only', async () => {
    const state = fakeState();
    await make(ENFORCE, state).remember(observation({ threadId: 'discord:g1:c1:t9' }));

    expect([...state.logs.keys()]).toEqual(['discord:g1:c1:t9']);
  });

  it('does not log the bot to itself', async () => {
    const state = fakeState();
    await make(ENFORCE, state).remember(
      observation({}, { author: { isBot: false, isMe: true, userId: APP } }),
    );

    expect(state.rememberMessages).not.toHaveBeenCalled();
  });

  it('does not keep direct messages', async () => {
    const state = fakeState();
    await make(ENFORCE, state).remember(observation({ threadId: 'discord:@me:dm1' }));

    expect(state.rememberMessages).not.toHaveBeenCalled();
  });

  it('keeps nothing while the rollout is off or bot-wake is off', async () => {
    const off = fakeState();
    await make(ENFORCE, off, { rollout: async () => false }).remember(observation());
    const disabled = fakeState();
    await make({ botWake: { enabled: false } }, disabled).remember(observation());

    expect(off.rememberMessages).not.toHaveBeenCalled();
    expect(disabled.rememberMessages).not.toHaveBeenCalled();
  });

  it('stamps a Discord message with the time in its id so two bots store the same line', async () => {
    const state = fakeState();
    // 2026-01-01T00:00:00Z as a snowflake.
    const id = String((BigInt(Date.UTC(2026, 0, 1)) - 1_420_070_400_000n) << 22n);
    await make(ENFORCE, state).remember(observation({}, { id }));

    expect(state.logs.get('discord:g1:c1')?.[0].at).toBe(Date.UTC(2026, 0, 1));
  });

  it('never throws when Redis is down', async () => {
    const state = fakeState();
    state.rememberMessages.mockRejectedValueOnce(new Error('redis down'));

    await expect(make(ENFORCE, state).remember(observation())).resolves.toBeUndefined();
  });
});
