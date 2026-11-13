import { describe, expect, it } from 'vitest';

import { getContextCachingTTLState } from '../contextCachingTTLState';

describe('getContextCachingTTLState', () => {
  it('offers only the TTLs Anthropic can request, with 1h in effect by default', () => {
    expect(getContextCachingTTLState('anthropic')).toEqual({
      defaultTTL: '1h',
      effectiveTTL: '1h',
      isDefault: true,
      options: ['5m', '1h'],
      requestable: true,
    });
  });

  it('shows a picked value as the one in effect', () => {
    expect(getContextCachingTTLState('anthropic', '5m')).toMatchObject({
      effectiveTTL: '5m',
      isDefault: false,
    });
  });

  it('labels a stored value the provider cannot request with the default it falls back to', () => {
    expect(getContextCachingTTLState('anthropic', '72h')).toMatchObject({
      effectiveTTL: '1h',
      isDefault: true,
    });
  });

  it('offers every duration for automatic caches, DeepSeek defaulting to 72h', () => {
    expect(getContextCachingTTLState('deepseek')).toEqual({
      defaultTTL: '72h',
      effectiveTTL: '72h',
      isDefault: true,
      options: ['5m', '1h', '24h', '72h'],
      requestable: false,
    });
    expect(getContextCachingTTLState('openai', '24h')).toMatchObject({
      defaultTTL: '5m',
      effectiveTTL: '24h',
      isDefault: false,
    });
  });
});
