import { describe, expect, it } from 'vitest';

import { resolveDesktopDownload } from './resolveDesktopDownload';

const HOSTED = 'https://lobehub.com/downloads';

describe('resolveDesktopDownload', () => {
  it('sends users to this deployment’s own page when it publishes installers', () => {
    expect(
      resolveDesktopDownload({
        fallbackUrl: HOSTED,
        isCustomBranding: true,
        urls: { windows: 'https://example.com/releases/stable/Setup.exe' },
      }),
    ).toEqual({ available: true, href: '/downloads' });
  });

  it('needs only one platform to be configured', () => {
    expect(
      resolveDesktopDownload({
        fallbackUrl: HOSTED,
        isCustomBranding: false,
        urls: { macOS: 'https://example.com/releases/stable/Setup.dmg' },
      }).href,
    ).toBe('/downloads');
  });

  it('counts a Linux-only build as publishing installers', () => {
    expect(
      resolveDesktopDownload({
        fallbackUrl: HOSTED,
        isCustomBranding: true,
        urls: { linux: 'https://example.com/releases/stable/app.deb' },
      }),
    ).toEqual({ available: true, href: '/downloads' });
  });

  it('leaves an upstream build pointing at the hosted page', () => {
    expect(resolveDesktopDownload({ fallbackUrl: HOSTED, isCustomBranding: false })).toEqual({
      available: true,
      href: HOSTED,
    });
  });

  it('offers nothing on a rebranded build with no downloads configured', () => {
    // The case this function exists for: falling through to the hosted page
    // here is what sent users to a different product's installer.
    expect(resolveDesktopDownload({ fallbackUrl: HOSTED, isCustomBranding: true })).toEqual({
      available: false,
    });
  });

  it('treats an empty urls object as nothing configured', () => {
    // The server omits the field entirely when unset, but a deployment that
    // sets the variables to blank strings must not read as "configured".
    expect(
      resolveDesktopDownload({ fallbackUrl: HOSTED, isCustomBranding: true, urls: {} }),
    ).toEqual({ available: false });
  });

  it('links to the platform downloads page, not the tenant one', () => {
    // `/downloads` is a public platform page; under `/orgs/{slug}` it sits
    // behind tenant sign-in, so a signed-out visitor never sees the installers.
    expect(
      resolveDesktopDownload({
        appBaseUrl: 'https://app.example.com/orgs/acme',
        fallbackUrl: HOSTED,
        isCustomBranding: true,
        urls: { windows: 'https://example.com/releases/stable/Setup.exe' },
      }),
    ).toEqual({ available: true, href: 'https://app.example.com/downloads' });
  });

  it('tolerates a trailing slash on the app address', () => {
    expect(
      resolveDesktopDownload({
        appBaseUrl: 'https://app.example.com/',
        fallbackUrl: HOSTED,
        isCustomBranding: true,
        urls: { macOS: 'https://example.com/releases/stable/Setup.dmg' },
      }).href,
    ).toBe('https://app.example.com/downloads');
  });

  it('does not put a tenant address on the hosted fallback', () => {
    expect(
      resolveDesktopDownload({
        appBaseUrl: 'https://app.example.com/orgs/acme',
        fallbackUrl: HOSTED,
        isCustomBranding: false,
      }).href,
    ).toBe(HOSTED);
  });
});
