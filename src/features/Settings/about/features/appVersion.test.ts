import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/const/version', () => ({ CURRENT_VERSION: '2.2.14' }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('APP_VERSION', () => {
  it('prefers the injected build version over package metadata', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_VERSION', '2.2.16');
    expect((await import('./appVersion')).APP_VERSION).toBe('2.2.16');
  });

  it.each([undefined, ''])(
    'uses the package version without an injected value (%s)',
    async (value) => {
      vi.stubEnv('NEXT_PUBLIC_APP_VERSION', value);
      expect((await import('./appVersion')).APP_VERSION).toBe('2.2.14');
    },
  );

  it('keeps the desktop package version independent of the web build version', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_VERSION', '2.2.16');
    vi.stubGlobal('__MAIN_VERSION__', '2.2.15');
    expect((await import('./appVersion.desktop')).APP_VERSION).toBe('2.2.15');
  });
});
