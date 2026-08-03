import { describe, expect, it } from 'vitest';

import { isFreeAiModel } from './aiModel';

describe('isFreeAiModel', () => {
  it('detects :free in model id', () => {
    expect(isFreeAiModel({ id: 'meta-llama/llama-3.3-70b-instruct:free' })).toBe(true);
  });

  it('detects (free) in display name', () => {
    expect(isFreeAiModel({ displayName: 'Gemma 2 9B (free)', id: 'google/gemma-2-9b-it' })).toBe(
      true,
    );
  });

  it('is case-insensitive for (free) in display name', () => {
    expect(isFreeAiModel({ displayName: 'Gemma 2 9B (Free)', id: 'google/gemma-2-9b-it' })).toBe(
      true,
    );
  });

  it('returns false for paid models', () => {
    expect(isFreeAiModel({ displayName: 'GPT-4o', id: 'openai/gpt-4o' })).toBe(false);
  });
});
