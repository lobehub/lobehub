import { afterEach, describe, expect, it, vi } from 'vitest';

import { dev, linux, macOS, windows } from './platform';

describe('platform detection', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('honors an explicit development override', () => {
    vi.stubEnv('ELECTRON_IS_DEV', '1');
    expect(dev()).toBe(true);

    vi.stubEnv('ELECTRON_IS_DEV', '0');
    expect(dev()).toBe(false);
  });

  it('reports exactly one current operating system', () => {
    expect([linux(), macOS(), windows()].filter(Boolean)).toHaveLength(1);
  });
});
