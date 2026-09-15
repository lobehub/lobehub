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

  it('sendPhoto retries caption without parse_mode on HTML parse error', async () => {
    fetchSpy
      .mockResolvedValueOnce(
        telegramErrorResponse(
          400,
          'Bad Request: can\'t parse entities: Unsupported start tag "foo" at byte offset 5',
        ),
      )
      .mockResolvedValueOnce(okResponse({ message_id: 7 }));

    const api = new TelegramApi(BOT_TOKEN);
    const result = await api.sendPhoto({
      caption: 'look at <foo> & the answer is 42',
      chatId: 'chat-1',
      source: { url: 'https://example.com/img.png' },
    });

    expect(result).toEqual({ message_id: 7 });
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    const retryBody = JSON.parse((fetchSpy.mock.calls[1][1] as RequestInit).body as string);
    expect(retryBody.parse_mode).toBeUndefined();
    expect(retryBody.caption).not.toContain('<foo>');
    expect(retryBody.caption).toContain('the answer is 42');
  });

  it('sendVideo asks for a streaming-capable player on both source shapes', async () => {
    // Without `supports_streaming` clients render a download-then-play blob
    // instead of a seekable player. It does NOT prevent Telegram from badging
    // a soundless MP4 as a GIF — nothing in the Bot API does.
    // A Response body reads once, so each call needs its own.
    fetchSpy.mockImplementation(async () => okResponse({ message_id: 3 }));
    const api = new TelegramApi(BOT_TOKEN);

    await api.sendVideo({ chatId: 'chat-1', source: { url: 'https://example.com/a.mp4' } });
    const jsonBody = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(jsonBody.supports_streaming).toBe(true);

    await api.sendVideo({
      chatId: 'chat-1',
      source: { buffer: Buffer.from('mp4'), filename: 'a.mp4', mimeType: 'video/mp4' },
    });
    const form = (fetchSpy.mock.calls[1][1] as RequestInit).body as FormData;
    expect(form.get('supports_streaming')).toBe('true');
  });

  it('sendDocument with Buffer source retries caption without HTML on parse error', async () => {
    fetchSpy
      .mockResolvedValueOnce(
        telegramErrorResponse(400, "Bad Request: can't parse entities: Unsupported start tag"),
      )
      .mockResolvedValueOnce(okResponse({ message_id: 11 }));

    const api = new TelegramApi(BOT_TOKEN);
    const result = await api.sendDocument({
      caption: '<b>bad',
      chatId: 'chat-1',
      source: { buffer: Buffer.from('hello'), filename: 'note.txt', mimeType: 'text/plain' },
    });

    expect(result).toEqual({ message_id: 11 });
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    const retryInit = fetchSpy.mock.calls[1][1] as RequestInit;
    const retryForm = retryInit.body as FormData;
    expect(retryForm.get('parse_mode')).toBeNull();
    expect(retryForm.get('caption')).toBe('bad');
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

describe('TelegramApi Guest Mode', () => {
  let fetchSpy: any;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('answerGuestQuery posts guest_query_id + result and returns inline_message_id', async () => {
    fetchSpy.mockResolvedValueOnce(okResponse({ inline_message_id: 'inline-abc' }));

    const api = new TelegramApi(BOT_TOKEN);
    const result = await api.answerGuestQuery('gq-1', { id: 'guest-reply', type: 'article' });

    expect(result).toEqual({ inline_message_id: 'inline-abc' });
    const [, init] = fetchSpy.mock.calls[0];
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/answerGuestQuery');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      guest_query_id: 'gq-1',
      result: { id: 'guest-reply', type: 'article' },
    });
  });

  it('answerGuestArticle retries without parse_mode on HTML parse error', async () => {
    fetchSpy
      .mockResolvedValueOnce(
        telegramErrorResponse(400, "Bad Request: can't parse entities: Unclosed tag"),
      )
      .mockResolvedValueOnce(okResponse({ inline_message_id: 'inline-2' }));

    const api = new TelegramApi(BOT_TOKEN);
    await api.answerGuestArticle('gq-2', '<b>broken');

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const retryBody = JSON.parse((fetchSpy.mock.calls[1][1] as RequestInit).body as string);
    expect(retryBody.result.input_message_content.parse_mode).toBeUndefined();
    expect(retryBody.result.input_message_content.message_text).toBe('broken');
  });

  it('editMessageText uses inline_message_id and ignores not-modified', async () => {
    fetchSpy.mockResolvedValueOnce(
      telegramErrorResponse(400, 'Bad Request: message is not modified'),
    );

    const api = new TelegramApi(BOT_TOKEN);
    await expect(api.editMessageText('inline-1', 'same')).resolves.toBeUndefined();

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.inline_message_id).toBe('inline-1');
    expect(body.chat_id).toBeUndefined();
  });

  it('editInlineMessageMedia uses a URL and truncates captions', async () => {
    fetchSpy.mockResolvedValueOnce(okResponse({}));

    const api = new TelegramApi(BOT_TOKEN);
    await api.editInlineMessageMedia({
      caption: 'A'.repeat(2000),
      inlineMessageId: 'inline-1',
      mediaType: 'document',
      source: { url: 'https://cdn.example/file.bin' },
    });

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.inline_message_id).toBe('inline-1');
    expect(body.media.media).toBe('https://cdn.example/file.bin');
    expect(body.media.caption).toHaveLength(1024);
    expect(body.media.caption.endsWith('...')).toBe(true);
  });

  it('editInlineMessageMedia ignores not-modified', async () => {
    fetchSpy.mockResolvedValueOnce(
      telegramErrorResponse(400, 'Bad Request: message is not modified'),
    );

    const api = new TelegramApi(BOT_TOKEN);
    await expect(
      api.editInlineMessageMedia({
        caption: 'same',
        inlineMessageId: 'inline-1',
        mediaType: 'photo',
        source: { url: 'https://cdn.example/photo.png' },
      }),
    ).resolves.toBeUndefined();

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.inline_message_id).toBe('inline-1');
    expect(body.media.caption).toBe('same');
    expect(body.media.type).toBe('photo');
  });

  it('editInlineMessageCaption uses inline_message_id and ignores not-modified', async () => {
    fetchSpy.mockResolvedValueOnce(
      telegramErrorResponse(400, 'Bad Request: message is not modified'),
    );

    const api = new TelegramApi(BOT_TOKEN);
    await expect(
      api.editInlineMessageCaption({ caption: 'same', inlineMessageId: 'inline-1' }),
    ).resolves.toBeUndefined();

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.inline_message_id).toBe('inline-1');
    expect(body.caption).toBe('same');
    expect(body.parse_mode).toBe('HTML');
    expect(body.chat_id).toBeUndefined();
  });

  it('editInlineMessageCaption retries without parse_mode on HTML parse error', async () => {
    fetchSpy
      .mockResolvedValueOnce(
        telegramErrorResponse(
          400,
          'Bad Request: can\'t parse entities: Can\'t find end tag corresponding to start tag "b"',
        ),
      )
      .mockResolvedValueOnce(okResponse({}));

    const api = new TelegramApi(BOT_TOKEN);
    await api.editInlineMessageCaption({
      caption: '<b>broken',
      inlineMessageId: 'inline-1',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const retryBody = JSON.parse((fetchSpy.mock.calls[1][1] as RequestInit).body as string);
    expect(retryBody.parse_mode).toBeUndefined();
    expect(retryBody.caption).toBe('broken');
  });
});
