import type { MockInstance } from 'vitest';
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

describe('TelegramApi', () => {
  let fetchSpy: MockInstance<typeof fetch>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exports the official API base', () => {
    expect(TELEGRAM_API_BASE).toBe('https://api.telegram.org');
  });

  it('keeps plain sendMessage for account-linking and operational messages', async () => {
    fetchSpy.mockResolvedValueOnce(okResponse({ message_id: 42 }));

    const result = await new TelegramApi(BOT_TOKEN).sendMessage('chat-1', 'hello');

    expect(result).toEqual({ message_id: 42 });
    expect(String(fetchSpy.mock.calls[0]![0])).toContain('/sendMessage');
  });

  it('retries operational HTML messages as plain text on parse errors', async () => {
    fetchSpy
      .mockResolvedValueOnce(
        telegramErrorResponse(400, "Bad Request: can't parse entities: Unclosed tag"),
      )
      .mockResolvedValueOnce(okResponse({ message_id: 42 }));

    await new TelegramApi(BOT_TOKEN).sendMessage('chat-1', '<b>broken');

    const retryBody = JSON.parse((fetchSpy.mock.calls[1]![1] as RequestInit).body as string);
    expect(retryBody.parse_mode).toBeUndefined();
    expect(retryBody.text).toBe('broken');
  });

  it('sends Rich Messages with multiple multipart attachments', async () => {
    fetchSpy.mockResolvedValueOnce(okResponse({ message_id: 88 }));
    const api = new TelegramApi(BOT_TOKEN);

    await api.sendRichMessage({
      chatId: 'chat-1',
      richMessage: {
        markdown: 'Files',
        media: [
          { id: 'media_0', media: { media: 'attach://file_0', type: 'document' } },
          { id: 'media_1', media: { media: 'attach://file_1', type: 'photo' } },
        ],
      },
      uploads: [
        {
          buffer: Buffer.from('one'),
          fieldName: 'file_0',
          filename: 'one.txt',
          mimeType: 'text/plain',
        },
        {
          buffer: Buffer.from('two'),
          fieldName: 'file_1',
          filename: 'two.png',
          mimeType: 'image/png',
        },
      ],
    });

    expect(String(fetchSpy.mock.calls[0]![0])).toContain('/sendRichMessage');
    const form = (fetchSpy.mock.calls[0]![1] as RequestInit).body as FormData;
    expect(form.get('chat_id')).toBe('chat-1');
    expect(form.get('file_0')).toBeInstanceOf(Blob);
    expect(form.get('file_1')).toBeInstanceOf(Blob);
  });

  it('sends stoppable Rich Drafts with a stable draft id', async () => {
    fetchSpy.mockResolvedValueOnce(okResponse({}));

    await new TelegramApi(BOT_TOKEN).sendRichMessageDraft({
      canStop: true,
      chatId: 7,
      draftId: 42,
      richMessage: { markdown: '**Thinking…**' },
    });

    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    expect(String(fetchSpy.mock.calls[0]![0])).toContain('/sendRichMessageDraft');
    expect(body).toMatchObject({
      can_stop: true,
      chat_id: 7,
      draft_id: 42,
      rich_message: { markdown: '**Thinking…**' },
    });
  });

  it('edits Rich Messages and ignores unchanged content', async () => {
    fetchSpy.mockResolvedValueOnce(
      telegramErrorResponse(400, 'Bad Request: message is not modified'),
    );

    await expect(
      new TelegramApi(BOT_TOKEN).editRichMessageText({
        chatId: 'chat-1',
        messageId: 42,
        richMessage: { markdown: 'same' },
      }),
    ).resolves.toBeUndefined();
  });

  it('maps unavailable Rich edits to TelegramEditUnavailableError', async () => {
    fetchSpy.mockResolvedValueOnce(
      telegramErrorResponse(400, 'Bad Request: message to edit not found'),
    );

    await expect(
      new TelegramApi(BOT_TOKEN).editRichMessageText({
        chatId: 'chat-1',
        messageId: 42,
        richMessage: { markdown: 'updated' },
      }),
    ).rejects.toBeInstanceOf(TelegramEditUnavailableError);
  });

  it('answers Guest Mode with Rich Message content', async () => {
    fetchSpy.mockResolvedValueOnce(okResponse({ inline_message_id: 'inline-1' }));

    const result = await new TelegramApi(BOT_TOKEN).answerGuestRichArticle('gq-1', {
      markdown: '# Hello',
    });

    expect(result).toEqual({ inline_message_id: 'inline-1' });
    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.result.input_message_content).toEqual({
      rich_message: { markdown: '# Hello' },
    });
  });

  it('keeps Guest articles for account-linking prompts', async () => {
    fetchSpy.mockResolvedValueOnce(okResponse({ inline_message_id: 'inline-2' }));

    await new TelegramApi(BOT_TOKEN).answerGuestArticle('gq-2', 'Link your account');

    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.result.input_message_content.message_text).toBe('Link your account');
  });

  it('retries once on transient network errors', async () => {
    const fetchFailed = Object.assign(new TypeError('fetch failed'), {
      cause: { code: 'ETIMEDOUT' },
    });
    fetchSpy
      .mockRejectedValueOnce(fetchFailed)
      .mockResolvedValueOnce(okResponse({ message_id: 99 }));

    const result = await new TelegramApi(BOT_TOKEN).sendMessage('chat-1', 'hello');

    expect(result).toEqual({ message_id: 99 });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('does not retry logical API errors', async () => {
    fetchSpy.mockResolvedValueOnce(telegramErrorResponse(400, 'Bad Request: chat not found'));

    await expect(new TelegramApi(BOT_TOKEN).sendMessage('chat-1', 'hello')).rejects.toThrow(
      'chat not found',
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
