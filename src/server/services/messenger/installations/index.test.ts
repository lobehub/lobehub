// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { getInstallationStore } from './index';

vi.mock('./slack', () => ({
  SlackInstallationStore: vi.fn().mockImplementation(() => ({ kind: 'slack' })),
}));

vi.mock('./telegram', () => ({
  TELEGRAM_INSTALLATION_KEY: 'telegram:singleton',
  TelegramInstallationStore: vi.fn().mockImplementation(() => ({ kind: 'telegram' })),
}));

vi.mock('./discord', () => ({
  DISCORD_INSTALLATION_KEY: 'discord:singleton',
  DiscordInstallationStore: vi.fn().mockImplementation(() => ({ kind: 'discord' })),
}));

describe('getInstallationStore', () => {
  it('returns the slack store for platform=slack', () => {
    const store = getInstallationStore('slack');
    expect(store).toEqual({ kind: 'slack' });
  });

  it('returns the telegram store for platform=telegram', () => {
    const store = getInstallationStore('telegram');
    expect(store).toEqual({ kind: 'telegram' });
  });

  it('returns the discord store for platform=discord', () => {
    const store = getInstallationStore('discord');
    expect(store).toEqual({ kind: 'discord' });
  });

  it('memoizes the store across calls (one instance per process)', async () => {
    const a = getInstallationStore('slack');
    const b = getInstallationStore('slack');
    expect(a).toBe(b);
  });

  it('returns null for an unknown platform', () => {
    expect(getInstallationStore('unknown' as any)).toBeNull();
  });
});
