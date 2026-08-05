import { describe, expect, it } from 'vitest';

import { resolveModelSearchDefaultSettings, resolveSearchDecision } from './utils';

describe('resolveSearchDecision', () => {
  it.each([
    {
      expected: { application: false, model: false },
      input: { modelSearchImpl: 'internal' as const, searchMode: 'off' as const },
      name: 'disables every search route when search is off',
    },
    {
      expected: { application: false, model: true },
      input: {
        modelSearchImpl: 'params' as const,
        searchMode: 'on' as const,
        useModelBuiltinSearch: true,
      },
      name: 'uses model search when supported and selected',
    },
    {
      expected: { application: true, model: false },
      input: {
        modelSearchImpl: 'params' as const,
        searchMode: 'on' as const,
        useModelBuiltinSearch: false,
      },
      name: 'uses application search when model search is not selected',
    },
    {
      expected: { application: true, model: false },
      input: { searchMode: 'on' as const, useModelBuiltinSearch: true },
      name: 'falls back to application search when native search is unsupported',
    },
    {
      expected: { application: false, model: true },
      input: { modelSearchImpl: 'internal' as const, searchMode: 'on' as const },
      name: 'always uses internal model search while search is enabled',
    },
    {
      expected: { application: false, model: true },
      input: { providerSearchMode: 'internal' as const, searchMode: 'on' as const },
      name: 'always uses internal provider search while search is enabled',
    },
  ])('$name', ({ expected, input }) => {
    const result = resolveSearchDecision(input);

    expect(result.useModelSearch).toBe(expected.model);
    expect(result.useApplicationBuiltinSearchTool).toBe(expected.application);
    expect(result.enabledSearch).toBe(input.searchMode !== 'off');
  });
});

describe('resolveModelSearchDefaultSettings', () => {
  it('keeps model-specific internal search defaults', () => {
    expect(resolveModelSearchDefaultSettings('openai', 'gpt-4o-search-preview')).toEqual({
      searchImpl: 'internal',
    });
  });

  it('falls back to params for unknown providers', () => {
    expect(resolveModelSearchDefaultSettings('custom-provider', 'remote-model')).toEqual({
      searchImpl: 'params',
    });
  });
});
