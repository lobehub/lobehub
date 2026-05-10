// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TELEGRAM_INSTALLATION_KEY, TelegramInstallationStore } from './telegram';

vi.mock('@/config/messenger', () => ({
  getMessengerTelegramConfig: vi.fn(),
}));

const { getMessengerTelegramConfig } = await import('@/config/messenger');

const VALID_CONFIG = {
  botToken: 'tg-bot-token',
  botUsername: 'lobehub_bot',
  webhookSecret: 'tg-secret',
};

beforeEach(() => {
  vi.mocked(getMessengerTelegramConfig).mockResolvedValue(VALID_CONFIG as any);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('TelegramInstallationStore.resolveByPayload', () => {
  it('returns env-backed credentials regardless of payload', async () => {
    const store = new TelegramInstallationStore();
    const creds = await store.resolveByPayload();
    expect(creds).toMatchObject({
      applicationId: TELEGRAM_INSTALLATION_KEY,
      botToken: 'tg-bot-token',
      installationKey: TELEGRAM_INSTALLATION_KEY,
      platform: 'telegram',
      tenantId: '',
    });
    expect(creds?.metadata).toEqual({
      botUsername: 'lobehub_bot',
      webhookSecret: 'tg-secret',
    });
  });

  it('returns null when telegram is not configured', async () => {
    vi.mocked(getMessengerTelegramConfig).mockResolvedValueOnce(null);
    const store = new TelegramInstallationStore();
    expect(await store.resolveByPayload()).toBeNull();
  });

  it('falls back to empty strings for optional metadata fields', async () => {
    vi.mocked(getMessengerTelegramConfig).mockResolvedValueOnce({
      botToken: 'tg',
    } as any);
    const store = new TelegramInstallationStore();
    const creds = await store.resolveByPayload();
    expect(creds?.metadata).toEqual({ botUsername: '', webhookSecret: '' });
  });
});

describe('TelegramInstallationStore.resolveByKey', () => {
  it('returns the env-backed credentials when the key matches the singleton', async () => {
    const store = new TelegramInstallationStore();
    const creds = await store.resolveByKey(TELEGRAM_INSTALLATION_KEY);
    expect(creds?.botToken).toBe('tg-bot-token');
  });

  it('returns null for any other installation key', async () => {
    const store = new TelegramInstallationStore();
    expect(await store.resolveByKey('telegram:other')).toBeNull();
    expect(getMessengerTelegramConfig).not.toHaveBeenCalled();
  });
});
