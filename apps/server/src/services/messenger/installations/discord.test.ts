// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DISCORD_INSTALLATION_KEY, DiscordInstallationStore } from './discord';

vi.mock('@/config/messenger', () => ({
  getMessengerDiscordConfig: vi.fn(),
}));

const { getMessengerDiscordConfig } = await import('@/config/messenger');

const VALID_CONFIG = {
  applicationId: 'app-1',
  botToken: 'discord-bot-token',
  publicKey: 'pk',
};

beforeEach(() => {
  vi.mocked(getMessengerDiscordConfig).mockResolvedValue(VALID_CONFIG as any);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('DiscordInstallationStore.resolveByPayload', () => {
  it('returns env-backed credentials with the publicKey in metadata', async () => {
    const store = new DiscordInstallationStore();
    const creds = await store.resolveByPayload();
    expect(creds).toMatchObject({
      accountId: 'app-1',
      applicationId: 'app-1',
      botToken: 'discord-bot-token',
      installationKey: DISCORD_INSTALLATION_KEY,
      platform: 'discord',
      tenantId: '',
    });
    expect(creds?.metadata).toEqual({ publicKey: 'pk' });
  });

  it('returns null when discord is not configured', async () => {
    vi.mocked(getMessengerDiscordConfig).mockResolvedValueOnce(null);
    const store = new DiscordInstallationStore();
    expect(await store.resolveByPayload()).toBeNull();
  });
});

describe('DiscordInstallationStore.resolveByKey', () => {
  it('returns credentials when the key matches the singleton', async () => {
    const store = new DiscordInstallationStore();
    const creds = await store.resolveByKey(DISCORD_INSTALLATION_KEY);
    expect(creds?.botToken).toBe('discord-bot-token');
  });

  it('returns null for any other installation key', async () => {
    const store = new DiscordInstallationStore();
    expect(await store.resolveByKey('discord:other')).toBeNull();
    expect(getMessengerDiscordConfig).not.toHaveBeenCalled();
  });
});
