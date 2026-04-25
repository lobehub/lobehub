import { describe, expect, it } from 'vitest';

import {
  allowFromField,
  extractDmSettings,
  extractGroupSettings,
  extractUserAllowlist,
  getBotReplyLocale,
  getStepReactionEmoji,
  makeDmPolicyField,
  makeGroupPolicyFields,
  normalizeBotReplyLocale,
  shouldAllowSender,
  shouldHandleDm,
  shouldHandleGroup,
  THINKING_REACTION_EMOJI,
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
  it('produces a flat dmPolicy field with the supplied default policy and three modes', () => {
    const field = makeDmPolicyField({ policy: 'open' });

    expect(field.key).toBe('dmPolicy');
    expect(field.type).toBe('string');
    expect(field.default).toBe('open');
    expect(field.enum).toEqual(['open', 'allowlist', 'disabled']);
  });

  it('supports the per-platform default override (e.g. opt-in disabled)', () => {
    const field = makeDmPolicyField({ policy: 'disabled' });
    expect(field.default).toBe('disabled');
  });
});

describe('allowFromField', () => {
  it('is a flat top-level user-id allowlist that is always visible (global gate)', () => {
    expect(allowFromField.key).toBe('allowFrom');
    expect(allowFromField.type).toBe('string');
    // Always visible — applies globally to DM and group, no visibleWhen gate.
    expect(allowFromField.visibleWhen).toBeUndefined();
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
  });

  it('parses comma- and whitespace-separated user IDs', () => {
    expect(extractUserAllowlist({ allowFrom: '  alice, bob\n  carol  ' })).toEqual({
      ids: ['alice', 'bob', 'carol'],
    });
  });

  it('accepts an array form already', () => {
    expect(extractUserAllowlist({ allowFrom: ['alice', ' bob ', ''] })).toEqual({
      ids: ['alice', 'bob'],
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

  it('parses groupAllowFrom into a trimmed array of channel IDs', () => {
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
    ).toBe(true);
  });

  it('blocks DMs when disabled', () => {
    expect(
      shouldHandleDm({
        authorUserId: 'alice-id',
        dmSettings: disabled,
        isDM: true,
        userAllowlist: aliceAndBob,
      }),
    ).toBe(false);
  });

  it('allows DMs under the open policy regardless of allowlist contents', () => {
    expect(
      shouldHandleDm({
        authorUserId: 'anyone',
        dmSettings: open,
        isDM: true,
        userAllowlist: emptyUserAllowlist,
      }),
    ).toBe(true);
    // The global gate (shouldAllowSender) is the runtime filter for `open`;
    // shouldHandleDm itself does not re-check it.
    expect(
      shouldHandleDm({
        authorUserId: 'anyone',
        dmSettings: open,
        isDM: true,
        userAllowlist: aliceAndBob,
      }),
    ).toBe(true);
  });

  it('allows DMs in allowlist mode when the sender is on the list', () => {
    expect(
      shouldHandleDm({
        authorUserId: 'alice-id',
        dmSettings: allowlist,
        isDM: true,
        userAllowlist: aliceAndBob,
      }),
    ).toBe(true);
  });

  it('rejects DMs in allowlist mode when the sender is NOT on the list', () => {
    expect(
      shouldHandleDm({
        authorUserId: 'carol-id',
        dmSettings: allowlist,
        isDM: true,
        userAllowlist: aliceAndBob,
      }),
    ).toBe(false);
  });

  it('fails closed in allowlist mode when allowFrom is empty (no DMs)', () => {
    // This is the only behavioural difference from `open`: `open` would
    // pass anyone here, `allowlist` rejects everyone.
    expect(
      shouldHandleDm({
        authorUserId: 'alice-id',
        dmSettings: allowlist,
        isDM: true,
        userAllowlist: emptyUserAllowlist,
      }),
    ).toBe(false);
  });

  it('fails closed when the allowlisted policy sees a missing user id', () => {
    expect(
      shouldHandleDm({
        authorUserId: undefined,
        dmSettings: allowlist,
        isDM: true,
        userAllowlist: aliceAndBob,
      }),
    ).toBe(false);
  });
});

describe('shouldHandleGroup', () => {
  const open = { allowFrom: [] as string[], policy: 'open' as const };
  const disabled = { allowFrom: [] as string[], policy: 'disabled' as const };
  const allowlist = { allowFrom: ['channel-1', 'channel-2'], policy: 'allowlist' as const };

  it('lets DM threads pass unconditionally', () => {
    expect(shouldHandleGroup({ channelId: undefined, groupSettings: disabled, isDM: true })).toBe(
      true,
    );
  });

  it('blocks group traffic when disabled', () => {
    expect(
      shouldHandleGroup({ channelId: 'channel-1', groupSettings: disabled, isDM: false }),
    ).toBe(false);
  });

  it('allows group traffic under the open policy', () => {
    expect(shouldHandleGroup({ channelId: 'any-channel', groupSettings: open, isDM: false })).toBe(
      true,
    );
  });

  it('allows group traffic from channels in the allowlist', () => {
    expect(
      shouldHandleGroup({ channelId: 'channel-1', groupSettings: allowlist, isDM: false }),
    ).toBe(true);
  });

  it('rejects group traffic from channels outside the allowlist', () => {
    expect(
      shouldHandleGroup({ channelId: 'channel-9', groupSettings: allowlist, isDM: false }),
    ).toBe(false);
  });

  it('fails closed when the allowlisted policy sees a missing channel id', () => {
    expect(shouldHandleGroup({ channelId: undefined, groupSettings: allowlist, isDM: false })).toBe(
      false,
    );
  });
});
