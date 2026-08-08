import { describe, expect, it } from 'vitest';

import {
  OPENROUTER_AUTO_MODEL_ID,
  computeDefaultEnabledOpenRouterModelIds,
  ensureOpenRouterAutoModel,
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
