import { afterEach, describe, expect, it } from 'vitest';

import { normalizeUrl, resolveServerUrl } from './index';

describe('settings helpers', () => {
  const originalServer = process.env.LOBEHUB_SERVER;

  afterEach(() => {
    process.env.LOBEHUB_SERVER = originalServer;
  });

  it('normalizes trailing slashes', () => {
    expect(normalizeUrl('https://self-hosted.example.com/')).toBe(
      'https://self-hosted.example.com',
    );
    expect(normalizeUrl(undefined)).toBeUndefined();
  });

  it('prefers LOBEHUB_SERVER when requested', () => {
    process.env.LOBEHUB_SERVER = 'https://env.example.com/';

    expect(
      resolveServerUrl({
        preferEnv: true,
        settings: { serverUrl: 'https://settings.example.com' },
      }),
    ).toBe('https://env.example.com');
  });

  it('falls back to settings then official server', () => {
    delete process.env.LOBEHUB_SERVER;

    expect(resolveServerUrl({ settings: { serverUrl: 'https://settings.example.com/' } })).toBe(
      'https://settings.example.com',
    );
    expect(resolveServerUrl({ settings: null })).toBe('https://app.lobehub.com');
  });
});
