import { describe, expect, it } from 'vitest';

import {
  computeDefaultEnabledOpenRouterModelIds,
  pickPreferredDefaultOpenRouterModelId,
} from './openrouterDefaultModels';

describe('computeDefaultEnabledOpenRouterModelIds', () => {
  it('enables the newest 4 chat models per openai/anthropic/google family', () => {
    const enabled = computeDefaultEnabledOpenRouterModelIds([
      { id: 'openai/gpt-1', releasedAt: '2024-01-01', type: 'chat' },
      { id: 'openai/gpt-2', releasedAt: '2024-06-01', type: 'chat' },
      { id: 'openai/gpt-3', releasedAt: '2025-01-01', type: 'chat' },
      { id: 'openai/gpt-4', releasedAt: '2025-06-01', type: 'chat' },
      { id: 'openai/gpt-5', releasedAt: '2025-12-01', type: 'chat' },
      { id: 'anthropic/claude-old', releasedAt: '2023-01-01', type: 'chat' },
      { id: 'anthropic/claude-1', releasedAt: '2024-01-01', type: 'chat' },
      { id: 'anthropic/claude-2', releasedAt: '2024-06-01', type: 'chat' },
      { id: 'anthropic/claude-3', releasedAt: '2025-01-01', type: 'chat' },
      { id: 'anthropic/claude-4', releasedAt: '2025-06-01', type: 'chat' },
      { id: 'google/gemini-a', releasedAt: '2024-01-01', type: 'chat' },
      { id: 'google/gemini-b', releasedAt: '2024-06-01', type: 'chat' },
      { id: 'google/gemini-c', releasedAt: '2025-01-01', type: 'chat' },
      { id: 'google/gemini-d', releasedAt: '2025-06-01', type: 'chat' },
      { id: 'google/gemini-e', releasedAt: '2025-12-01', type: 'chat' },
      { id: 'deepseek/deepseek-chat', releasedAt: '2026-01-01', type: 'chat' },
      { id: 'openai/dall-e', releasedAt: '2026-01-01', type: 'image' },
    ]);

    expect(enabled).toEqual(
      new Set([
        'openai/gpt-5',
        'openai/gpt-4',
        'openai/gpt-3',
        'openai/gpt-2',
        'anthropic/claude-4',
        'anthropic/claude-3',
        'anthropic/claude-2',
        'anthropic/claude-1',
        'google/gemini-e',
        'google/gemini-d',
        'google/gemini-c',
        'google/gemini-b',
      ]),
    );
    expect(enabled.has('openai/gpt-1')).toBe(false);
    expect(enabled.has('deepseek/deepseek-chat')).toBe(false);
    expect(enabled.has('openai/dall-e')).toBe(false);
  });

  it('sorts missing releasedAt last and ties by id', () => {
    const enabled = computeDefaultEnabledOpenRouterModelIds(
      [
        { id: 'openai/z', type: 'chat' },
        { id: 'openai/a', releasedAt: '2025-01-01', type: 'chat' },
        { id: 'openai/b', releasedAt: '2025-01-01', type: 'chat' },
        { id: 'openai/c', releasedAt: '2024-01-01', type: 'chat' },
      ],
      3,
    );

    expect([...enabled]).toEqual(['openai/a', 'openai/b', 'openai/c']);
  });
});

describe('pickPreferredDefaultOpenRouterModelId', () => {
  it('prefers openai then anthropic then google using insertion order', () => {
    expect(
      pickPreferredDefaultOpenRouterModelId([
        'openai/gpt-new',
        'openai/gpt-old',
        'anthropic/claude-x',
        'google/gemini-x',
      ]),
    ).toBe('openai/gpt-new');
  });
});
