import { describe, expect, it } from 'vitest';

import { resolveMessengerInstallHref } from './installHref';

describe('resolveMessengerInstallHref', () => {
  it('builds an absolute install URL against the app origin on web', () => {
    expect(resolveMessengerInstallHref('discord', 'https://lobehub.com')).toBe(
      'https://lobehub.com/api/agent/messenger/discord/install',
    );
  });

  it('builds against the desktop remote server URL and tolerates trailing slashes', () => {
    expect(resolveMessengerInstallHref('slack', 'https://app.lobehub.com/')).toBe(
      'https://app.lobehub.com/api/agent/messenger/slack/install',
    );
  });

  it('returns undefined while the origin is not resolved yet', () => {
    expect(resolveMessengerInstallHref('discord', undefined)).toBeUndefined();
    expect(resolveMessengerInstallHref('discord', '')).toBeUndefined();
  });
});
