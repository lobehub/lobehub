import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  deriveTelegramWebhookSecret,
  extractBotId,
  resolveTelegramSecretToken,
  setTelegramWebhook,
} from './helpers';

const BOT_TOKEN = '8654315085:AAH-fake-token-for-tests';

describe('extractBotId', () => {
  it('returns the numeric prefix of a bot token', () => {
    expect(extractBotId(BOT_TOKEN)).toBe('8654315085');
  });
});

describe('deriveTelegramWebhookSecret', () => {
  it('is deterministic for the same token and key', () => {
    expect(deriveTelegramWebhookSecret(BOT_TOKEN, 'k1')).toBe(
      deriveTelegramWebhookSecret(BOT_TOKEN, 'k1'),
    );
  });

  it('changes with the bot token and with the server key', () => {
    const base = deriveTelegramWebhookSecret(BOT_TOKEN, 'k1');
    expect(deriveTelegramWebhookSecret('1:other', 'k1')).not.toBe(base);
    expect(deriveTelegramWebhookSecret(BOT_TOKEN, 'k2')).not.toBe(base);
  });

  it('falls back to a fixed salt when no server key is configured', () => {
    expect(deriveTelegramWebhookSecret(BOT_TOKEN, undefined)).toBe(
      deriveTelegramWebhookSecret(BOT_TOKEN, ''),
    );
    expect(deriveTelegramWebhookSecret(BOT_TOKEN, undefined)).not.toBe(
      deriveTelegramWebhookSecret(BOT_TOKEN, 'k1'),
    );
  });

  it('produces a value Telegram accepts as secret_token (1-256 chars of A-Za-z0-9_-)', () => {
    const secret = deriveTelegramWebhookSecret(BOT_TOKEN, 'k1');
    expect(secret).toMatch(/^[\w-]{1,256}$/);
    expect(secret).toHaveLength(43);
  });
});

describe('resolveTelegramSecretToken', () => {
  it('prefers the operator-provided secret', () => {
    expect(resolveTelegramSecretToken({ botToken: BOT_TOKEN, secretToken: ' my-secret ' })).toBe(
      'my-secret',
    );
  });

  it('derives a secret when the field is missing or blank — never returns empty', () => {
    const derived = resolveTelegramSecretToken({ botToken: BOT_TOKEN });
    expect(derived).toMatch(/^[\w-]{43}$/);
    expect(resolveTelegramSecretToken({ botToken: BOT_TOKEN, secretToken: '' })).toBe(derived);
    expect(resolveTelegramSecretToken({ botToken: BOT_TOKEN, secretToken: '   ' })).toBe(derived);
  });
});

describe('setTelegramWebhook', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('always sends secret_token together with the webhook url and allowed_updates', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await setTelegramWebhook(
      BOT_TOKEN,
      'https://cloud.example/api/agent/webhooks/telegram/1',
      's3cret',
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`);
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({
      secret_token: 's3cret',
      url: 'https://cloud.example/api/agent/webhooks/telegram/1',
    });
    expect(body.allowed_updates).toContain('message');
  });

  it('throws with the Telegram error body when the call fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{"ok":false}', { status: 401 })),
    );

    await expect(setTelegramWebhook(BOT_TOKEN, 'https://x', 's')).rejects.toThrow(
      'Failed to set Telegram webhook: 401',
    );
  });
});
