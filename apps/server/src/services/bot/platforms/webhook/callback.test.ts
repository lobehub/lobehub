// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { postSignedWebhook } = vi.hoisted(() => ({ postSignedWebhook: vi.fn() }));

vi.mock('@/server/services/developerWebhook/send', () => ({ postSignedWebhook }));

const { BOT_WEBHOOK_CALLBACK_ATTEMPTS, BotWebhookCallbackError, sendBotWebhookEvent } =
  await import('./callback');

const TARGET = { botId: 'b', callbackUrl: 'https://example.com/cb', signingSecret: 's'.repeat(40) };

const result = (responseStatus: number | null, extra: Record<string, unknown> = {}) => ({
  durationMs: 1,
  error: responseStatus && responseStatus < 300 ? null : `HTTP ${responseStatus}`,
  permanent: false,
  responseBody: null,
  responseStatus,
  ...extra,
});

beforeEach(() => {
  postSignedWebhook.mockReset();
  vi.useFakeTimers();
});

const run = async () => {
  const promise = sendBotWebhookEvent(TARGET, 'bot.ping', { message: 'x' });
  promise.catch(() => {});
  await vi.runAllTimersAsync();
  return promise;
};

describe('sendBotWebhookEvent', () => {
  it('retries a 5xx with the same event id, then succeeds', async () => {
    postSignedWebhook.mockResolvedValueOnce(result(503)).mockResolvedValueOnce(result(200));

    const { event } = await run();

    expect(postSignedWebhook).toHaveBeenCalledTimes(2);
    const ids = postSignedWebhook.mock.calls.map(([req]) => req.headers['X-LobeHub-Event-Id']);
    expect(ids).toEqual([event.id, event.id]);
    const deliveries = postSignedWebhook.mock.calls.map(
      ([req]) => req.headers['X-LobeHub-Delivery-Id'],
    );
    expect(deliveries).toEqual([`${event.id}.1`, `${event.id}.2`]);
  });

  it('gives up after the attempt budget and throws', async () => {
    postSignedWebhook.mockResolvedValue(result(null, { error: 'ECONNRESET' }));

    await expect(run()).rejects.toBeInstanceOf(BotWebhookCallbackError);
    expect(postSignedWebhook).toHaveBeenCalledTimes(BOT_WEBHOOK_CALLBACK_ATTEMPTS);
  });

  it('makes a single attempt when asked to (interactive connection test)', async () => {
    postSignedWebhook.mockResolvedValue(result(503));

    const promise = sendBotWebhookEvent(TARGET, 'bot.ping', { message: 'x' }, { attempts: 1 });
    promise.catch(() => {});
    await vi.runAllTimersAsync();

    await expect(promise).rejects.toBeInstanceOf(BotWebhookCallbackError);
    expect(postSignedWebhook).toHaveBeenCalledTimes(1);
  });

  it('does not retry an address the SSRF guard blocked', async () => {
    postSignedWebhook.mockResolvedValue(
      result(null, {
        error: 'Blocked: the URL resolves to a private or reserved address',
        permanent: true,
      }),
    );

    await expect(run()).rejects.toThrow('private or reserved address');
    expect(postSignedWebhook).toHaveBeenCalledTimes(1);
  });
});
