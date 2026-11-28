import { describe, expect, it } from 'vitest';

import { isEmbeddedAuth } from './embedded';

describe('isEmbeddedAuth', () => {
  it('detects the Lobot sign-in window by its user agent token', () => {
    expect(
      isEmbeddedAuth(
        'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/142.0 Electron/39.0 Safari/537.36 LobotAuthWindow',
      ),
    ).toBe(true);
  });

  it('treats browsers and other Electron apps as the website', () => {
    expect(isEmbeddedAuth('Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/142.0')).toBe(false);
    expect(isEmbeddedAuth('Mozilla/5.0 Chrome/142.0 Electron/39.0 lobot/0.0.67')).toBe(false);
  });
});
