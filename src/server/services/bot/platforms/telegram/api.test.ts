import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TELEGRAM_API_BASE, TelegramApi, TelegramEditUnavailableError } from './api';

const BOT_TOKEN = 'test-bot-token';

const okResponse = (body: Record<string, unknown>) =>
  new Response(JSON.stringify({ ok: true, result: body }), {
    headers: { 'Content-Type': 'application/json' },
    status: 200,
  });

const telegramErrorResponse = (errorCode: number, description: string) =>
  new Response(JSON.stringify({ description, error_code: errorCode, ok: false }), {
    headers: { 'Content-Type': 'application/json' },
    status: 200,
  });

describe('TelegramApi HTML parse fallback', () => {
  let fetchSpy: any;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sendMessage retries without parse_mode when Telegram rejects HTML entities', async () => {
    fetchSpy
      .mockResolvedValueOnce(
        telegramErrorResponse(
          400,
          'Bad Request: can\'t parse entities: Can\'t find end tag corresponding to start tag "b"',
        ),
      )
      .mockResolvedValueOnce(okResponse({ message_id: 42 }));

    const api = new TelegramApi(BOT_TOKEN);
    const result = await api.sendMessage('chat-1', '<b>broken html and the answer is 42');

    expect(result).toEqual({ message_id: 42 });
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    const retryCall = fetchSpy.mock.calls[1];
    const retryBody = JSON.parse((retryCall[1] as RequestInit).body as string);
    // Plain-text retry: parse_mode absent and tags stripped from text
    expect(retryBody.parse_mode).toBeUndefined();
    expect(retryBody.text).not.toContain('<b>');
    expect(retryBody.text).toContain('the answer is 42');
  });

  it('editMessageText retries without parse_mode on HTML parse error', async () => {
    fetchSpy
      .mockResolvedValueOnce(
        telegramErrorResponse(400, "Bad Request: can't parse entities: Unsupported start tag"),
      )
      .mockResolvedValueOnce(okResponse({ message_id: 42 }));

    const api = new TelegramApi(BOT_TOKEN);
    await api.editMessageText('chat-1', 42, '<b>broken');

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const retryBody = JSON.parse((fetchSpy.mock.calls[1][1] as RequestInit).body as string);
    expect(retryBody.parse_mode).toBeUndefined();
    expect(retryBody.text).toBe('broken');
  });

  it('editMessageText still ignores "message is not modified"', async () => {
    fetchSpy.mockResolvedValueOnce(
      telegramErrorResponse(400, 'Bad Request: message is not modified'),
    );

    const api = new TelegramApi(BOT_TOKEN);
    await expect(api.editMessageText('chat-1', 42, 'same')).resolves.toBeUndefined();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('editMessageText throws TelegramEditUnavailableError when message cannot be edited', async () => {
    fetchSpy.mockResolvedValueOnce(
      telegramErrorResponse(400, 'Bad Request: message to edit not found'),
    );

    const api = new TelegramApi(BOT_TOKEN);
    await expect(api.editMessageText('chat-1', 42, 'updated')).rejects.toBeInstanceOf(
      TelegramEditUnavailableError,
    );
  });

  it('TELEGRAM_API_BASE is exported', () => {
    expect(TELEGRAM_API_BASE).toBe('https://api.telegram.org');
  });

  it('sendMessage refuses to call Telegram with empty text', async () => {
    const api = new TelegramApi(BOT_TOKEN);
    await expect(api.sendMessage('chat-1', '   \n\n  ')).rejects.toThrow(/text is empty/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('editMessageText refuses to call Telegram with empty text', async () => {
    const api = new TelegramApi(BOT_TOKEN);
    await expect(api.editMessageText('chat-1', 42, '\n')).rejects.toThrow(/text is empty/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('retries once on transient network errors (ETIMEDOUT)', async () => {
    // Simulates undici's "TypeError: fetch failed" wrapping an ETIMEDOUT cause —
    // exactly the shape we saw in the production log.
    const fetchFailed = Object.assign(new TypeError('fetch failed'), {
      cause: { code: 'ETIMEDOUT' },
    });
    fetchSpy
      .mockRejectedValueOnce(fetchFailed)
      .mockResolvedValueOnce(okResponse({ message_id: 99 }));

    const api = new TelegramApi(BOT_TOKEN);
    const result = await api.sendMessage('chat-1', 'hello');

    expect(result).toEqual({ message_id: 99 });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('does not retry on non-transient errors (e.g. logical 400)', async () => {
    fetchSpy.mockResolvedValueOnce(telegramErrorResponse(400, 'Bad Request: chat not found'));

    const api = new TelegramApi(BOT_TOKEN);
    await expect(api.sendMessage('chat-1', 'hello')).rejects.toThrow(/chat not found/);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('gives up after a single retry when the transient error persists', async () => {
    const fetchFailed = Object.assign(new TypeError('fetch failed'), {
      cause: { code: 'ETIMEDOUT' },
    });
    fetchSpy.mockRejectedValue(fetchFailed);

    const api = new TelegramApi(BOT_TOKEN);
    await expect(api.sendMessage('chat-1', 'hello')).rejects.toThrow(/fetch failed/);

    // Original attempt + 1 retry = 2; never escalates further.
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
