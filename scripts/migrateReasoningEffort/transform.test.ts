import { describe, expect, it } from 'vitest';

import { migrateAiModelRow, resolveLegacyEffortKey } from './transform';

describe('resolveLegacyEffortKey', () => {
  it("uses the row's own legacy extend param first", () => {
    expect(
      resolveLegacyEffortKey({
        extendParams: ['urlContext', 'kimiK3ReasoningEffort'],
        model: 'gpt-5.2',
        provider: 'openai',
      }),
    ).toBe('kimiK3ReasoningEffort');
  });

  it("falls back to the provider card's key, then the bare id", () => {
    expect(resolveLegacyEffortKey({ model: 'gpt-5.2', provider: 'openai' })).toBe(
      'gpt5_2ReasoningEffort',
    );
    expect(resolveLegacyEffortKey({ model: 'openai/gpt-5.2', provider: 'custom' })).toBe(
      'gpt5_2ReasoningEffort',
    );
  });

  it('returns undefined for an id whose providers disagreed', () => {
    expect(
      resolveLegacyEffortKey({ model: 'deepseek-v4-pro', provider: 'custom' }),
    ).toBeUndefined();
    expect(resolveLegacyEffortKey({ model: 'unknown-model', provider: 'openai' })).toBeUndefined();
  });
});

describe('migrateAiModelRow', () => {
  it('leaves a conflicting row unchanged, including its settings', () => {
    // A custom row declares a legacy key but saved no value for it, and the
    // remaining values disagree: a new spec would activate the stale generic one.
    expect(
      migrateAiModelRow({
        chatConfig: { reasoningEffort: 'high', thinkingLevel3: 'low' },
        hasProviderCard: false,
        model: 'my-model',
        provider: 'custom',
        settings: { extendParams: ['gpt5ReasoningEffort'] },
      }),
    ).toEqual({ conflict: true });
  });

  it('migrates the pick and the declaration together', () => {
    expect(
      migrateAiModelRow({
        chatConfig: { gpt5ReasoningEffort: 'low' },
        hasProviderCard: false,
        model: 'my-model',
        provider: 'custom',
        settings: { extendParams: ['gpt5ReasoningEffort'] },
      }),
    ).toEqual({
      chatConfig: { reasoningEffort: 'low' },
      conflict: false,
      settings: { reasoningEffort: { levels: ['minimal', 'low', 'medium', 'high'] } },
    });
  });
});
