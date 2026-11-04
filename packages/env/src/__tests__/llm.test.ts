import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getLLMConfig } from '../llm';

beforeEach(() => {
  vi.stubEnv('FIKRA_API_KEY', undefined);
});
afterEach(() => vi.unstubAllEnvs());

const enable = () => {
  vi.stubEnv('FIKRA_API_KEY', 'fi-test-key-0000');
};

describe('FIKRA API key env → getLLMConfig', () => {
  it('is disabled by default', () => {
    const config = getLLMConfig();
    expect(config.ENABLED_FIKRA).toBe(false);
    expect(config.FIKRA_API_KEY).toBeUndefined();
  });

  it('enables Fikra and passes the key through when FIKRA_API_KEY is set', () => {
    enable();
    const config = getLLMConfig();
    expect(config.ENABLED_FIKRA).toBe(true);
    expect(config.FIKRA_API_KEY).toBe('fi-test-key-0000');
  });
});
