import { describe, expect, it } from 'vitest';

import { lobehubChatModels } from './chat';
import { lobehubEmbeddingModels } from './embedding';
import { findLobeHubModel, isLobeHubModelAvailable } from './findModel';
import { lobehubImageModels } from './image';
import { lobehubVideoModels } from './video';

describe('findLobeHubModel', () => {
  it('prioritizes hosted DeepSeek models in the chat model list', () => {
    expect(lobehubChatModels.slice(0, 2).map((model) => model.id)).toEqual([
      'deepseek-v4-pro',
      'deepseek-v4-flash',
    ]);
  });

  it('returns the model when id exists in chat models', () => {
    const sample = lobehubChatModels[0];
    expect(findLobeHubModel(sample.id)).toMatchObject({ id: sample.id, type: 'chat' });
  });

  it('returns the model when id exists in image / video / embedding models', () => {
    if (lobehubImageModels[0]) {
      expect(findLobeHubModel(lobehubImageModels[0].id)?.type).toBe('image');
    }
    if (lobehubVideoModels[0]) {
      expect(findLobeHubModel(lobehubVideoModels[0].id)?.type).toBe('video');
    }
    if (lobehubEmbeddingModels[0]) {
      expect(findLobeHubModel(lobehubEmbeddingModels[0].id)?.type).toBe('embedding');
    }
  });

  it('returns undefined for deprecated/unknown model ids', () => {
    expect(findLobeHubModel('claude-3-5-sonnet-latest')).toBeUndefined();
    expect(findLobeHubModel('gpt-3.5-turbo')).toBeUndefined();
    expect(findLobeHubModel('')).toBeUndefined();
  });
});

describe('isLobeHubModelAvailable', () => {
  it('returns true when id and expected type both match', () => {
    const sample = lobehubChatModels[0];
    expect(isLobeHubModelAvailable(sample.id, 'chat')).toBe(true);
  });

  it('returns false when id matches but type differs', () => {
    const sample = lobehubChatModels[0];
    expect(isLobeHubModelAvailable(sample.id, 'image')).toBe(false);
    expect(isLobeHubModelAvailable(sample.id, 'video')).toBe(false);
  });

  it('returns false for deprecated/unknown ids regardless of type', () => {
    expect(isLobeHubModelAvailable('claude-3-5-sonnet-latest', 'chat')).toBe(false);
    expect(isLobeHubModelAvailable('seedance-2.0-lite', 'video')).toBe(false);
  });
});
