import { describe, expect, it } from 'vitest';

import { getChannelKind, getChannelVersion } from './channelKind';

describe('getChannelKind', () => {
  it('matches a client and its suffixed variants', () => {
    expect(getChannelKind('desktop')).toBe('desktop');
    expect(getChannelKind('desktop-dev')).toBe('desktop');
    expect(getChannelKind('cli')).toBe('cli');
  });

  it('ignores unknown or missing channels', () => {
    expect(getChannelKind('desktopish')).toBeUndefined();
    expect(getChannelKind('mobile')).toBeUndefined();
    expect(getChannelKind(null)).toBeUndefined();
  });
});

describe('getChannelVersion', () => {
  const metadata = { appVersion: '2.0.0', cliVersion: '0.0.60' };

  it('reads each client its own version from one merged registry row', () => {
    expect(getChannelVersion('desktop', metadata)).toBe('2.0.0');
    expect(getChannelVersion('cli', metadata)).toBe('0.0.60');
  });

  it('prefers the desktop app live answer over the registry', () => {
    expect(getChannelVersion('desktop', metadata, '2.1.0')).toBe('2.1.0');
    expect(getChannelVersion('cli', metadata, '2.1.0')).toBe('0.0.60');
  });

  it('returns nothing when the client never reported a version', () => {
    expect(getChannelVersion('cli', { appVersion: '2.0.0' })).toBeUndefined();
    expect(getChannelVersion(undefined, metadata)).toBeUndefined();
    expect(getChannelVersion('desktop', null)).toBeUndefined();
  });
});
