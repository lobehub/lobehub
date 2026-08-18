import { describe, expect, it } from 'vitest';

import {
  computeDefaultEnabledOpenRouterModelIds,
  ensureOpenRouterAutoModel,
  OPENROUTER_AUTO_MODEL_ID,
  pickPreferredDefaultOpenRouterModelId,
} from './openrouterDefaultModels';

describe('computeDefaultEnabledOpenRouterModelIds', () => {
  it('always pins Auto plus the newest 4 chat models per family', () => {
    const enabled = computeDefaultEnabledOpenRouterModelIds([
      { id: 'openai/gpt-1', releasedAt: '2024-01-01', type: 'chat' },
      { id: 'openai/gpt-2', releasedAt: '2024-06-01', type: 'chat' },
      { id: 'openai/gpt-3', releasedAt: '2025-01-01', type: 'chat' },
      { id: 'openai/gpt-4', releasedAt: '2025-06-01', type: 'chat' },
      { id: 'openai/gpt-5', releasedAt: '2025-12-01', type: 'chat' },
      { id: 'anthropic/claude-1', releasedAt: '2024-01-01', type: 'chat' },
      { id: 'anthropic/claude-2', releasedAt: '2024-06-01', type: 'chat' },
      { id: 'anthropic/claude-3', releasedAt: '2025-01-01', type: 'chat' },
      { id: 'anthropic/claude-4', releasedAt: '2025-06-01', type: 'chat' },
      { id: 'google/gemini-b', releasedAt: '2024-06-01', type: 'chat' },
      { id: 'google/gemini-c', releasedAt: '2025-01-01', type: 'chat' },
      { id: 'google/gemini-d', releasedAt: '2025-06-01', type: 'chat' },
      { id: 'google/gemini-e', releasedAt: '2025-12-01', type: 'chat' },
      { id: 'deepseek/deepseek-chat', releasedAt: '2026-01-01', type: 'chat' },
    ]);

    expect(enabled.has(OPENROUTER_AUTO_MODEL_ID)).toBe(true);
    expect(enabled.has('openai/gpt-5')).toBe(true);
    expect(enabled.has('openai/gpt-1')).toBe(false);
    expect(enabled.has('deepseek/deepseek-chat')).toBe(false);
  });

  it('pins Auto even when the catalog snapshot omits it', () => {
    const enabled = computeDefaultEnabledOpenRouterModelIds([
      { id: 'openai/gpt-4o', releasedAt: '2025-01-01', type: 'chat' },
    ]);
    expect(enabled.has(OPENROUTER_AUTO_MODEL_ID)).toBe(true);
  });

  it('pins Nano Banana Image-tab ids and :image siblings of default chat models', () => {
    const enabled = computeDefaultEnabledOpenRouterModelIds([
      { id: 'google/gemini-e', releasedAt: '2025-12-01', type: 'chat' },
      { id: 'google/gemini-e:image', type: 'image' },
      { id: 'google/gemini-3.1-flash-image-preview:image', type: 'image' },
      { id: 'google/gemini-2.5-flash-image:image', type: 'image' },
    ]);

    expect(enabled.has('google/gemini-e:image')).toBe(true);
    expect(enabled.has('google/gemini-3.1-flash-image-preview:image')).toBe(true);
    expect(enabled.has('google/gemini-2.5-flash-image:image')).toBe(true);
  });

  it('enables every catalog image and video generator, not only Nano Banana', () => {
    const enabled = computeDefaultEnabledOpenRouterModelIds([
      { id: 'openai/gpt-4o', releasedAt: '2025-01-01', type: 'chat' },
      { id: 'black-forest-labs/flux-2', type: 'image' },
      { id: 'openai/gpt-image-1:image', type: 'image' },
      { id: 'google/veo-3', type: 'video' },
      { id: 'deepseek/deepseek-chat', releasedAt: '2026-01-01', type: 'chat' },
    ]);

    expect(enabled.has('black-forest-labs/flux-2')).toBe(true);
    expect(enabled.has('openai/gpt-image-1:image')).toBe(true);
    expect(enabled.has('google/veo-3')).toBe(true);
    expect(enabled.has('deepseek/deepseek-chat')).toBe(false);
  });
});

describe('pickPreferredDefaultOpenRouterModelId', () => {
  it('prefers openrouter/auto over family models', () => {
    expect(
      pickPreferredDefaultOpenRouterModelId([
        'openai/gpt-4o',
        OPENROUTER_AUTO_MODEL_ID,
        'anthropic/claude-x',
      ]),
    ).toBe(OPENROUTER_AUTO_MODEL_ID);
  });
});

describe('ensureOpenRouterAutoModel', () => {
  it('injects Auto when missing', () => {
    const result = ensureOpenRouterAutoModel([{ id: 'openai/gpt-4o' }], {
      id: OPENROUTER_AUTO_MODEL_ID,
    });
    expect(result[0]?.id).toBe(OPENROUTER_AUTO_MODEL_ID);
    expect(result).toHaveLength(2);
  });

  it('does not duplicate Auto', () => {
    const result = ensureOpenRouterAutoModel([{ id: OPENROUTER_AUTO_MODEL_ID }], {
      id: OPENROUTER_AUTO_MODEL_ID,
    });
    expect(result).toHaveLength(1);
  });
});
