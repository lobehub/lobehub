import { describe, expect, it } from 'vitest';

import { deduplicateRemoteModels } from './utils';

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
