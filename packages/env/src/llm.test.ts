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

describe('JZSTOKEN deployment credentials', () => {
  it('exposes the configured key to model runtime and enables the provider', () => {
    vi.stubEnv('JZSTOKEN_API_KEY', 'test-jzstoken-key');
    const config = getLLMConfig();

    expect(config.ENABLED_JZSTOKEN).toBe(true);
    expect(config.JZSTOKEN_API_KEY).toBe('test-jzstoken-key');
  });

  it.each([undefined, ''])('keeps JZSTOKEN disabled without a key (%s)', (key) => {
    vi.stubEnv('JZSTOKEN_API_KEY', key);
    expect(getLLMConfig().ENABLED_JZSTOKEN).toBe(false);
  });
});
