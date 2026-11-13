import { describe, expect, it } from 'vitest';

import {
  getContextCachingTTLOptions,
  getDefaultContextCachingTTL,
  isContextCachingTTLRequestable,
  resolveContextCachingTTL,
  resolveRequestContextCachingTTL,
} from './contextCachingTTL';

describe('contextCachingTTL', () => {
  describe('provider policy', () => {
    it('defaults Anthropic to 1h, DeepSeek to 72h and everything else to 5m', () => {
      expect(getDefaultContextCachingTTL('anthropic')).toBe('1h');
      expect(getDefaultContextCachingTTL('deepseek')).toBe('72h');
      expect(getDefaultContextCachingTTL('openai')).toBe('5m');
      expect(getDefaultContextCachingTTL('my-custom-proxy')).toBe('5m');
    });

    it('only lets Anthropic request a TTL, limited to what its API takes', () => {
      expect(isContextCachingTTLRequestable('anthropic')).toBe(true);
      expect(getContextCachingTTLOptions('anthropic')).toEqual(['5m', '1h']);
      // Anthropic-compatible endpoints don't document `cache_control.ttl`.
      for (const provider of ['bedrock', 'deepseek', 'openai', 'moonshot']) {
        expect(isContextCachingTTLRequestable(provider)).toBe(false);
        expect(getContextCachingTTLOptions(provider)).toEqual(['5m', '1h', '24h', '72h']);
      }
    });
  });

  describe('resolveContextCachingTTL', () => {
    it('uses the model setting when the provider can honour it', () => {
      expect(resolveContextCachingTTL({ provider: 'anthropic', ttl: '5m' })).toBe('5m');
      expect(resolveContextCachingTTL({ provider: 'anthropic', ttl: '1h' })).toBe('1h');
      expect(resolveContextCachingTTL({ provider: 'deepseek', ttl: '24h' })).toBe('24h');
      expect(resolveContextCachingTTL({ provider: 'openai', ttl: '24h' })).toBe('24h');
    });

    it('falls back to the provider default when unset or not requestable there', () => {
      expect(resolveContextCachingTTL({ provider: 'anthropic' })).toBe('1h');
      expect(resolveContextCachingTTL({ provider: 'anthropic', ttl: null })).toBe('1h');
      // Anthropic only takes 5m / 1h; a stored 72h must not reach the request.
      expect(resolveContextCachingTTL({ provider: 'anthropic', ttl: '72h' })).toBe('1h');
      expect(resolveContextCachingTTL({ provider: 'deepseek' })).toBe('72h');
      expect(resolveContextCachingTTL({ provider: 'openai', ttl: 'forever' })).toBe('5m');
    });

    it('applies no TTL when the agent turned context caching off', () => {
      expect(
        resolveContextCachingTTL({
          chatConfig: { disableContextCaching: true },
          modelExtendParams: ['disableContextCaching'],
          provider: 'anthropic',
          ttl: '1h',
        }),
      ).toBeUndefined();
      // The switch only counts for models that declare it.
      expect(
        resolveContextCachingTTL({
          chatConfig: { disableContextCaching: true },
          modelExtendParams: [],
          provider: 'anthropic',
        }),
      ).toBe('1h');
    });
  });

  describe('resolveRequestContextCachingTTL', () => {
    it('writes only a non-default TTL, only where the API takes one', () => {
      expect(resolveRequestContextCachingTTL('anthropic', '1h')).toBe('1h');
      // 5m is Anthropic's API default: nothing is written, keeping the payload byte-identical.
      expect(resolveRequestContextCachingTTL('anthropic', '5m')).toBeUndefined();
      expect(resolveRequestContextCachingTTL('anthropic', undefined)).toBeUndefined();
      // Elsewhere the TTL only informs context engineering.
      expect(resolveRequestContextCachingTTL('deepseek', '72h')).toBeUndefined();
      expect(resolveRequestContextCachingTTL('bedrock', '1h')).toBeUndefined();
    });
  });
});
