import { describe, expect, it } from 'vitest';

import {
  extractDmSettings,
  getStepReactionEmoji,
  makeDmField,
  shouldHandleDm,
  THINKING_REACTION_EMOJI,
  WORKING_REACTION_EMOJI,
} from '../const';

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

describe('makeDmField', () => {
  it('produces a dm settings group with the supplied default policy', () => {
    const field = makeDmField({ policy: 'open' });

    expect(field.key).toBe('dm');
    expect(field.type).toBe('object');

    const properties = field.properties ?? [];
    const policy = properties.find((p) => p.key === 'policy');
    const allowFrom = properties.find((p) => p.key === 'allowFrom');

    expect(policy?.default).toBe('open');
    expect(policy?.enum).toEqual(['open', 'allowlist', 'disabled']);
    expect(allowFrom?.visibleWhen).toEqual({ field: 'policy', value: 'allowlist' });
  });

  it('supports the Discord-style opt-in default (disabled)', () => {
    const field = makeDmField({ policy: 'disabled' });
    const properties = field.properties ?? [];
    expect(properties.find((p) => p.key === 'policy')?.default).toBe('disabled');
  });
});

describe('extractDmSettings', () => {
  it('defaults to open when policy is missing or invalid', () => {
    // In production `mergeWithDefaults` always injects `dm.policy` from the
    // platform schema, so this branch is only a safety net for malformed
    // settings — we land on the most permissive valid policy.
    expect(extractDmSettings(undefined)).toEqual({ allowFrom: [], policy: 'open' });
    expect(extractDmSettings({})).toEqual({ allowFrom: [], policy: 'open' });
    expect(extractDmSettings({ dm: {} })).toEqual({ allowFrom: [], policy: 'open' });
  });

  it('normalizes an unknown policy back to open', () => {
    const result = extractDmSettings({ dm: { policy: 'mystery' } });
    expect(result.policy).toBe('open');
  });

  it('parses a comma- and whitespace-separated allowFrom into a trimmed array', () => {
    const result = extractDmSettings({
      dm: {
        allowFrom: '  alice-id, bob-id\n  carol-id  ',
        policy: 'allowlist',
      },
    });
    expect(result.allowFrom).toEqual(['alice-id', 'bob-id', 'carol-id']);
  });

  it('accepts an allowFrom already provided as an array', () => {
    const result = extractDmSettings({
      dm: {
        allowFrom: ['alice-id', ' bob-id ', ''],
        policy: 'allowlist',
      },
    });
    expect(result.allowFrom).toEqual(['alice-id', 'bob-id']);
  });
});

describe('shouldHandleDm', () => {
  const open = { allowFrom: [] as string[], policy: 'open' as const };
  const disabled = { allowFrom: [] as string[], policy: 'disabled' as const };
  const allowlist = {
    allowFrom: ['alice-id', 'bob-id'],
    policy: 'allowlist' as const,
  };

  it('lets non-DM threads pass unconditionally', () => {
    expect(shouldHandleDm({ authorUserId: undefined, dmSettings: disabled, isDM: false })).toBe(
      true,
    );
  });

  it('blocks DMs when disabled', () => {
    expect(shouldHandleDm({ authorUserId: 'alice-id', dmSettings: disabled, isDM: true })).toBe(
      false,
    );
  });

  it('allows DMs under the open policy', () => {
    expect(shouldHandleDm({ authorUserId: 'anyone', dmSettings: open, isDM: true })).toBe(true);
  });

  it('allows DMs from allowlisted senders', () => {
    expect(shouldHandleDm({ authorUserId: 'alice-id', dmSettings: allowlist, isDM: true })).toBe(
      true,
    );
  });

  it('rejects DMs from senders outside the allowlist', () => {
    expect(shouldHandleDm({ authorUserId: 'carol-id', dmSettings: allowlist, isDM: true })).toBe(
      false,
    );
  });

  it('fails closed when an allowlisted provider sees a missing user id', () => {
    expect(shouldHandleDm({ authorUserId: undefined, dmSettings: allowlist, isDM: true })).toBe(
      false,
    );
  });
});
