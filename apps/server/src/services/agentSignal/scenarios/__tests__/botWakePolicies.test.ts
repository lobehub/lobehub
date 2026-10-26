// @vitest-environment node
import { aggregateWakeVerdictsAsync } from '../botWake/aggregator';
import { parseBotWakeSettings } from '../botWake/config';
import type { WakeClassification, WakeClassify } from '../botWake/policies';
import {
  CLASSIFIER_POLICY_ID,
  createClassifierPolicy,
  createInternalRulesPolicy,
  createOwnerRulesPolicy,
  createWakePolicySet,
  INTERNAL_RULES_POLICY_ID,
  OWNER_RULES_POLICY_ID,
} from '../botWake/policies';
import type {
  WakeAuthor,
  WakeChannelState,
  WakeMentions,
  WakeRules,
  WakeSignal,
  WakeStateSnapshot,
} from '../botWake/types';

const NOW = 1_700_000_000_000;
const human: WakeAuthor = { id: 'u1', isBot: false, isMe: false, isOwner: false, isSystem: false };
const noMentions: WakeMentions = {
  botMentioned: false,
  everyone: false,
  here: false,
  otherUserIds: [],
  roleIds: [],
};

const signal = (overrides: Partial<WakeSignal> = {}): WakeSignal => ({
  author: human,
  channelKeys: { channelKey: 'discord:app:g:c1', ids: ['c1'] },
  mentions: noMentions,
  message: 'can someone explain the rollout?',
  timestamp: NOW,
  ...overrides,
});

const snapshot = (channel?: Partial<WakeChannelState>): WakeStateSnapshot => ({
  channel: channel && { silentWakes: 0, ...channel },
  explicitMention: false,
  replyToBot: false,
  threadSubscribed: true,
});

const rulesFor = (botWake: Record<string, unknown> = {}): WakeRules =>
  parseBotWakeSettings({ botWake: { enabled: true, ...botWake } }).rules;

const evaluate = (
  policy: ReturnType<typeof createInternalRulesPolicy>,
  s: WakeSignal,
  c?: Partial<WakeChannelState>,
) => policy.evaluate({ signal: s, state: snapshot(c) });

describe('internal rules policy', () => {
  const policy = createInternalRulesPolicy('enforce');

  const cases: { expected: [string, string]; name: string; signal: Partial<WakeSignal> }[] = [
    {
      expected: ['deny', 'system-message'],
      name: 'system message',
      signal: { author: { ...human, isSystem: true } },
    },
    {
      expected: ['deny', 'self-message'],
      name: 'own message',
      signal: { author: { ...human, isMe: true } },
    },
    {
      expected: ['deny', 'bot-message'],
      name: 'another bot',
      signal: { author: { ...human, isBot: true } },
    },
    {
      expected: ['deny', 'broadcast-mention'],
      name: '@everyone',
      signal: { mentions: { ...noMentions, everyone: true }, message: '@everyone ship it' },
    },
    {
      expected: ['deny', 'broadcast-mention'],
      name: '@here',
      signal: { mentions: { ...noMentions, here: true }, message: '@here ship it' },
    },
    {
      expected: ['deny', 'role-only-mention'],
      name: 'role-only mention',
      signal: { mentions: { ...noMentions, roleIds: ['r1'] }, message: '<@&r1> look' },
    },
    {
      expected: ['deny', 'mentions-someone-else'],
      name: 'followup that @s someone else',
      signal: { mentions: { ...noMentions, otherUserIds: ['u2'] }, message: '<@u2> thoughts?' },
    },
    {
      expected: ['deny', 'mentions-someone-else'],
      name: 'role ping plus a user',
      signal: { mentions: { ...noMentions, otherUserIds: ['u2'], roleIds: ['r1'] }, message: 'x' },
    },
    { expected: ['deny', 'empty-or-emoji-only'], name: 'emoji only', signal: { message: '👍👍' } },
    { expected: ['deny', 'empty-or-emoji-only'], name: 'blank', signal: { message: '  ' } },
    {
      expected: ['abstain', 'no-internal-rule-hit'],
      name: 'emoji with an attachment is not empty',
      signal: { hasAttachments: true, message: '👍' },
    },
    { expected: ['abstain', 'no-internal-rule-hit'], name: 'plain question', signal: {} },
    {
      expected: ['abstain', 'no-internal-rule-hit'],
      // The bot is @-mentioned alongside a broadcast: the broadcast does not cancel the mention.
      name: 'bot mentioned together with @everyone',
      signal: { mentions: { ...noMentions, botMentioned: true, everyone: true } },
    },
    {
      expected: ['abstain', 'no-internal-rule-hit'],
      name: 'mentions not parsed (non-Discord platform)',
      signal: { mentions: undefined },
    },
  ];

  it.each(cases)('$name -> $expected', ({ expected, signal: overrides }) => {
    const result = evaluate(policy, signal(overrides));

    expect([result.verdict, result.reason]).toEqual(expected);
  });

  it('never allows', () => {
    for (const { signal: overrides } of cases) {
      expect(evaluate(policy, signal(overrides)).verdict).not.toBe('allow');
    }
  });
});

describe('internal rules policy: naming the bot', () => {
  const policy = createInternalRulesPolicy('enforce');
  const conversation = { botNames: ['Shadow Arvin'], recent: [] };
  const run = (s: WakeSignal, names = conversation) =>
    policy.evaluate({ signal: s, state: { ...snapshot(), conversation: names } });

  it('allows a plain message that calls the bot by name', () => {
    const result = run(signal({ message: 'Shadow Arvin 听得到吗' }));

    expect([result.verdict, result.reason]).toEqual(['allow', 'named-in-text']);
    expect(result.tags).toContain('named-in-text');
  });

  it('lets an owner-written message count the same as anyone else’s', () => {
    const owner = { ...human, isOwner: true };

    expect(run(signal({ author: owner, message: 'shadow arvin, are you there?' })).verdict).toBe(
      'allow',
    );
  });

  it('still refuses what the other rules refuse, even when the bot is named', () => {
    const named = 'Shadow Arvin ';
    const cases: [Partial<WakeSignal>, string][] = [
      [{ author: { ...human, isBot: true }, message: `${named}hi` }, 'bot-message'],
      [{ author: { ...human, isMe: true }, message: `${named}hi` }, 'self-message'],
      [{ author: { ...human, isSystem: true }, message: `${named}hi` }, 'system-message'],
      [
        { mentions: { ...noMentions, otherUserIds: ['u2'] }, message: `<@u2> ${named}hi` },
        'mentions-someone-else',
      ],
      [
        { mentions: { ...noMentions, everyone: true }, message: `@everyone ${named}` },
        'broadcast-mention',
      ],
    ];

    for (const [overrides, reason] of cases) {
      expect([run(signal(overrides)).verdict, run(signal(overrides)).reason]).toEqual([
        'deny',
        reason,
      ]);
    }
  });

  it('has no opinion when nothing names the bot, or when its names are not known', () => {
    expect(run(signal({ message: 'is anyone around?' })).verdict).toBe('abstain');
    expect(run(signal({ message: 'Shadow Arvin hi' }), { botNames: [], recent: [] }).verdict).toBe(
      'abstain',
    );
    expect(
      policy.evaluate({ signal: signal({ message: 'Shadow Arvin hi' }), state: snapshot() })
        .verdict,
    ).toBe('abstain');
  });
});

describe('owner rules policy', () => {
  const run = (
    botWake: Record<string, unknown>,
    s: Partial<WakeSignal>,
    c?: Partial<WakeChannelState>,
  ) =>
    createOwnerRulesPolicy('enforce', rulesFor(botWake)).evaluate({
      signal: signal(s),
      state: snapshot(c),
    });

  const cases: {
    botWake?: Record<string, unknown>;
    channel?: Partial<WakeChannelState>;
    expected: [string, string];
    name: string;
    signal?: Partial<WakeSignal>;
  }[] = [
    { botWake: { rules: { scope: 'none' } }, expected: ['deny', 'scope-none'], name: 'scope none' },
    {
      botWake: { rules: { denyChannels: ['c1'] } },
      expected: ['deny', 'channel-denied'],
      name: 'channel on the deny list',
    },
    {
      botWake: { rules: { denyChannels: ['t1'] } },
      expected: ['deny', 'channel-denied'],
      name: 'thread on the deny list',
      signal: { channelKeys: { channelKey: 'k', ids: ['c1', 't1'], threadKey: 'k:t1' } },
    },
    {
      botWake: { rules: { allowChannels: ['c1'], denyChannels: ['c1'] } },
      expected: ['deny', 'channel-denied'],
      name: 'deny beats allow',
    },
    {
      botWake: { rules: { allowChannels: ['c2'] } },
      expected: ['deny', 'channel-not-allowed'],
      name: 'channel missing from a non-empty allow list',
    },
    {
      botWake: { rules: { allowChannels: ['c1'] } },
      expected: ['abstain', 'no-owner-rule-opinion'],
      name: 'channel on the allow list, no follow-up window',
    },
    {
      botWake: { rules: { scope: 'bot-threads' } },
      expected: ['deny', 'outside-followup-window'],
      name: 'bot-threads scope with no recent bot post',
    },
    {
      botWake: { rules: { scope: 'bot-threads' } },
      channel: { botLastSpokeAt: NOW - 400_000, followupUntil: NOW - 100_000 },
      expected: ['deny', 'outside-followup-window'],
      name: 'bot-threads scope with an expired window',
    },
    {
      botWake: { rules: { scope: 'bot-threads' } },
      channel: { botLastSpokeAt: NOW - 10_000, followupUntil: NOW + 290_000 },
      expected: ['allow', 'inside-followup-window'],
      name: 'bot-threads scope inside the window',
    },
    {
      channel: { botLastSpokeAt: NOW - 301_000 },
      expected: ['abstain', 'no-owner-rule-opinion'],
      name: 'window derived from botLastSpokeAt has lapsed',
    },
    {
      botWake: { rules: { windowSeconds: 60 } },
      channel: { botLastSpokeAt: NOW - 30_000 },
      expected: ['allow', 'inside-followup-window'],
      name: 'window derived from botLastSpokeAt is open',
    },
    {
      botWake: { rules: { maxSilentWakes: 3 } },
      channel: { silentWakes: 3 },
      expected: ['deny', 'budget-exhausted'],
      name: 'woke 3 times without speaking',
    },
    {
      botWake: { rules: { maxSilentWakes: 3 } },
      channel: { silentWakes: 2 },
      expected: ['abstain', 'no-owner-rule-opinion'],
      name: 'budget not yet spent',
    },
    {
      botWake: { rules: { maxSilentWakes: 0 } },
      channel: { silentWakes: 50 },
      expected: ['abstain', 'no-owner-rule-opinion'],
      name: 'budget 0 means unlimited',
    },
    {
      botWake: { rules: { maxSilentWakes: 3 } },
      // Speaking resets the count: the state a reset leaves behind has none left.
      channel: { botLastSpokeAt: NOW - 1000, followupUntil: NOW + 299_000, silentWakes: 0 },
      expected: ['allow', 'inside-followup-window'],
      name: 'budget reset after the bot speaks',
    },
    {
      botWake: { rules: { ownerPresenceSeconds: 120 } },
      channel: { ownerLastSpokeAt: NOW - 60_000 },
      expected: ['deny', 'owner-present'],
      name: 'owner spoke a minute ago',
    },
    {
      botWake: { rules: { ownerPresenceSeconds: 120 } },
      channel: { ownerLastSpokeAt: NOW - 200_000 },
      expected: ['abstain', 'no-owner-rule-opinion'],
      name: 'owner spoke long ago',
    },
    {
      botWake: { rules: { ownerPresenceSeconds: 120 } },
      channel: { ownerLastSpokeAt: NOW - 60_000 },
      expected: ['abstain', 'no-owner-rule-opinion'],
      name: "the owner's own message is not suppressed by their presence",
      signal: { author: { ...human, isOwner: true } },
    },
    {
      botWake: { rules: { ownerPresenceSeconds: 0 } },
      channel: { ownerLastSpokeAt: NOW - 1000 },
      expected: ['abstain', 'no-owner-rule-opinion'],
      name: 'owner presence suppression switched off',
    },
    {
      botWake: { rules: { maxSilentWakes: 1, ownerPresenceSeconds: 120 } },
      channel: { ownerLastSpokeAt: NOW - 1000, silentWakes: 5 },
      expected: ['deny', 'budget-exhausted'],
      name: 'budget is checked before owner presence',
    },
  ];

  it.each(cases)('$name -> $expected', ({ botWake, channel, expected, signal: overrides }) => {
    const result = run(botWake ?? {}, overrides ?? {}, channel);

    expect([result.verdict, result.reason]).toEqual(expected);
  });
});

describe('classifier policy', () => {
  const rules = rulesFor({
    classifier: { mode: 'enforce', threshold: 0.5 },
    customInstructions: 'billing only',
  });
  const answer = (overrides: Partial<WakeClassification> = {}): WakeClassify =>
    vi.fn(async () => ({
      addressedToBot: 0.9,
      kind: 'request',
      reason: 'asks the bot',
      ...overrides,
    }));

  const evaluateWith = (classify: WakeClassify, timeoutMs?: number) =>
    createClassifierPolicy('enforce', rules, classify, timeoutMs).evaluate({
      signal: signal(),
      state: snapshot(),
    });

  it.each([
    { expected: 'allow', kind: 'request', score: 0.9 },
    { expected: 'allow', kind: 'request', score: 0.5 },
    { expected: 'deny', kind: 'chitchat', score: 0.49 },
    { expected: 'deny', kind: 'other', score: 0 },
  ] as const)('score $score ($kind) -> $expected', async ({ expected, kind, score }) => {
    const result = await evaluateWith(answer({ addressedToBot: score, kind }));

    expect(result.verdict).toBe(expected);
    expect(result.confidence).toBe(score);
    expect(result.tags).toContain(`kind:${kind}`);
  });

  it('hands the owner instructions to the model as context', async () => {
    const classify = answer();
    await evaluateWith(classify);

    expect(classify).toHaveBeenCalledWith(
      expect.objectContaining({ customInstructions: 'billing only' }),
      expect.any(AbortSignal),
    );
  });

  it('hands the model who the bot is and what was said just before', async () => {
    const classify = answer();
    const conversation = {
      botNames: ['Shadow Arvin'],
      lastBotMessage: 'The rollout starts at noon.',
      recent: [{ at: 1, authorName: 'Bob', id: 'm0', isBot: false, text: 'is it live yet?' }],
    };

    await createClassifierPolicy('enforce', rules, classify).evaluate({
      signal: signal(),
      state: { ...snapshot(), conversation },
    });

    expect(classify).toHaveBeenCalledWith(
      expect.objectContaining({ conversation }),
      expect.any(AbortSignal),
    );
  });

  it('degrades to a pass when the model throws', async () => {
    const result = await evaluateWith(vi.fn().mockRejectedValue(new Error('provider 500')));

    expect(result).toMatchObject({ confidence: 0, verdict: 'allow' });
    expect(result.tags).toContain('degraded');
    expect(result.reason).toContain('provider 500');
  });

  it('degrades to a pass at the 2s deadline and aborts the call', async () => {
    vi.useFakeTimers();
    try {
      let aborted = false;
      const never: WakeClassify = (_input, abortSignal) =>
        new Promise<WakeClassification>(() => {
          abortSignal.addEventListener('abort', () => (aborted = true));
        });

      const pending = evaluateWith(never);
      await vi.advanceTimersByTimeAsync(1999);
      let settled = false;
      void pending.then(() => (settled = true));
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      expect(await pending).toMatchObject({ reason: 'classifier-timeout', verdict: 'allow' });
      expect(aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('in shadow it scores but never changes the aggregate decision', async () => {
    const shadow = createClassifierPolicy(
      'shadow',
      rules,
      answer({ addressedToBot: 0.05, kind: 'chitchat' }),
    );
    const decision = await aggregateWakeVerdictsAsync([shadow], signal(), snapshot());

    expect(decision.verdict).toBe('abstain');
    expect(decision.records).toHaveLength(1);
    expect(decision.records[0]).toMatchObject({
      confidence: 0.05,
      effective: false,
      mode: 'shadow',
      policyId: CLASSIFIER_POLICY_ID,
      verdict: 'deny',
    });
  });

  it('in enforce a low score denies the wake', async () => {
    const enforce = createClassifierPolicy(
      'enforce',
      rules,
      answer({ addressedToBot: 0.05, kind: 'chitchat' }),
    );

    expect((await aggregateWakeVerdictsAsync([enforce], signal(), snapshot())).verdict).toBe(
      'deny',
    );
  });
});

describe('createWakePolicySet', () => {
  const classify: WakeClassify = vi.fn();
  const ids = (settings: Record<string, unknown> | null) =>
    createWakePolicySet({ classify, settings }).map((policy) => `${policy.id}:${policy.mode}`);

  it('enforces every policy by default', () => {
    expect(ids({ botWake: { enabled: true } })).toEqual([
      `${INTERNAL_RULES_POLICY_ID}:enforce`,
      `${OWNER_RULES_POLICY_ID}:enforce`,
      `${CLASSIFIER_POLICY_ID}:enforce`,
    ]);
  });

  it('orders the costly classifier last', () => {
    const policies = createWakePolicySet({ classify, settings: { botWake: { enabled: true } } });

    expect(policies.at(-1)?.costly).toBe(true);
    expect(policies.slice(0, -1).every((policy) => !policy.costly)).toBe(true);
  });

  it('honours an operator override of the modes in a nested config', () => {
    expect(
      ids({ botWake: { classifier: { mode: 'shadow' }, enabled: true, mode: 'shadow' } }),
    ).toEqual([
      `${INTERNAL_RULES_POLICY_ID}:shadow`,
      `${OWNER_RULES_POLICY_ID}:shadow`,
      `${CLASSIFIER_POLICY_ID}:shadow`,
    ]);
  });

  it('leaves out policies switched off, and the classifier without a model call', () => {
    expect(ids({ botWake: { classifier: { mode: 'off' }, enabled: true } })).toHaveLength(2);
    expect(ids({ botWake: { enabled: true, mode: 'off' } })).toEqual([
      `${CLASSIFIER_POLICY_ID}:enforce`,
    ]);
    expect(createWakePolicySet({ settings: { botWake: { enabled: true } } })).toHaveLength(2);
  });
});

describe('policy set aggregation', () => {
  const classify = vi.fn<WakeClassify>(async () => ({
    addressedToBot: 0.1,
    kind: 'chitchat',
    reason: 'people talking',
  }));

  beforeEach(() => classify.mockClear());

  it('stops at the first rule that denies and never asks the classifier', async () => {
    const policies = createWakePolicySet({ classify, settings: { botWake: { enabled: true } } });
    const decision = await aggregateWakeVerdictsAsync(
      policies,
      signal({ author: { ...human, isBot: true } }),
      snapshot(),
    );

    expect(classify).not.toHaveBeenCalled();
    expect(decision.verdict).toBe('deny');
    expect(decision.records.map((record) => record.policyId)).toEqual([INTERNAL_RULES_POLICY_ID]);
    expect(decision.records[0]).toMatchObject({ reason: 'bot-message', verdict: 'deny' });
  });

  it('skips the costly classifier once a rule has denied, even in shadow', async () => {
    const policies = createWakePolicySet({
      classify,
      settings: { botWake: { classifier: { mode: 'shadow' }, enabled: true, mode: 'shadow' } },
    });
    const decision = await aggregateWakeVerdictsAsync(
      policies,
      signal({ author: { ...human, isBot: true } }),
      snapshot(),
    );

    expect(classify).not.toHaveBeenCalled();
    expect(decision.records.map((record) => record.policyId)).toEqual([
      INTERNAL_RULES_POLICY_ID,
      OWNER_RULES_POLICY_ID,
    ]);
  });

  it('runs the classifier when the cheap rules pass', async () => {
    const policies = createWakePolicySet({ classify, settings: { botWake: { enabled: true } } });
    const decision = await aggregateWakeVerdictsAsync(policies, signal(), snapshot());

    expect(classify).toHaveBeenCalledOnce();
    expect(decision.records.at(-1)).toMatchObject({
      policyId: CLASSIFIER_POLICY_ID,
      verdict: 'deny',
    });
  });

  it('answers an explicit mention without running a single policy', async () => {
    const policies = createWakePolicySet({ classify, settings: { botWake: { enabled: true } } });
    const decision = await aggregateWakeVerdictsAsync(policies, signal(), {
      ...snapshot(),
      explicitMention: true,
    });

    expect(decision).toMatchObject({ fastPath: true, records: [], verdict: 'allow' });
    expect(classify).not.toHaveBeenCalled();
  });
});
