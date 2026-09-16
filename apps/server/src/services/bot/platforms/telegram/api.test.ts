import type { MockInstance } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TELEGRAM_API_BASE, TelegramApi, TelegramEditUnavailableError } from './api';

const BOT_TOKEN = 'test-bot-token';

const okResponse = (body: unknown) =>
  new Response(JSON.stringify({ ok: true, result: body }), {
    headers: { 'Content-Type': 'application/json' },
    status: 200,
  });

const telegramErrorResponse = (errorCode: number, description: string) =>
  new Response(JSON.stringify({ description, error_code: errorCode, ok: false }), {
    headers: { 'Content-Type': 'application/json' },
    status: 200,
  });

const transientFetchError = () =>
  Object.assign(new TypeError('fetch failed'), { cause: { code: 'ETIMEDOUT' } });

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
          { id: 'media_0', media: { media: 'attach://file_0', type: 'audio' } },
          { id: 'media_1', media: { media: 'attach://file_1', type: 'photo' } },
        ],
      },
      uploads: [
        {
          buffer: Buffer.from('one'),
          fieldName: 'file_0',
          filename: 'one.mp3',
          mimeType: 'audio/mpeg',
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

    const richMessage = JSON.parse(form.get('rich_message') as string) as {
      media: { media: { media: string } }[];
    };
    const attachmentReferences = richMessage.media.map(({ media }) => media.media);
    const uploadFields = [...form.keys()].filter((key) => key.startsWith('file_'));

    expect(attachmentReferences).toEqual(['attach://file_0', 'attach://file_1']);
    expect(uploadFields).toEqual(['file_0', 'file_1']);
    for (const reference of attachmentReferences) {
      const fieldName = reference.replace('attach://', '');
      expect(form.get(fieldName)).toBeInstanceOf(Blob);
    }
    expect(attachmentReferences).toHaveLength(uploadFields.length);
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

  it('retries safe getFile calls once on transient network errors', async () => {
    fetchSpy
      .mockRejectedValueOnce(transientFetchError())
      .mockResolvedValueOnce(okResponse({ file_path: 'photos/file.jpg' }));

    const result = await new TelegramApi(BOT_TOKEN).getFile('file-1');

    expect(result).toEqual({ file_path: 'photos/file.jpg' });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('does not retry JSON Rich Message sends on transient network errors', async () => {
    fetchSpy.mockRejectedValueOnce(transientFetchError());

    await expect(
      new TelegramApi(BOT_TOKEN).sendRichMessage({
        chatId: 'chat-1',
        richMessage: { markdown: 'Hello' },
      }),
    ).rejects.toThrow('fetch failed');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('does not retry Rich Message draft sends on transient network errors', async () => {
    fetchSpy.mockRejectedValueOnce(transientFetchError());

    await expect(
      new TelegramApi(BOT_TOKEN).sendRichMessageDraft({
        chatId: 'chat-1',
        draftId: 42,
        richMessage: { markdown: 'Thinking…' },
      }),
    ).rejects.toThrow('fetch failed');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('does not retry Guest Query answers on transient network errors', async () => {
    fetchSpy.mockRejectedValueOnce(transientFetchError());

    await expect(
      new TelegramApi(BOT_TOKEN).answerGuestQuery('gq-1', {
        id: 'guest-reply',
        type: 'article',
      }),
    ).rejects.toThrow('fetch failed');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('does not retry logical API errors', async () => {
    fetchSpy.mockResolvedValueOnce(telegramErrorResponse(400, 'Bad Request: chat not found'));

    await expect(new TelegramApi(BOT_TOKEN).sendMessage('chat-1', 'hello')).rejects.toThrow(
      'chat not found',
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('rethrows Rich edits that are not unmodified or unavailable', async () => {
    fetchSpy.mockResolvedValueOnce(telegramErrorResponse(400, 'Bad Request: chat not found'));

    await expect(
      new TelegramApi(BOT_TOKEN).editRichMessageText({
        chatId: 'chat-1',
        messageId: 42,
        richMessage: { markdown: 'updated' },
      }),
    ).rejects.toThrow('chat not found');
  });

  it('does not retry multipart Rich Message sends on transient network errors', async () => {
    fetchSpy.mockRejectedValueOnce(transientFetchError());

    await expect(
      new TelegramApi(BOT_TOKEN).sendRichMessage({
        chatId: 'chat-1',
        richMessage: {
          markdown: 'Files',
          media: [{ id: 'media_0', media: { media: 'attach://file_0', type: 'document' } }],
        },
        uploads: [
          {
            buffer: Buffer.from('one'),
            fieldName: 'file_0',
            filename: 'one.pdf',
            mimeType: 'application/pdf',
          },
        ],
      }),
    ).rejects.toThrow('fetch failed');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('does not retry multipart uploads on HTTP failures', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('payload too large', { status: 413, statusText: 'Payload Too Large' }),
    );

    await expect(
      new TelegramApi(BOT_TOKEN).sendRichMessage({
        chatId: 'chat-1',
        richMessage: {
          markdown: 'Files',
          media: [{ id: 'media_0', media: { media: 'attach://file_0', type: 'document' } }],
        },
        uploads: [
          {
            buffer: Buffer.from('one'),
            fieldName: 'file_0',
            filename: 'one.pdf',
            mimeType: 'application/pdf',
          },
        ],
      }),
    ).rejects.toThrow('413');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('throws when a multipart Rich Message reports ok:false', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ description: 'invalid rich media', error_code: 400, ok: false }),
        {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        },
      ),
    );

    await expect(
      new TelegramApi(BOT_TOKEN).sendRichMessage({
        chatId: 'chat-1',
        richMessage: {
          markdown: 'Files',
          media: [{ id: 'media_0', media: { media: 'attach://file_0', type: 'document' } }],
        },
        uploads: [
          {
            buffer: Buffer.from('one'),
            fieldName: 'file_0',
            filename: 'one.pdf',
            mimeType: 'application/pdf',
          },
        ],
      }),
    ).rejects.toThrow('invalid rich media');
  });
});
