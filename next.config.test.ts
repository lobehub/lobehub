import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('code-inspector-plugin', () => ({
  codeInspectorPlugin: vi.fn(() => ({})),
}));

describe('next.config', () => {
  const originalVercelEnv = process.env.VERCEL_ENV;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (originalVercelEnv === undefined) {
      delete process.env.VERCEL_ENV;
    } else {
      process.env.VERCEL_ENV = originalVercelEnv;
    }
  });

  it('should not add turbopack-only memory config for vercel webpack builds', async () => {
    process.env.VERCEL_ENV = 'production';

    const { default: config } = await import('./next.config');

    expect(config.experimental?.turbopackMemoryLimit).toBeUndefined();
  });
});
