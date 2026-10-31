import { describe, expect, it } from 'vitest';

import {
  LEGACY_CONFIG_KEYS,
  LEGACY_EXTEND_PARAMS,
  migrateModelSettings,
  migrateReasoningConfig,
  resolveLegacyEffortKey,
} from './transform';

it('lists every legacy extend param except reasoningEffort as a saved-value key', () => {
  expect([...LEGACY_CONFIG_KEYS].sort()).toEqual(
    LEGACY_EXTEND_PARAMS.filter((key) => key !== 'reasoningEffort').sort(),
  );
});

describe('migrateReasoningConfig', () => {
  const next = (config: unknown, effortKey?: string) =>
    migrateReasoningConfig(config, effortKey)?.next;

  it('moves a legacy pick into reasoningEffort and drops the legacy key', () => {
    expect(next({ gpt5_2ReasoningEffort: 'xhigh', urlContext: true })).toEqual({
      reasoningEffort: 'xhigh',
      urlContext: true,
    });
  });

  it("prefers the model's legacy key over a stale generic value", () => {
    // Regression: the old runtime read gpt5_2ReasoningEffort for GPT-5.2, so the
    // row ran at high even though a generic reasoningEffort said low
    expect(
      migrateReasoningConfig(
        { gpt5_2ReasoningEffort: 'high', reasoningEffort: 'low' },
        'gpt5_2ReasoningEffort',
      ),
    ).toEqual({ conflict: false, next: { reasoningEffort: 'high' } });
  });

  it('keeps the generic value for a model that read the generic key', () => {
    expect(
      next({ gpt5_2ReasoningEffort: 'high', reasoningEffort: 'low' }, 'reasoningEffort'),
    ).toEqual({ reasoningEffort: 'low' });
  });

  it("picks the model's key among several legacy values", () => {
    expect(next({ opus47Effort: 'max', thinkingLevel: 'low' }, 'thinkingLevel')).toEqual({
      reasoningEffort: 'low',
    });
  });

  it('skips and flags values it cannot reconcile without the legacy key', () => {
    expect(migrateReasoningConfig({ reasoningEffort: 'low', thinkingLevel: 'high' })).toEqual({
      conflict: true,
    });
    // Regression: an unknown sub-agent model used to take the first legacy value
    expect(migrateReasoningConfig({ effort: 'low', gpt5ReasoningEffort: 'high' })).toEqual({
      conflict: true,
    });
  });

  it('collapses agreeing values without the legacy key', () => {
    expect(next({ effort: 'high', gpt5ReasoningEffort: 'high', reasoningEffort: 'high' })).toEqual({
      reasoningEffort: 'high',
    });
  });

  it('drops a legacy value the key never offered', () => {
    expect(next({ thinkingLevel2: 'medium' })).toEqual({});
  });

  it('returns undefined when nothing changes, so a second run is a no-op', () => {
    const migrated = next({ opus47Effort: 'max' });
    expect(migrated).toEqual({ reasoningEffort: 'max' });
    expect(migrateReasoningConfig(migrated)).toBeUndefined();
    expect(migrateReasoningConfig(null)).toBeUndefined();
    expect(next({ effort: 'low', reasoningMode: 'pro' })).toEqual({
      reasoningEffort: 'low',
      reasoningMode: 'pro',
    });
  });
});

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

describe('migrateModelSettings', () => {
  it('only drops legacy keys for rows backed by a provider card', () => {
    expect(
      migrateModelSettings(
        { extendParams: ['thinkingLevel3', 'urlContext'], searchImpl: 'params' },
        { hasProviderCard: true },
      ),
    ).toEqual({ extendParams: ['urlContext'], searchImpl: 'params' });
  });

  it('copies the same-id card spec onto remote rows', () => {
    const cardSpec = { default: 'high' as const, levels: ['low' as const, 'high' as const] };
    expect(
      migrateModelSettings(
        { extendParams: ['thinkingLevel2'] },
        { cardSpec, hasProviderCard: false },
      ),
    ).toEqual({ reasoningEffort: cardSpec });
  });

  it('builds a middle-default spec for custom rows without a card', () => {
    expect(
      migrateModelSettings(
        { extendParams: ['deepseekV4ReasoningEffort', 'enableReasoning'] },
        { hasProviderCard: false },
      ),
    ).toEqual({
      extendParams: ['enableReasoning'],
      reasoningEffort: { controlsThinking: true, default: 'high', levels: ['none', 'high', 'max'] },
    });
  });

  it('is idempotent', () => {
    const migrated = migrateModelSettings({ extendParams: ['effort'] }, { hasProviderCard: false });
    expect(migrated).toEqual({
      reasoningEffort: { default: 'high', levels: ['low', 'medium', 'high', 'max'] },
    });
    expect(migrateModelSettings(migrated, { hasProviderCard: false })).toBeUndefined();
  });
});
