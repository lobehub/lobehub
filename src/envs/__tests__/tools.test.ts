// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env = { ...originalEnv };
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('getToolsConfig', () => {
  it('should accept valid browserless waitUntil and crawler timeout values', async () => {
    process.env.BROWSERLESS_WAIT_UNTIL = 'domcontentloaded';
    process.env.CRAWLER_TIMEOUT = '15000';

    const { getToolsConfig } = await import('../tools');
    const config = getToolsConfig();

    expect(config.BROWSERLESS_WAIT_UNTIL).toBe('domcontentloaded');
    expect(config.CRAWLER_TIMEOUT).toBe(15000);
  });

  it('should reject invalid BROWSERLESS_WAIT_UNTIL values', async () => {
    process.env.BROWSERLESS_WAIT_UNTIL = 'interactive';

    await expect(import('../tools')).rejects.toThrow();
  });

  it('should reject too-small CRAWLER_TIMEOUT values', async () => {
    process.env.CRAWLER_TIMEOUT = '999';

    await expect(import('../tools')).rejects.toThrow();
  });
});
