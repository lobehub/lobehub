import { describe, expect, it } from 'vitest';

import { resolveServerSearchDecision } from '../searchDecision';

describe('resolveServerSearchDecision', () => {
  it('does not borrow native search capability from another provider with the same model id', () => {
    const result = resolveServerSearchDecision({
      builtinModels: [
        {
          abilities: { search: true },
          id: 'grok-4.3',
          providerId: 'xai',
          settings: { searchImpl: 'tool' },
        },
      ],
      chatConfig: { searchMode: 'on', useModelBuiltinSearch: true },
      model: 'grok-4.3',
      provider: 'custom-openai-compatible',
    });

    expect(result.useModelSearch).toBe(false);
    expect(result.useApplicationBuiltinSearchTool).toBe(true);
  });

  it('uses xAI Live Search for multi-agent Grok without the builtin toggle', () => {
    const result = resolveServerSearchDecision({
      builtinModels: [
        {
          abilities: { search: true },
          id: 'grok-4.20-multi-agent-0309',
          providerId: 'xai',
          settings: { searchImpl: 'tool' },
        },
      ],
      chatConfig: { searchMode: 'auto', useModelBuiltinSearch: false },
      model: 'grok-4.20-multi-agent-0309',
      provider: 'xai',
    });

    expect(result.useModelSearch).toBe(true);
    expect(result.useApplicationBuiltinSearchTool).toBe(false);
  });

  it('infers tool search for a remotely discovered xAI model', () => {
    const result = resolveServerSearchDecision({
      builtinModels: [],
      chatConfig: { searchMode: 'on', useModelBuiltinSearch: false },
      model: 'grok-new-remote',
      modelSearchAbility: true,
      provider: 'xai',
    });

    expect(result.useModelSearch).toBe(true);
    expect(result.useApplicationBuiltinSearchTool).toBe(false);
  });

  it('honors a stored abilities override that omits builtin search', () => {
    const result = resolveServerSearchDecision({
      builtinModels: [
        {
          abilities: { search: true },
          id: 'remote-model',
          providerId: 'custom-provider',
        },
      ],
      chatConfig: { searchMode: 'on', useModelBuiltinSearch: true },
      hasModelAbilitiesOverride: true,
      model: 'remote-model',
      provider: 'custom-provider',
    });

    expect(result.useModelSearch).toBe(false);
    expect(result.useApplicationBuiltinSearchTool).toBe(true);
  });

  it.each(['supergrok', 'openrouter'])(
    'uses %s provider search for an unlisted model',
    (provider) => {
      const result = resolveServerSearchDecision({
        builtinModels: [],
        chatConfig: {
          searchMode: 'on',
          // SuperGrok uses tool search (no toggle); OpenRouter still needs params toggle.
          useModelBuiltinSearch: provider === 'openrouter' ? true : false,
        },
        model: 'new-remote-model',
        provider,
      });

      expect(result.isProviderHasBuiltinSearch).toBe(true);
      expect(result.useModelSearch).toBe(true);
      expect(result.useApplicationBuiltinSearchTool).toBe(false);
    },
  );

  it('uses explicit params search even when abilities.search is absent', () => {
    const result = resolveServerSearchDecision({
      builtinModels: [],
      chatConfig: { searchMode: 'on', useModelBuiltinSearch: true },
      model: 'remote-model',
      modelSearchImpl: 'params',
      provider: 'custom-provider',
    });

    expect(result.useModelSearch).toBe(true);
    expect(result.useApplicationBuiltinSearchTool).toBe(false);
  });

  it('infers internal search for a remotely discovered model', () => {
    const result = resolveServerSearchDecision({
      builtinModels: [],
      chatConfig: { searchMode: 'on' },
      model: 'jina-deepsearch-v1',
      modelSearchAbility: true,
      provider: 'jina',
    });

    expect(result.useModelSearch).toBe(true);
    expect(result.useApplicationBuiltinSearchTool).toBe(false);
  });

  it('disables both routes when search mode is off', () => {
    const result = resolveServerSearchDecision({
      builtinModels: [],
      chatConfig: { searchMode: 'off', useModelBuiltinSearch: true },
      model: 'remote-model',
      modelSearchImpl: 'internal',
      provider: 'custom-provider',
    });

    expect(result.useModelSearch).toBe(false);
    expect(result.useApplicationBuiltinSearchTool).toBe(false);
  });

  it('falls back to application search when selected native search is unsupported', () => {
    const result = resolveServerSearchDecision({
      builtinModels: [],
      chatConfig: { searchMode: 'on', useModelBuiltinSearch: true },
      model: 'remote-model',
      provider: 'custom-provider',
    });

    expect(result.useModelSearch).toBe(false);
    expect(result.useApplicationBuiltinSearchTool).toBe(true);
  });
});
