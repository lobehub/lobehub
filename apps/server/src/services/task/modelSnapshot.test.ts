import {
  getHeterogeneousTaskModelProvider,
  type HeterogeneousProviderConfig,
} from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { resolveMissingTaskModelConfig } from './modelSnapshot';

const snapshot = { model: 'codex', provider: 'openai' };

/** @example Task provider inference preserves authentication and explicit intent. */
describe('resolveMissingTaskModelConfig', () => {
  /** @example Subscription model-only overrides still target their native runtime. */
  it('keeps the native provider for a subscription model-only Task', () => {
    const provider = getHeterogeneousTaskModelProvider({ authMode: 'subscription', type: 'codex' });
    /** @example Wrapper openai is not paired with a native override. */
    expect(resolveMissingTaskModelConfig({ model: 'gpt-5.4-mini' }, snapshot, provider)).toEqual({
      provider: 'codex',
    });
  });

  /** @example A personal API binding supplies its own provider ID. */
  it('fills the personal API provider for a model-only Task', () => {
    const provider = getHeterogeneousTaskModelProvider({
      authMode: 'api',
      type: 'codex',
      apiConfig: { model: 'gpt-5.4', providerId: 'personal-provider' },
    });
    /** @example The explicit model keeps the binding instead of the wrapper provider. */
    expect(resolveMissingTaskModelConfig({ model: 'gpt-5.4-mini' }, snapshot, provider)).toEqual({
      provider: 'personal-provider',
    });
  });

  // ROOT CAUSE:
  // Missing or deployment-owned API bindings cannot use the Agent row's wrapper
  // provider as a personal binding. Null keeps that inference unavailable.
  /** @example API configuration without a personal binding must not be synthesized. */
  it.each<HeterogeneousProviderConfig>([
    { authMode: 'api', type: 'codex' },
    {
      authMode: 'api',
      type: 'codex',
      apiConfig: { model: 'gpt-5.4', providerId: 'openai', source: 'server-default' },
    },
  ])('does not infer a personal provider from unavailable binding %j', (config) => {
    const provider = getHeterogeneousTaskModelProvider(config);
    /** @example Existing dispatch guards receive the unchanged missing/deployment binding. */
    expect(resolveMissingTaskModelConfig({ model: 'gpt-5.4-mini' }, snapshot, provider)).toEqual(
      {},
    );
  });

  /** @example Runtime identity is a snapshot rather than a native/API model override. */
  it('retains the wrapper provider for runtime-ID input', () => {
    /** @example A personal API provider does not replace codex/openai identity. */
    expect(
      resolveMissingTaskModelConfig({ model: 'codex' }, snapshot, 'personal-provider'),
    ).toEqual({ provider: 'openai' });
  });

  /** @example Explicit provider choices are never replaced by inference. */
  it('leaves an explicit provider untouched', () => {
    /** @example The caller-selected provider wins over the Agent binding. */
    expect(
      resolveMissingTaskModelConfig(
        { model: 'gpt-5.4-mini', provider: 'other-provider' },
        snapshot,
        'personal-provider',
      ),
    ).toEqual({});
  });

  /** @example Missing Task model/provider fields inherit the Agent wrapper snapshot. */
  it('retains inherited runtime identity', () => {
    /** @example Binding inference applies only to explicit model-only overrides. */
    expect(resolveMissingTaskModelConfig({}, snapshot, 'personal-provider')).toEqual(snapshot);
  });

  /** @example Ordinary Agents use their standard provider snapshot. */
  it('keeps ordinary Agent provider inference', () => {
    /** @example Non-heterogeneous models retain the normal provider. */
    expect(
      resolveMissingTaskModelConfig(
        { model: 'gpt-5.4-mini' },
        { model: 'gpt-5.4', provider: 'openai' },
      ),
    ).toEqual({ provider: 'openai' });
  });
});
