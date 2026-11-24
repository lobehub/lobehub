import { describe, expect, it } from 'vitest';

import { detectPlatform, orderDownloadPlatforms } from './orderDownloadPlatforms';

const MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
const WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
const LINUX = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0';

const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36';

const BOTH = { macOS: 'https://example.com/app.dmg', windows: 'https://example.com/setup.exe' };

describe('detectPlatform', () => {
  it.each([
    ['macOS', MAC],
    ['windows', WINDOWS],
    ['linux', LINUX],
  ])('recognises %s', (expected, ua) => {
    expect(detectPlatform(ua)).toBe(expected);
  });

  it('gives up rather than guessing on anything else', () => {
    expect(detectPlatform(ANDROID)).toBeUndefined();
    expect(detectPlatform('')).toBeUndefined();
  });
});

describe('orderDownloadPlatforms', () => {
  it('puts the visitor’s own platform first', () => {
    // The first button is the one people click, so a Mac user should not have
    // to read past a .exe to find theirs.
    expect(orderDownloadPlatforms(BOTH, MAC)).toEqual(['macOS', 'windows']);
    expect(orderDownloadPlatforms(BOTH, WINDOWS)).toEqual(['windows', 'macOS']);
  });

  it('falls back to a stable order when the platform is unknown', () => {
    expect(orderDownloadPlatforms(BOTH, ANDROID)).toEqual(['windows', 'macOS']);
  });

  it('puts the Linux package first for a Linux visitor', () => {
    const all = { ...BOTH, linux: 'https://example.com/app.deb' };
    expect(orderDownloadPlatforms(all, LINUX)).toEqual(['linux', 'windows', 'macOS']);
    expect(orderDownloadPlatforms(all, MAC)).toEqual(['macOS', 'windows', 'linux']);
  });

  it('lists only what this deployment actually publishes', () => {
    expect(orderDownloadPlatforms({ windows: 'https://example.com/setup.exe' }, MAC)).toEqual([
      'windows',
    ]);
  });

  it('does not promote a platform that has no build', () => {
    // A Mac visitor with only a Windows build configured still gets Windows —
    // promoting macOS would mean surfacing a link that does not exist.
    expect(orderDownloadPlatforms({ windows: 'https://example.com/setup.exe' }, MAC)).not.toContain(
      'macOS',
    );
  });

  it('returns nothing when nothing is configured', () => {
    expect(orderDownloadPlatforms({}, MAC)).toEqual([]);
  });
});
