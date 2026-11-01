import { describe, expect, it } from 'vitest';

import { claudeModelPrice, codexModelPrice } from '../pricing';

describe('claudeModelPrice', () => {
  it('reads both cache-write TTL prices from a ttl lookup', () => {
    expect(claudeModelPrice('claude-fable-5-1')).toEqual({
      cacheRead: 0.25,
      cacheWrite1h: 20,
      cacheWrite5m: 12.5,
      input: 10,
      output: 50,
    });
  });

  it('returns null for a model the bank does not list', () => {
    expect(claudeModelPrice('claude-unknown')).toBeNull();
  });
});

describe('codexModelPrice', () => {
  it('leaves cache-write rates undefined for OpenAI models', () => {
    const price = codexModelPrice('gpt-6.1-sol');

    expect(price?.cacheWrite1h).toBeUndefined();
    expect(price?.cacheWrite5m).toBeUndefined();
  });
});
