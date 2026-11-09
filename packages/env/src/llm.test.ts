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

describe('Ace Data Cloud deployment credentials', () => {
  it('exposes an explicit Ace application key through the generic provider binding', () => {
    vi.stubEnv('ACEDATACLOUD_API_KEY', 'dummy-ace-key');
    const config = getLLMConfig();
    expect(config.ENABLED_ACEDATACLOUD).toBe(true);
    expect(config.ACEDATACLOUD_API_KEY).toBe('dummy-ace-key');
  });

  it.each([undefined, ''])('does not enable the server provider without a key (%s)', (key) => {
    vi.stubEnv('ACEDATACLOUD_API_KEY', key);
    expect(getLLMConfig().ENABLED_ACEDATACLOUD).toBe(false);
  });
});
