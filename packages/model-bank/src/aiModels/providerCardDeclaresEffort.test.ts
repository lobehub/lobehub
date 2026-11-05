import { describe, expect, it } from 'vitest';

import { providerCardDeclaresEffort } from './index';

describe('providerCardDeclaresEffort', () => {
  it('is true for a bundled card that declares an effort spec', () => {
    expect(providerCardDeclaresEffort('google', 'gemini-3.1-pro-preview')).toBe(true);
  });

  it('is false for a bundled card without an effort spec', () => {
    expect(providerCardDeclaresEffort('openrouter', 'openai/o3-mini')).toBe(false);
  });

  it('is false for a model without a bundled card', () => {
    expect(providerCardDeclaresEffort('my-provider', 'remote-model')).toBe(false);
  });

  it('is true for LobeHub, whose cards are managed server-side', () => {
    expect(providerCardDeclaresEffort('lobehub', 'any-model')).toBe(true);
  });
});
