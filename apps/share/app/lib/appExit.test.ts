import { describe, expect, it } from 'vitest';

import { buildAppExitUrl } from './appExit';

describe('buildAppExitUrl', () => {
  it('preserves path and query when exiting to the app home', () => {
    expect(
      buildAppExitUrl(
        'http://localhost:3017/signin?callbackUrl=%2Fshare%2Fa%2Fabc',
        'https://lobehub.com',
      ),
    ).toBe('https://lobehub.com/signin?callbackUrl=%2Fshare%2Fa%2Fabc');
  });

  it('falls back to the production home origin without SHARE_APP_HOME', () => {
    expect(buildAppExitUrl('http://localhost:3017/agent/agt_123')).toBe(
      'https://lobehub.com/agent/agt_123',
    );
  });

  it('supports an app home on a custom origin for local development', () => {
    expect(buildAppExitUrl('http://localhost:3017/signin', 'http://localhost:3020')).toBe(
      'http://localhost:3020/signin',
    );
  });
});
