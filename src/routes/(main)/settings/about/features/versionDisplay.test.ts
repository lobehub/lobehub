import { describe, expect, it } from 'vitest';

import { getDisplayVersion } from './versionDisplay';

describe('getDisplayVersion', () => {
  it('should prefer the actual desktop app version when it is available', () => {
    expect(
      getDisplayVersion({
        desktopAppVersion: '12.1.1-canary.32',
        webVersion: '2.1.43',
      }),
    ).toBe('12.1.1-canary.32');
  });

  it('should fall back to the web version when desktop version is unavailable', () => {
    expect(
      getDisplayVersion({
        desktopAppVersion: null,
        webVersion: '2.1.43',
      }),
    ).toBe('2.1.43');
  });

  it('should ignore blank desktop versions and use the web version instead', () => {
    expect(
      getDisplayVersion({
        desktopAppVersion: '   ',
        webVersion: '2.1.43',
      }),
    ).toBe('2.1.43');
  });
});
