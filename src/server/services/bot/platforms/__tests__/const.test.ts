import { describe, expect, it } from 'vitest';

import {
  allowFromField,
  extractDmSettings,
  extractGroupSettings,
  extractUserAllowlist,
  extractWatchKeywordEntries,
  extractWatchKeywords,
  findMatchingWatchKeywordEntries,
  getBotReplyLocale,
  getStepReactionEmoji,
  makeDmPolicyField,
  makeGroupPolicyFields,
  messageMatchesWatchKeyword,
  normalizeAllowFromEntries,
  normalizeBotReplyLocale,
  shouldAllowSender,
  shouldHandleDm,
  shouldHandleGroup,
  THINKING_REACTION_EMOJI,
  validateAccessSettings,
  WORKING_REACTION_EMOJI,
} from '../const';

describe('normalizeBotReplyLocale', () => {
  it('returns undefined for empty / nullish input so callers fall back', () => {
    expect(normalizeBotReplyLocale(undefined)).toBeUndefined();
    expect(normalizeBotReplyLocale(null)).toBeUndefined();
    expect(normalizeBotReplyLocale('')).toBeUndefined();
  });

  it('normalizes Telegram-style lowercase to project Locales', () => {
    expect(normalizeBotReplyLocale('pt-br')).toBe('pt-BR');
    expect(normalizeBotReplyLocale('zh-cn')).toBe('zh-CN');
    expect(normalizeBotReplyLocale('en')).toBe('en-US');
  });

  it('normalizes Feishu-style underscore to project Locales', () => {
    expect(normalizeBotReplyLocale('zh_CN')).toBe('zh-CN');
    expect(normalizeBotReplyLocale('en_US')).toBe('en-US');
  });

  it('passes through Discord/Slack-style mixed case unchanged', () => {
    expect(normalizeBotReplyLocale('en-US')).toBe('en-US');
    expect(normalizeBotReplyLocale('zh-CN')).toBe('zh-CN');
  });

  it('falls back to en-US when the input is not a project locale', () => {
    expect(normalizeBotReplyLocale('xx-yy')).toBe('en-US');
  });

  it('maps Chinese script subtags to the matching regional locale', () => {
    // Telegram emits these lowercase shapes for Chinese users — without
    // explicit script handling they fall through to en-US.
    expect(normalizeBotReplyLocale('zh-hans')).toBe('zh-CN');
    expect(normalizeBotReplyLocale('zh-hant')).toBe('zh-TW');
    expect(normalizeBotReplyLocale('zh-Hans-CN')).toBe('zh-CN');
    expect(normalizeBotReplyLocale('zh-Hant-TW')).toBe('zh-TW');
    expect(normalizeBotReplyLocale('zh_Hant_HK')).toBe('zh-TW');
  });
});

describe('getBotReplyLocale', () => {
  it('returns zh-CN for Chinese-first platforms', () => {
    expect(getBotReplyLocale('feishu')).toBe('zh-CN');
    expect(getBotReplyLocale('qq')).toBe('zh-CN');
    expect(getBotReplyLocale('wechat')).toBe('zh-CN');
  });

  it('returns en-US for English-first platforms', () => {
    expect(getBotReplyLocale('discord')).toBe('en-US');
    expect(getBotReplyLocale('slack')).toBe('en-US');
    expect(getBotReplyLocale('telegram')).toBe('en-US');
    expect(getBotReplyLocale('lark')).toBe('en-US');
  });

  it('falls back to en-US for unknown or missing platforms', () => {
    expect(getBotReplyLocale(undefined)).toBe('en-US');
    expect(getBotReplyLocale('mystery-platform')).toBe('en-US');
  });
});

describe('getStepReactionEmoji', () => {
  it('returns working emoji after call_llm that queued pending tool calls (tools about to run)', () => {
    expect(getStepReactionEmoji('call_llm', [{ name: 'search' }])).toBe(WORKING_REACTION_EMOJI);
  });

  it('returns thinking emoji after call_llm with no tools (terminal LLM / about to finish)', () => {
    expect(getStepReactionEmoji('call_llm', [])).toBe(THINKING_REACTION_EMOJI);
    expect(getStepReactionEmoji('call_llm', undefined)).toBe(THINKING_REACTION_EMOJI);
  });

  it('returns thinking emoji after call_tool (LLM about to resume with tool results)', () => {
    expect(getStepReactionEmoji('call_tool', [{ name: 'search' }])).toBe(THINKING_REACTION_EMOJI);
    expect(getStepReactionEmoji('call_tool', [])).toBe(THINKING_REACTION_EMOJI);
  });

  it('returns thinking emoji when step type is missing', () => {
    expect(getStepReactionEmoji(undefined, undefined)).toBe(THINKING_REACTION_EMOJI);
  });
});

describe('makeDmPolicyField', () => {
  it('produces a flat dmPolicy field with the supplied default policy and four modes', () => {
    const field = makeDmPolicyField({ policy: 'open' });

    expect(field.key).toBe('dmPolicy');
    expect(field.type).toBe('string');
    expect(field.default).toBe('open');
    expect(field.enum).toEqual(['open', 'allowlist', 'pairing', 'disabled']);
    // Label keys must be in 1:1 order with `enum` so the form renders the
    // right text for each option — easy regression to introduce when adding
    // a fourth policy.
    expect(field.enumLabels).toEqual([
      'channel.dmPolicyOpen',
      'channel.dmPolicyAllowlist',
      'channel.dmPolicyPairing',
      'channel.dmPolicyDisabled',
    ]);
    // Per-option descriptions render to the right of each option in the
    // dropdown — must stay 1:1 with `enum`/`enumLabels` for the same reason.
    expect(field.enumDescriptions).toEqual([
      'channel.dmPolicyOpenHint',
      'channel.dmPolicyAllowlistHint',
      'channel.dmPolicyPairingHint',
      'channel.dmPolicyDisabledHint',
    ]);
  });

  it('supports the per-platform default override (e.g. opt-in disabled)', () => {
    const field = makeDmPolicyField({ policy: 'disabled' });
    expect(field.default).toBe('disabled');
  });
});

describe('allowFromField', () => {
  it('is an object list (id + optional name) so operators can label entries', () => {
    expect(allowFromField.key).toBe('allowFrom');
    expect(allowFromField.type).toBe('array');
    // Default is an empty array — empty means "no user-level filter".
    expect(allowFromField.default).toEqual([]);
    // Always visible — applies globally to DM and group, no visibleWhen gate.
    expect(allowFromField.visibleWhen).toBeUndefined();

    expect(allowFromField.items?.type).toBe('object');
    const props = allowFromField.items?.properties ?? [];
    const keys = props.map((p) => p.key);
    expect(keys).toEqual(['id', 'name']);
    // Only `id` is required — `name` is just a reminder for the operator.
    expect(props.find((p) => p.key === 'id')?.required).toBe(true);
    expect(props.find((p) => p.key === 'name')?.required).toBeFalsy();
  });
});

describe('makeGroupPolicyFields', () => {
  it('produces a [groupPolicy, groupAllowFrom] pair with the supplied default', () => {
    const fields = makeGroupPolicyFields({ policy: 'open' });
    expect(fields).toHaveLength(2);

    const [policy, allowFrom] = fields;
    expect(policy.key).toBe('groupPolicy');
    expect(policy.default).toBe('open');
    expect(policy.enum).toEqual(['open', 'allowlist', 'disabled']);

    expect(allowFrom.key).toBe('groupAllowFrom');
    expect(allowFrom.type).toBe('array');
    expect(allowFrom.default).toEqual([]);
    expect(allowFrom.items?.type).toBe('object');
    expect((allowFrom.items?.properties ?? []).map((p) => p.key)).toEqual(['id', 'name']);
    expect(allowFrom.visibleWhen).toEqual({ field: 'groupPolicy', value: 'allowlist' });
  });
});

describe('extractDmSettings', () => {
  it('defaults to open when dmPolicy is missing or invalid', () => {
    // In production `mergeWithDefaults` always injects `dmPolicy` from the
    // platform schema, so this branch is only a safety net for malformed
    // settings — we land on the most permissive valid policy.
    expect(extractDmSettings(undefined)).toEqual({ policy: 'open' });
    expect(extractDmSettings({})).toEqual({ policy: 'open' });
    expect(extractDmSettings({ dmPolicy: 'mystery' })).toEqual({ policy: 'open' });
  });

  it('reads the flat dmPolicy field (not legacy nested settings.dm.policy)', () => {
    expect(extractDmSettings({ dmPolicy: 'disabled' })).toEqual({ policy: 'disabled' });
    expect(extractDmSettings({ dmPolicy: 'allowlist' })).toEqual({ policy: 'allowlist' });
    expect(extractDmSettings({ dmPolicy: 'pairing' })).toEqual({ policy: 'pairing' });
    // Regression: the original bug stored disabled at `settings.dm.policy` but
    // never read it back. The new shape is flat; nested `dm.policy` is ignored.
    expect(extractDmSettings({ dm: { policy: 'disabled' } })).toEqual({ policy: 'open' });
  });
});

describe('extractUserAllowlist', () => {
  it('returns an empty list when allowFrom is missing or empty', () => {
    expect(extractUserAllowlist(undefined)).toEqual({ ids: [] });
    expect(extractUserAllowlist({})).toEqual({ ids: [] });
    expect(extractUserAllowlist({ allowFrom: '' })).toEqual({ ids: [] });
    expect(extractUserAllowlist({ allowFrom: [] })).toEqual({ ids: [] });
  });

  it('reads the new object-list shape, dropping name from the runtime view', () => {
    expect(
      extractUserAllowlist({
        allowFrom: [
          { id: 'alice', name: 'Alice — PM' },
          { id: 'bob', name: 'Bob' },
        ],
      }),
    ).toEqual({ ids: ['alice', 'bob'] });
  });

  it('tolerates entries without a name (name is optional)', () => {
    expect(extractUserAllowlist({ allowFrom: [{ id: 'alice' }, { id: 'bob' }] })).toEqual({
      ids: ['alice', 'bob'],
    });
  });

  it('drops object entries with empty / missing id (require id, fail closed)', () => {
    expect(
      extractUserAllowlist({
        allowFrom: [{ id: '   ' }, { id: 'bob' }, { name: 'no-id' } as { id?: string }],
      }),
    ).toEqual({ ids: ['bob'] });
  });

  it('still parses the legacy comma / whitespace string (back-compat for stored data)', () => {
    expect(extractUserAllowlist({ allowFrom: '  alice, bob\n  carol  ' })).toEqual({
      ids: ['alice', 'bob', 'carol'],
    });
  });

  it('still parses the legacy bare string[] form', () => {
    expect(extractUserAllowlist({ allowFrom: ['alice', ' bob ', ''] })).toEqual({
      ids: ['alice', 'bob'],
    });
  });

  it('handles a mixed legacy/new array (string and object entries together)', () => {
    expect(
      extractUserAllowlist({ allowFrom: ['alice', { id: 'bob', name: 'Bob' }, '  '] }),
    ).toEqual({ ids: ['alice', 'bob'] });
  });

  it('does NOT inject userId when allowFrom is empty (preserves no-filter semantics)', () => {
    // Critical: setting only `userId` (the AI-tools field) must not
    // implicitly turn the bot into a private one. Existing operators who
    // pre-date allowFrom rely on that.
    expect(extractUserAllowlist({ userId: 'alice' })).toEqual({ ids: [] });
    expect(extractUserAllowlist({ allowFrom: [], userId: 'alice' })).toEqual({ ids: [] });
  });

  it('implicitly merges userId into a populated allowFrom (anti-lockout, object-list shape)', () => {
    expect(
      extractUserAllowlist({
        allowFrom: [
          { id: 'bob', name: 'Bob' },
          { id: 'carol', name: 'Carol' },
        ],
        userId: 'alice',
      }),
    ).toEqual({ ids: ['bob', 'carol', 'alice'] });
  });

  it('does not duplicate userId when it is already in the object-list allowFrom', () => {
    expect(
      extractUserAllowlist({
        allowFrom: [{ id: 'alice', name: 'me' }, { id: 'bob' }],
        userId: 'alice',
      }),
    ).toEqual({ ids: ['alice', 'bob'] });
  });

  it('ignores a blank userId string', () => {
    expect(extractUserAllowlist({ allowFrom: [{ id: 'bob' }], userId: '   ' })).toEqual({
      ids: ['bob'],
    });
  });
});

describe('extractGroupSettings', () => {
  it('defaults to open when groupPolicy is missing or invalid', () => {
    expect(extractGroupSettings(undefined)).toEqual({ allowFrom: [], policy: 'open' });
    expect(extractGroupSettings({})).toEqual({ allowFrom: [], policy: 'open' });
    expect(extractGroupSettings({ groupPolicy: 'mystery' })).toEqual({
      allowFrom: [],
      policy: 'open',
    });
  });

  it('reads the new object-list shape, returning ids only', () => {
    expect(
      extractGroupSettings({
        groupAllowFrom: [
          { id: 'channel-1', name: '#ops' },
          { id: 'channel-2', name: '#friends' },
        ],
        groupPolicy: 'allowlist',
      }),
    ).toEqual({
      allowFrom: ['channel-1', 'channel-2'],
      policy: 'allowlist',
    });
  });

  it('still parses the legacy comma / whitespace string (back-compat)', () => {
    expect(
      extractGroupSettings({
        groupAllowFrom: 'channel-1, channel-2\n  channel-3',
        groupPolicy: 'allowlist',
      }),
    ).toEqual({
      allowFrom: ['channel-1', 'channel-2', 'channel-3'],
      policy: 'allowlist',
    });
  });
});

describe('shouldAllowSender (global user allowlist)', () => {
  const empty = { ids: [] as string[] };
  const aliceAndBob = { ids: ['alice-id', 'bob-id'] };

  it('passes any sender when the allowlist is empty (no global filter)', () => {
    expect(shouldAllowSender({ authorUserId: 'anyone', userAllowlist: empty })).toBe(true);
    expect(shouldAllowSender({ authorUserId: undefined, userAllowlist: empty })).toBe(true);
  });

  it('passes senders in the populated allowlist', () => {
    expect(shouldAllowSender({ authorUserId: 'alice-id', userAllowlist: aliceAndBob })).toBe(true);
  });

  it('blocks senders outside the populated allowlist', () => {
    expect(shouldAllowSender({ authorUserId: 'carol-id', userAllowlist: aliceAndBob })).toBe(false);
  });

  it('fails closed for a missing user id when the allowlist is populated', () => {
    expect(shouldAllowSender({ authorUserId: undefined, userAllowlist: aliceAndBob })).toBe(false);
  });
});

describe('shouldHandleDm', () => {
  const open = { policy: 'open' as const };
  const disabled = { policy: 'disabled' as const };
  const allowlist = { policy: 'allowlist' as const };
  const pairing = { policy: 'pairing' as const };
  const emptyUserAllowlist = { ids: [] as string[] };
  const aliceAndBob = { ids: ['alice-id', 'bob-id'] };

  it('lets non-DM threads pass unconditionally', () => {
    expect(
      shouldHandleDm({
        authorUserId: undefined,
        dmSettings: disabled,
        isDM: false,
        userAllowlist: emptyUserAllowlist,
      }),
    ).toBe('allow');
  });

  it('rejects DMs when disabled', () => {
    expect(
      shouldHandleDm({
        authorUserId: 'alice-id',
        dmSettings: disabled,
        isDM: true,
        userAllowlist: aliceAndBob,
      }),
    ).toBe('reject');
  });

  it('allows DMs under the open policy regardless of allowlist contents', () => {
    expect(
      shouldHandleDm({
        authorUserId: 'anyone',
        dmSettings: open,
        isDM: true,
        userAllowlist: emptyUserAllowlist,
      }),
    ).toBe('allow');
    // The global gate (shouldAllowSender) is the runtime filter for `open`;
    // shouldHandleDm itself does not re-check it.
    expect(
      shouldHandleDm({
        authorUserId: 'anyone',
        dmSettings: open,
        isDM: true,
        userAllowlist: aliceAndBob,
      }),
    ).toBe('allow');
  });

  it('allows DMs in allowlist mode when the sender is on the list', () => {
    expect(
      shouldHandleDm({
        authorUserId: 'alice-id',
        dmSettings: allowlist,
        isDM: true,
        userAllowlist: aliceAndBob,
      }),
    ).toBe('allow');
  });

  it('rejects DMs in allowlist mode when the sender is NOT on the list', () => {
    expect(
      shouldHandleDm({
        authorUserId: 'carol-id',
        dmSettings: allowlist,
        isDM: true,
        userAllowlist: aliceAndBob,
      }),
    ).toBe('reject');
  });

  it('rejects in allowlist mode when allowFrom is empty (no DMs)', () => {
    // This is the only behavioural difference from `open`: `open` would
    // pass anyone here, `allowlist` rejects everyone.
    expect(
      shouldHandleDm({
        authorUserId: 'alice-id',
        dmSettings: allowlist,
        isDM: true,
        userAllowlist: emptyUserAllowlist,
      }),
    ).toBe('reject');
  });

  it('rejects when the allowlisted policy sees a missing user id', () => {
    expect(
      shouldHandleDm({
        authorUserId: undefined,
        dmSettings: allowlist,
        isDM: true,
        userAllowlist: aliceAndBob,
      }),
    ).toBe('reject');
  });

  it('pairs an unknown sender under pairing policy (so the router can issue a code)', () => {
    expect(
      shouldHandleDm({
        authorUserId: 'stranger-id',
        dmSettings: pairing,
        isDM: true,
        operatorUserId: 'owner-id',
        userAllowlist: aliceAndBob,
      }),
    ).toBe('pair');
  });

  it('pairs unknown senders even when allowFrom is empty (pre-approval starting state)', () => {
    expect(
      shouldHandleDm({
        authorUserId: 'stranger-id',
        dmSettings: pairing,
        isDM: true,
        operatorUserId: 'owner-id',
        userAllowlist: emptyUserAllowlist,
      }),
    ).toBe('pair');
  });

  it('allows the operator under pairing even when allowFrom is empty (owner self-DM)', () => {
    // Without the operator bypass, the owner's first DM to their own
    // pairing bot would land in `pair` and ask them to approve themselves.
    expect(
      shouldHandleDm({
        authorUserId: 'owner-id',
        dmSettings: pairing,
        isDM: true,
        operatorUserId: 'owner-id',
        userAllowlist: emptyUserAllowlist,
      }),
    ).toBe('allow');
  });

  it('allows pairing senders already on the approved list', () => {
    expect(
      shouldHandleDm({
        authorUserId: 'alice-id',
        dmSettings: pairing,
        isDM: true,
        operatorUserId: 'owner-id',
        userAllowlist: aliceAndBob,
      }),
    ).toBe('allow');
  });

  it('rejects pairing when authorUserId is missing — cannot issue a code without a target', () => {
    expect(
      shouldHandleDm({
        authorUserId: undefined,
        dmSettings: pairing,
        isDM: true,
        operatorUserId: 'owner-id',
        userAllowlist: emptyUserAllowlist,
      }),
    ).toBe('reject');
  });
});

describe('shouldHandleGroup', () => {
  const open = { allowFrom: [] as string[], policy: 'open' as const };
  const disabled = { allowFrom: [] as string[], policy: 'disabled' as const };
  const allowlist = { allowFrom: ['channel-1', 'channel-2'], policy: 'allowlist' as const };

  it('lets DM threads pass unconditionally', () => {
    expect(
      shouldHandleGroup({ candidateChannelIds: [], groupSettings: disabled, isDM: true }),
    ).toBe(true);
  });

  it('blocks group traffic when disabled', () => {
    expect(
      shouldHandleGroup({
        candidateChannelIds: ['channel-1'],
        groupSettings: disabled,
        isDM: false,
      }),
    ).toBe(false);
  });

  it('allows group traffic under the open policy', () => {
    expect(
      shouldHandleGroup({
        candidateChannelIds: ['any-channel'],
        groupSettings: open,
        isDM: false,
      }),
    ).toBe(true);
  });

  it('allows group traffic from channels in the allowlist', () => {
    expect(
      shouldHandleGroup({
        candidateChannelIds: ['channel-1'],
        groupSettings: allowlist,
        isDM: false,
      }),
    ).toBe(true);
  });

  it('rejects group traffic from channels outside the allowlist', () => {
    expect(
      shouldHandleGroup({
        candidateChannelIds: ['channel-9'],
        groupSettings: allowlist,
        isDM: false,
      }),
    ).toBe(false);
  });

  it('fails closed when the allowlisted policy sees no channel ids', () => {
    expect(
      shouldHandleGroup({ candidateChannelIds: [], groupSettings: allowlist, isDM: false }),
    ).toBe(false);
    expect(
      shouldHandleGroup({
        candidateChannelIds: [undefined, undefined],
        groupSettings: allowlist,
        isDM: false,
      }),
    ).toBe(false);
  });

  it('passes when ANY candidate is in the allowlist (Discord auto-thread + parent)', () => {
    // Real-world scenario: operator pastes the *parent* channel ID
    // (`channel-1`); Discord routes the inbound mention through an
    // auto-created reply thread whose ID is `auto-thread-id`. The router
    // hands both candidates over — only the parent matches, but that is
    // enough to let the message through.
    expect(
      shouldHandleGroup({
        candidateChannelIds: ['auto-thread-id', 'channel-1'],
        groupSettings: allowlist,
        isDM: false,
      }),
    ).toBe(true);
  });

  it('rejects when none of the candidates is in the allowlist', () => {
    expect(
      shouldHandleGroup({
        candidateChannelIds: ['auto-thread-id', 'unrelated-parent'],
        groupSettings: allowlist,
        isDM: false,
      }),
    ).toBe(false);
  });
});

describe('normalizeAllowFromEntries', () => {
  it('returns an empty list for missing / empty input', () => {
    expect(normalizeAllowFromEntries(undefined)).toEqual([]);
    expect(normalizeAllowFromEntries(null)).toEqual([]);
    expect(normalizeAllowFromEntries('')).toEqual([]);
    expect(normalizeAllowFromEntries([])).toEqual([]);
  });

  it('preserves both id and name on the current object-list shape', () => {
    expect(normalizeAllowFromEntries([{ id: 'alice', name: 'Alice' }, { id: 'bob' }])).toEqual([
      { id: 'alice', name: 'Alice' },
      { id: 'bob' },
    ]);
  });

  it('drops blank names while keeping the id (no point persisting whitespace)', () => {
    expect(normalizeAllowFromEntries([{ id: 'alice', name: '   ' }])).toEqual([{ id: 'alice' }]);
  });

  it('lifts legacy string[] entries to nameless objects', () => {
    expect(normalizeAllowFromEntries(['alice', '  bob  ', ''])).toEqual([
      { id: 'alice' },
      { id: 'bob' },
    ]);
  });

  it('lifts legacy comma / whitespace-separated strings the same way', () => {
    expect(normalizeAllowFromEntries('alice, bob\ncarol')).toEqual([
      { id: 'alice' },
      { id: 'bob' },
      { id: 'carol' },
    ]);
  });

  it('skips object entries without a usable id', () => {
    expect(
      normalizeAllowFromEntries([
        { id: '', name: 'no-id' },
        { name: 'no-id-field' } as { id?: string },
        { id: 'kept' },
      ]),
    ).toEqual([{ id: 'kept' }]);
  });
});

describe('validateAccessSettings', () => {
  it('passes when no policy needs cross-field invariants', () => {
    expect(validateAccessSettings(undefined).valid).toBe(true);
    expect(validateAccessSettings({}).valid).toBe(true);
    expect(validateAccessSettings({ dmPolicy: 'open' }).valid).toBe(true);
    expect(validateAccessSettings({ dmPolicy: 'allowlist' }).valid).toBe(true);
    expect(validateAccessSettings({ dmPolicy: 'disabled' }).valid).toBe(true);
  });

  it('passes pairing when the operator (settings.userId) is set', () => {
    expect(validateAccessSettings({ dmPolicy: 'pairing', userId: 'owner-id' }).valid).toBe(true);
  });

  it('rejects pairing without a userId — owner is the approver, missing it bricks the flow', () => {
    const result = validateAccessSettings({ dmPolicy: 'pairing' });
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([
      {
        field: 'userId',
        message: expect.stringContaining('Pairing policy'),
      },
    ]);
  });

  it('treats a blank-string userId the same as missing (whitespace is not an owner)', () => {
    expect(validateAccessSettings({ dmPolicy: 'pairing', userId: '   ' }).valid).toBe(false);
  });

  it('does not require userId for allowlist or disabled — they have no approval flow', () => {
    expect(validateAccessSettings({ dmPolicy: 'allowlist' }).valid).toBe(true);
    expect(validateAccessSettings({ dmPolicy: 'disabled' }).valid).toBe(true);
  });
});

describe('extractWatchKeywords', () => {
  it('returns [] for missing / null / non-string / non-array values', () => {
    expect(extractWatchKeywords(null)).toEqual([]);
    expect(extractWatchKeywords(undefined)).toEqual([]);
    expect(extractWatchKeywords({})).toEqual([]);
    expect(extractWatchKeywords({ watchKeywords: 42 })).toEqual([]);
    expect(extractWatchKeywords({ watchKeywords: {} })).toEqual([]);
  });

  it('parses the canonical [{keyword, instruction?}] form, dropping empties', () => {
    expect(
      extractWatchKeywords({
        watchKeywords: [
          { instruction: 'scan the thread', keyword: 'bug' },
          { keyword: '  Outage  ' },
          { keyword: '' },
          { keyword: '   ' },
          { instruction: 'no keyword' },
        ],
      }),
    ).toEqual(['bug', 'outage']);
  });

  it('accepts a flat string[] for forward compat', () => {
    expect(extractWatchKeywords({ watchKeywords: ['Bug', '', 'BUY', 'bug'] })).toEqual([
      'bug',
      'buy',
    ]);
  });

  it('accepts a comma / newline / whitespace-separated string', () => {
    expect(extractWatchKeywords({ watchKeywords: 'bug, buy\noutage  alert,,, alert' })).toEqual([
      'bug',
      'buy',
      'outage',
      'alert',
    ]);
  });

  it('lowercases and deduplicates so matching is case-insensitive at run time', () => {
    expect(
      extractWatchKeywords({
        watchKeywords: [{ keyword: 'Bug' }, { keyword: 'BUG' }, { keyword: 'bug' }],
      }),
    ).toEqual(['bug']);
  });
});

describe('messageMatchesWatchKeyword', () => {
  it('returns false when text or keywords are empty', () => {
    expect(messageMatchesWatchKeyword('', ['bug'])).toBe(false);
    expect(messageMatchesWatchKeyword(undefined, ['bug'])).toBe(false);
    expect(messageMatchesWatchKeyword('bug everywhere', [])).toBe(false);
  });

  it('matches case-insensitively', () => {
    expect(messageMatchesWatchKeyword('There is a BUG here', ['bug'])).toBe(true);
    expect(messageMatchesWatchKeyword('Bug?', ['bug'])).toBe(true);
  });

  it('respects word boundaries so debug / bugfix do NOT trigger bug', () => {
    expect(messageMatchesWatchKeyword('debug logs', ['bug'])).toBe(false);
    expect(messageMatchesWatchKeyword('bugfix landed', ['bug'])).toBe(false);
    expect(messageMatchesWatchKeyword('the bug landed', ['bug'])).toBe(true);
  });

  it('keeps scanning past non-boundary occurrences to find a later whole-word match', () => {
    expect(messageMatchesWatchKeyword('debug logs show a real bug', ['bug'])).toBe(true);
    expect(messageMatchesWatchKeyword('bugfix landed but the bug is back', ['bug'])).toBe(true);
    // Still false when every occurrence is embedded.
    expect(messageMatchesWatchKeyword('debug then bugfix', ['bug'])).toBe(false);
  });

  it('still matches when keyword is flanked by punctuation', () => {
    expect(messageMatchesWatchKeyword('(bug)', ['bug'])).toBe(true);
    expect(messageMatchesWatchKeyword('bug, anyone?', ['bug'])).toBe(true);
    expect(messageMatchesWatchKeyword('"bug"!', ['bug'])).toBe(true);
  });

  it('supports CJK keywords (no ASCII \\b assumption)', () => {
    expect(messageMatchesWatchKeyword('线上故障，需要修复', ['故障'])).toBe(true);
    // Surrounded by other CJK chars should still match — \b would have failed
    // here but our predicate uses unicode word-class lookarounds.
    expect(messageMatchesWatchKeyword('系统故障报告', ['故障'])).toBe(true);
  });

  it('matches the first keyword in a multi-keyword list', () => {
    expect(messageMatchesWatchKeyword('user wants to buy', ['bug', 'buy', 'outage'])).toBe(true);
    expect(messageMatchesWatchKeyword('weather update', ['bug', 'buy', 'outage'])).toBe(false);
  });
});

describe('extractWatchKeywordEntries', () => {
  it('returns [] for missing / non-array, non-string values', () => {
    expect(extractWatchKeywordEntries(null)).toEqual([]);
    expect(extractWatchKeywordEntries(undefined)).toEqual([]);
    expect(extractWatchKeywordEntries({})).toEqual([]);
    expect(extractWatchKeywordEntries({ watchKeywords: 42 })).toEqual([]);
  });

  it('keeps the operator-authored instruction alongside the lowercased keyword', () => {
    expect(
      extractWatchKeywordEntries({
        watchKeywords: [
          { instruction: '  Scan the thread for a bug report  ', keyword: 'Bug' },
          { keyword: 'outage' },
        ],
      }),
    ).toEqual([
      { instruction: 'Scan the thread for a bug report', keyword: 'bug' },
      { instruction: undefined, keyword: 'outage' },
    ]);
  });

  it('dedupes by keyword and keeps the first non-empty instruction', () => {
    expect(
      extractWatchKeywordEntries({
        watchKeywords: [
          { keyword: 'bug' },
          { instruction: 'first instruction', keyword: 'BUG' },
          { instruction: 'later instruction', keyword: 'bug' },
        ],
      }),
    ).toEqual([{ instruction: 'first instruction', keyword: 'bug' }]);
  });

  it('returns entries with no instruction for the string and string[] fallbacks', () => {
    expect(extractWatchKeywordEntries({ watchKeywords: ['Bug', 'outage'] })).toEqual([
      { instruction: undefined, keyword: 'bug' },
      { instruction: undefined, keyword: 'outage' },
    ]);
    expect(extractWatchKeywordEntries({ watchKeywords: 'bug, outage' })).toEqual([
      { instruction: undefined, keyword: 'bug' },
      { instruction: undefined, keyword: 'outage' },
    ]);
  });
});

describe('findMatchingWatchKeywordEntries', () => {
  it('returns matched entries in authoring order', () => {
    const entries = [
      { instruction: 'scan thread for bug', keyword: 'bug' },
      { instruction: 'page oncall', keyword: 'outage' },
      { keyword: 'buy' },
    ];
    expect(findMatchingWatchKeywordEntries('we have a bug and a major outage', entries)).toEqual([
      { instruction: 'scan thread for bug', keyword: 'bug' },
      { instruction: 'page oncall', keyword: 'outage' },
    ]);
  });

  it('respects the same word-boundary rules as the gate predicate', () => {
    const entries = [{ instruction: 'scan thread', keyword: 'bug' }];
    expect(findMatchingWatchKeywordEntries('debug logs', entries)).toEqual([]);
    expect(findMatchingWatchKeywordEntries('the bug landed', entries)).toEqual(entries);
  });

  it('returns [] on empty text or empty entries', () => {
    expect(findMatchingWatchKeywordEntries('', [{ keyword: 'bug' }])).toEqual([]);
    expect(findMatchingWatchKeywordEntries('bug everywhere', [])).toEqual([]);
  });
});
