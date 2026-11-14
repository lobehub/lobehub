// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getLLMConfig } from './llm';

afterEach(() => vi.unstubAllEnvs());

describe('TypeSafe deployment credentials', () => {
  it('exposes the configured key to model runtime and enables the provider', () => {
    vi.stubEnv('TYPESAFE_API_KEY', 'test-typesafe-key');
    const config = getLLMConfig();
    expect(config.ENABLED_TYPESAFE).toBe(true);
    expect(config.TYPESAFE_API_KEY).toBe('test-typesafe-key');
  });

  it.each([undefined, ''])('keeps TypeSafe disabled without a key (%s)', (key) => {
    vi.stubEnv('TYPESAFE_API_KEY', key);
    expect(getLLMConfig().ENABLED_TYPESAFE).toBe(false);
  });
});

describe('fal credentials', () => {
  it('reads FAL_API_KEY', () => {
    vi.stubEnv('FAL_API_KEY', 'fal-api-key');
    vi.stubEnv('FAL_KEY', 'fal-sdk-key');
    expect(getLLMConfig().FAL_API_KEY).toBe('fal-api-key');
  });

  it('falls back to FAL_KEY, the name fal SDKs use', () => {
    vi.stubEnv('FAL_API_KEY', '');
    vi.stubEnv('FAL_KEY', 'fal-sdk-key');
    expect(getLLMConfig().FAL_API_KEY).toBe('fal-sdk-key');
  });
});
