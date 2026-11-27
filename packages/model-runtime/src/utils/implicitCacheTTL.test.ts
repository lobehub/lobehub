import { describe, expect, it } from 'vitest';

import { resolveImplicitCacheTTLSeconds } from './implicitCacheTTL';

describe('resolveImplicitCacheTTLSeconds', () => {
  it.each([
    ['gpt-6.2-sol', 3600],
    ['openai/gpt-5', 3600],
    ['o4-mini', 3600],
    ['kimi-k3', 300],
    ['GLM-5.2', 1800],
    ['gemini-3-pro', 1800],
  ])('resolves %s to %i seconds', (model, ttlSeconds) => {
    expect(resolveImplicitCacheTTLSeconds(model)).toBe(ttlSeconds);
  });

  it.each(['claude-fable-5', 'deepseek-v4', 'MiniMax-M3', 'my-azure-deployment'])(
    'knows no lifetime for %s',
    (model) => {
      expect(resolveImplicitCacheTTLSeconds(model)).toBeUndefined();
    },
  );
});
