import { describe, expect, it } from 'vitest';

import {
  deduplicateRemoteModels,
  enabledBuiltinIdsMissingFromCatalog,
  enabledRemoteIdsMissingFromCatalog,
} from './utils';

describe('enabledBuiltinIdsMissingFromCatalog', () => {
  const builtinIds = ['jzs-max-3.0', 'gpt-5.6-terra', 'claude-sonnet-5'];

  it('returns enabled builtins the catalog omitted', () => {
    expect(
      enabledBuiltinIdsMissingFromCatalog(builtinIds, new Set(['jzs-max-3.0']), [
        { enabled: true, id: 'jzs-max-3.0' },
        { enabled: true, id: 'gpt-5.6-terra' },
        { enabled: false, id: 'claude-sonnet-5' },
        { enabled: true, id: 'custom-extra' },
      ]),
    ).toEqual(['gpt-5.6-terra']);
  });

  it('keeps builtins the catalog returned', () => {
    expect(
      enabledBuiltinIdsMissingFromCatalog(builtinIds, new Set(['gpt-5.6-terra']), [
        { enabled: true, id: 'gpt-5.6-terra' },
      ]),
    ).toEqual([]);
  });

  it('does not treat an empty catalog as authoritative', () => {
    expect(
      enabledBuiltinIdsMissingFromCatalog(builtinIds, new Set(), [
        { enabled: true, id: 'gpt-5.6-terra' },
      ]),
    ).toEqual([]);
  });
});

describe('enabledRemoteIdsMissingFromCatalog', () => {
  const currentModels = [
    { enabled: true, id: 'fetched-only', source: 'remote' as const },
    { enabled: false, id: 'fetched-disabled', source: 'remote' as const },
    { enabled: true, id: 'still-in-catalog', source: 'remote' as const },
    { enabled: true, id: 'my-custom', source: 'custom' as const },
    { enabled: true, id: 'gpt-5.6-terra', source: 'builtin' as const },
  ];

  it('returns enabled remote rows the catalog omitted', () => {
    expect(
      enabledRemoteIdsMissingFromCatalog(new Set(['still-in-catalog']), currentModels),
    ).toEqual(['fetched-only']);
  });

  it('excludes custom and builtin rows from the omitted remote ids', () => {
    expect(enabledRemoteIdsMissingFromCatalog(new Set(['fetched-only']), currentModels)).toEqual([
      'still-in-catalog',
    ]);
  });

  it('does not treat an empty catalog as authoritative', () => {
    expect(enabledRemoteIdsMissingFromCatalog(new Set(), currentModels)).toEqual([]);
  });
});

describe('deduplicateRemoteModels', () => {
  it('should keep the first ordinary model with a duplicate id', () => {
    const result = deduplicateRemoteModels([
      { id: 'koboldcpp', source: 'first' },
      { id: 'koboldcpp', source: 'second' },
      { id: 'other-model', source: 'only' },
    ]);

    expect(result).toEqual({
      duplicateIds: ['koboldcpp'],
      models: [
        { id: 'koboldcpp', source: 'first' },
        { id: 'other-model', source: 'only' },
      ],
      removedCount: 1,
    });
  });

  it('should keep the last auto-generated image model with a duplicate id', () => {
    const result = deduplicateRemoteModels([
      { id: 'gemini-3.1-flash-image-preview', source: 'base' },
      { id: 'gemini-3.1-flash-image-preview:image', source: 'provider' },
      { id: 'other-model', source: 'only' },
      { id: 'gemini-3.1-flash-image-preview:image', source: 'lobehub' },
    ]);

    expect(result).toEqual({
      duplicateIds: ['gemini-3.1-flash-image-preview:image'],
      models: [
        { id: 'gemini-3.1-flash-image-preview', source: 'base' },
        { id: 'other-model', source: 'only' },
        { id: 'gemini-3.1-flash-image-preview:image', source: 'lobehub' },
      ],
      removedCount: 1,
    });
  });

  it('should keep the first image model when its generated base model is absent', () => {
    const result = deduplicateRemoteModels([
      { id: 'gemini-3.1-flash-image-preview:image', source: 'first-provider-entry' },
      { id: 'gemini-3.1-flash-image-preview:image', source: 'second-provider-entry' },
    ]);

    expect(result.models).toEqual([
      { id: 'gemini-3.1-flash-image-preview:image', source: 'first-provider-entry' },
    ]);
  });

  it('should keep the last auto-generated decision model with a duplicate id', () => {
    const result = deduplicateRemoteModels([
      { id: 'gpt-6-luna', source: 'base' },
      { id: 'gpt-6-luna:decision', source: 'provider' },
      { id: 'gpt-6-luna:decision', source: 'generated' },
    ]);

    expect(result.models).toEqual([
      { id: 'gpt-6-luna', source: 'base' },
      { id: 'gpt-6-luna:decision', source: 'generated' },
    ]);
    expect(result.duplicateIds).toEqual(['gpt-6-luna:decision']);
  });

  it('should count every removed entry while reporting each duplicate id once', () => {
    const result = deduplicateRemoteModels([
      { id: 'duplicate-model', value: 1 },
      { id: 'duplicate-model', value: 2 },
      { id: 'duplicate-model', value: 3 },
    ]);

    expect(result.duplicateIds).toEqual(['duplicate-model']);
    expect(result.models).toEqual([{ id: 'duplicate-model', value: 1 }]);
    expect(result.removedCount).toBe(2);
  });
});
