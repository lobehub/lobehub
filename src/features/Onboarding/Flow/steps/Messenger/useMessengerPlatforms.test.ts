import { describe, expect, it } from 'vitest';

import {
  buildMessengerPlatformRows,
  resolveMessengerPlatformsLoading,
} from './useMessengerPlatforms';

describe('buildMessengerPlatformRows', () => {
  it('orders rows as slack, telegram, discord and drops platforms the server does not report', () => {
    const rows = buildMessengerPlatformRows(
      [{ id: 'discord' }, { id: 'slack' }, { id: 'telegram', botUsername: 'lobehub_bot' }] as any,
      [],
      [],
    );

    expect(rows.map((row) => row.id)).toEqual(['slack', 'telegram', 'discord']);
  });

  it('marks a platform connected when an installation exists for it', () => {
    const rows = buildMessengerPlatformRows(
      [{ id: 'slack' }] as any,
      [{ platform: 'slack' }] as any,
      [],
    );

    expect(rows[0]).toMatchObject({ connected: true, href: '/api/agent/messenger/slack/install' });
  });

  it('marks a platform connected when a link exists for it (telegram)', () => {
    const rows = buildMessengerPlatformRows(
      [{ botUsername: 'lobehub_bot', id: 'telegram' }] as any,
      [],
      [{ platform: 'telegram' }] as any,
    );

    expect(rows[0]).toMatchObject({
      connected: true,
      href: 'https://t.me/lobehub_bot?start=messenger',
    });
  });

  it('leaves a telegram row without an href when the bot username is missing', () => {
    const rows = buildMessengerPlatformRows([{ id: 'telegram' }] as any, [], []);

    expect(rows[0]).toMatchObject({ connected: false, href: undefined });
  });

  it('returns an empty list when the server reports no platforms', () => {
    expect(buildMessengerPlatformRows(undefined, undefined, undefined)).toEqual([]);
  });
});

describe('resolveMessengerPlatformsLoading', () => {
  it('is loading while any of the three sources is still loading', () => {
    expect(resolveMessengerPlatformsLoading(true, false, false)).toBe(true);
    expect(resolveMessengerPlatformsLoading(false, true, false)).toBe(true);
    expect(resolveMessengerPlatformsLoading(false, false, true)).toBe(true);
  });

  it('is not loading once platforms, installations, and links have all resolved', () => {
    expect(resolveMessengerPlatformsLoading(false, false, false)).toBe(false);
  });
});
