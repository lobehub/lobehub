import type { MockInstance } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TelegramApi } from './api';
import { deliverGuestCreate, deliverGuestEdit } from './guestOutbound';
import {
  getTelegramGuestSession,
  resetTelegramGuestSessionsForTest,
  saveTelegramGuestSession,
} from './guestSession';

vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: () => null,
}));

const BOT_TOKEN = 'test-bot-token';
const SESSION_SCOPE = 'bot-1';
const THREAD_ID = 'telegram:guest:-100:message:10';

const okResponse = (body: Record<string, unknown>) =>
  new Response(JSON.stringify({ ok: true, result: body }), {
    headers: { 'Content-Type': 'application/json' },
    status: 200,
  });

describe('deliverGuestCreate / deliverGuestEdit', () => {
  let fetchSpy: MockInstance<typeof fetch>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
    resetTelegramGuestSessionsForTest();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetTelegramGuestSessionsForTest();
  });

  it('answers the guest query on the first createMessage', async () => {
    fetchSpy.mockResolvedValueOnce(okResponse({ inline_message_id: 'inline-1' }));
    await saveTelegramGuestSession(SESSION_SCOPE, THREAD_ID, { guestQueryId: 'gq-1' });

    const api = new TelegramApi(BOT_TOKEN);
    const sent = await deliverGuestCreate(api, SESSION_SCOPE, THREAD_ID, 'hello');

    expect(sent.id).toBe('guest-inline:inline-1');
    expect(String(fetchSpy.mock.calls[0]![0])).toContain('/answerGuestQuery');
    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.guest_query_id).toBe('gq-1');
    expect(body.result.type).toBe('article');
  });

  it('edits the inline message on a later editMessage', async () => {
    fetchSpy.mockResolvedValueOnce(okResponse({}));
    await saveTelegramGuestSession(SESSION_SCOPE, THREAD_ID, {
      guestQueryId: 'gq-1',
      inlineMessageId: 'inline-1',
    });

    const api = new TelegramApi(BOT_TOKEN);
    await deliverGuestEdit(api, SESSION_SCOPE, THREAD_ID, 'guest-inline:inline-1', 'final');

    expect(String(fetchSpy.mock.calls[0]![0])).toContain('/editMessageText');
    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.inline_message_id).toBe('inline-1');
    expect(body.text).toBe('final');
    expect(body.chat_id).toBeUndefined();
  });

  it('answers with an article before replacing it with URL-backed media', async () => {
    fetchSpy
      .mockResolvedValueOnce(okResponse({ inline_message_id: 'inline-photo' }))
      .mockResolvedValueOnce(okResponse({}));
    await saveTelegramGuestSession(SESSION_SCOPE, THREAD_ID, { guestQueryId: 'gq-1' });

    const api = new TelegramApi(BOT_TOKEN);
    await deliverGuestCreate(api, SESSION_SCOPE, THREAD_ID, {
      attachments: [
        {
          fetchUrl: 'https://cdn.example/pic.png',
          mimeType: 'image/png',
          type: 'image',
        },
      ],
      content: 'caption',
    });

    const answerBody = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    expect(answerBody.result.type).toBe('article');

    const editBody = JSON.parse((fetchSpy.mock.calls[1]![1] as RequestInit).body as string);
    expect(String(fetchSpy.mock.calls[1]![0])).toContain('/editMessageMedia');
    expect(editBody.inline_message_id).toBe('inline-photo');
    expect(editBody.media).toMatchObject({
      caption: 'caption',
      media: 'https://cdn.example/pic.png',
      type: 'photo',
    });
  });

  it('updates the caption after a guest reply has been converted to a photo', async () => {
    fetchSpy
      .mockResolvedValueOnce(okResponse({ inline_message_id: 'inline-photo' }))
      .mockResolvedValueOnce(okResponse({}))
      .mockResolvedValueOnce(okResponse({}));
    await saveTelegramGuestSession(SESSION_SCOPE, THREAD_ID, { guestQueryId: 'gq-1' });

    const api = new TelegramApi(BOT_TOKEN);
    await deliverGuestCreate(api, SESSION_SCOPE, THREAD_ID, 'hello');
    await deliverGuestCreate(api, SESSION_SCOPE, THREAD_ID, {
      attachments: [
        {
          fetchUrl: 'https://cdn.example/pic.png',
          mimeType: 'image/png',
          type: 'image',
        },
      ],
      content: 'caption',
    });
    await deliverGuestEdit(api, SESSION_SCOPE, THREAD_ID, 'guest-inline:inline-photo', 'final');

    expect(String(fetchSpy.mock.calls[1]![0])).toContain('/editMessageMedia');
    expect(String(fetchSpy.mock.calls[2]![0])).toContain('/editMessageCaption');
    expect(String(fetchSpy.mock.calls[2]![0])).not.toContain('/editMessageText');
    const captionBody = JSON.parse((fetchSpy.mock.calls[2]![1] as RequestInit).body as string);
    expect(captionBody.inline_message_id).toBe('inline-photo');
    expect(captionBody.caption).toBe('final');
    expect(captionBody.chat_id).toBeUndefined();
  });

  it('updates the caption when the first guest reply was already converted to a photo', async () => {
    fetchSpy
      .mockResolvedValueOnce(okResponse({ inline_message_id: 'inline-photo' }))
      .mockResolvedValueOnce(okResponse({}))
      .mockResolvedValueOnce(okResponse({}));
    await saveTelegramGuestSession(SESSION_SCOPE, THREAD_ID, { guestQueryId: 'gq-1' });

    const api = new TelegramApi(BOT_TOKEN);
    await deliverGuestCreate(api, SESSION_SCOPE, THREAD_ID, {
      attachments: [
        {
          fetchUrl: 'https://cdn.example/pic.png',
          mimeType: 'image/png',
          type: 'image',
        },
      ],
      content: 'caption',
    });
    await deliverGuestEdit(api, SESSION_SCOPE, THREAD_ID, 'guest-inline:inline-photo', 'updated');

    expect(String(fetchSpy.mock.calls[2]![0])).toContain('/editMessageCaption');
    const captionBody = JSON.parse((fetchSpy.mock.calls[2]![1] as RequestInit).body as string);
    expect(captionBody.caption).toBe('updated');
  });

  it('keeps later caption chunks visible after a photo reply hits the 1024-character limit', async () => {
    fetchSpy
      .mockResolvedValueOnce(okResponse({ inline_message_id: 'inline-photo' }))
      .mockResolvedValueOnce(okResponse({}))
      .mockResolvedValueOnce(okResponse({}))
      .mockResolvedValueOnce(okResponse({}));
    await saveTelegramGuestSession(SESSION_SCOPE, THREAD_ID, { guestQueryId: 'gq-1' });

    const api = new TelegramApi(BOT_TOKEN);
    await deliverGuestCreate(api, SESSION_SCOPE, THREAD_ID, {
      attachments: [
        {
          fetchUrl: 'https://cdn.example/pic.png',
          mimeType: 'image/png',
          type: 'image',
        },
      ],
      content: 'caption',
    });
    await deliverGuestEdit(
      api,
      SESSION_SCOPE,
      THREAD_ID,
      'guest-inline:inline-photo',
      'A'.repeat(1500),
    );
    await deliverGuestCreate(api, SESSION_SCOPE, THREAD_ID, 'VISIBLE');

    const longCaption = JSON.parse((fetchSpy.mock.calls[2]![1] as RequestInit).body as string);
    expect(String(fetchSpy.mock.calls[2]![0])).toContain('/editMessageCaption');
    expect(longCaption.caption).toHaveLength(1024);
    expect(longCaption.caption).toContain('1024-character');
    expect(longCaption.caption).not.toContain('4096-character');

    const appendCaption = JSON.parse((fetchSpy.mock.calls[3]![1] as RequestInit).body as string);
    expect(String(fetchSpy.mock.calls[3]![0])).toContain('/editMessageCaption');
    expect(appendCaption.caption).toContain('VISIBLE');
    expect(appendCaption.caption).toContain(
      'Response truncated because Telegram Guest Mode supports one 1024-character reply.',
    );
    expect(appendCaption.caption.length).toBeLessThanOrEqual(1024);

    const session = await getTelegramGuestSession(SESSION_SCOPE, THREAD_ID);
    expect(session?.lastText).toContain('VISIBLE');
    expect(session?.lastText?.length).toBeLessThanOrEqual(1024);
    expect(session?.truncated).toBe(true);
  });

  it('keeps the truncation notice when a later caption chunk also replaces the photo', async () => {
    fetchSpy
      .mockResolvedValueOnce(okResponse({ inline_message_id: 'inline-photo' }))
      .mockResolvedValueOnce(okResponse({}))
      .mockResolvedValueOnce(okResponse({}))
      .mockResolvedValueOnce(okResponse({}));
    await saveTelegramGuestSession(SESSION_SCOPE, THREAD_ID, { guestQueryId: 'gq-1' });

    const api = new TelegramApi(BOT_TOKEN);
    await deliverGuestCreate(api, SESSION_SCOPE, THREAD_ID, {
      attachments: [
        {
          fetchUrl: 'https://cdn.example/first.png',
          mimeType: 'image/png',
          type: 'image',
        },
      ],
      content: 'caption',
    });
    await deliverGuestEdit(
      api,
      SESSION_SCOPE,
      THREAD_ID,
      'guest-inline:inline-photo',
      'A'.repeat(1500),
    );
    await deliverGuestCreate(api, SESSION_SCOPE, THREAD_ID, {
      attachments: [
        {
          fetchUrl: 'https://cdn.example/second.png',
          mimeType: 'image/png',
          type: 'image',
        },
      ],
      content: 'VISIBLE',
    });

    expect(String(fetchSpy.mock.calls[3]![0])).toContain('/editMessageMedia');
    const mediaBody = JSON.parse((fetchSpy.mock.calls[3]![1] as RequestInit).body as string);
    expect(mediaBody.media.caption).toContain('VISIBLE');
    expect(mediaBody.media.caption).toContain(
      'Response truncated because Telegram Guest Mode supports one 1024-character reply.',
    );
    expect(mediaBody.media.caption).toHaveLength(1024);

    await expect(getTelegramGuestSession(SESSION_SCOPE, THREAD_ID)).resolves.toMatchObject({
      mediaType: 'photo',
      truncated: true,
    });
  });

  it('does not count a successfully delivered image fallback link against caption budget', async () => {
    fetchSpy.mockResolvedValueOnce(okResponse({}));
    await saveTelegramGuestSession(SESSION_SCOPE, THREAD_ID, {
      guestQueryId: 'gq-1',
      inlineMessageId: 'inline-photo',
      mediaType: 'photo',
    });
    const caption = 'A'.repeat(1000);

    const api = new TelegramApi(BOT_TOKEN);
    await deliverGuestEdit(api, SESSION_SCOPE, THREAD_ID, 'guest-inline:inline-photo', {
      attachments: [
        {
          fetchUrl: `https://cdn.example/${'long-path-'.repeat(20)}photo.png`,
          mimeType: 'image/png',
          type: 'image',
        },
      ],
      content: caption,
    });

    const mediaBody = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    expect(String(fetchSpy.mock.calls[0]![0])).toContain('/editMessageMedia');
    expect(mediaBody.media.caption).toBe(caption);
    await expect(getTelegramGuestSession(SESSION_SCOPE, THREAD_ID)).resolves.toMatchObject({
      lastText: caption,
      mediaType: 'photo',
      truncated: false,
    });
  });

  it('clears persisted truncation state when an edit replaces the body with shorter text', async () => {
    fetchSpy.mockImplementation(async () => okResponse({}));
    await saveTelegramGuestSession(SESSION_SCOPE, THREAD_ID, {
      guestQueryId: 'gq-1',
      inlineMessageId: 'inline-photo',
      mediaType: 'photo',
    });

    const api = new TelegramApi(BOT_TOKEN);
    await deliverGuestEdit(
      api,
      SESSION_SCOPE,
      THREAD_ID,
      'guest-inline:inline-photo',
      'A'.repeat(1500),
    );
    await deliverGuestEdit(
      api,
      SESSION_SCOPE,
      THREAD_ID,
      'guest-inline:inline-photo',
      'complete replacement',
    );

    const replacementBody = JSON.parse((fetchSpy.mock.calls[1]![1] as RequestInit).body as string);
    expect(replacementBody.caption).toBe('complete replacement');
    expect(replacementBody.caption).not.toContain('Response truncated');
    await expect(getTelegramGuestSession(SESSION_SCOPE, THREAD_ID)).resolves.toMatchObject({
      lastText: 'complete replacement',
      truncated: false,
    });
  });

  it('replaces an existing guest photo with a later image instead of editing text', async () => {
    fetchSpy
      .mockResolvedValueOnce(okResponse({ inline_message_id: 'inline-photo' }))
      .mockResolvedValueOnce(okResponse({}))
      .mockResolvedValueOnce(okResponse({}));
    await saveTelegramGuestSession(SESSION_SCOPE, THREAD_ID, { guestQueryId: 'gq-1' });

    const api = new TelegramApi(BOT_TOKEN);
    await deliverGuestCreate(api, SESSION_SCOPE, THREAD_ID, {
      attachments: [
        {
          fetchUrl: 'https://cdn.example/first.png',
          mimeType: 'image/png',
          type: 'image',
        },
      ],
      content: 'first',
    });
    await deliverGuestEdit(api, SESSION_SCOPE, THREAD_ID, 'guest-inline:inline-photo', {
      attachments: [
        {
          fetchUrl: 'https://cdn.example/second.png',
          mimeType: 'image/png',
          type: 'image',
        },
      ],
      content: 'second',
    });

    expect(String(fetchSpy.mock.calls[2]![0])).toContain('/editMessageMedia');
    const mediaBody = JSON.parse((fetchSpy.mock.calls[2]![1] as RequestInit).body as string);
    expect(mediaBody.media).toMatchObject({
      caption: 'second',
      media: 'https://cdn.example/second.png',
      type: 'photo',
    });
  });

  it('keeps the article text when an attachment has only base64 data', async () => {
    fetchSpy.mockResolvedValueOnce(okResponse({ inline_message_id: 'inline-data' }));
    await saveTelegramGuestSession(SESSION_SCOPE, THREAD_ID, { guestQueryId: 'gq-1' });

    const api = new TelegramApi(BOT_TOKEN);
    await deliverGuestCreate(api, SESSION_SCOPE, THREAD_ID, {
      attachments: [{ data: 'aGVsbG8=', mimeType: 'image/png', type: 'image' }],
      content: 'text survives',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const answerBody = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    expect(answerBody.result.type).toBe('article');
    expect(answerBody.result.input_message_content.message_text).toContain('text survives');
    expect(answerBody.result.input_message_content.message_text).toContain(
      'This attachment can’t be delivered in Telegram Guest Mode.',
    );
  });

  it('keeps non-image URL attachments as links instead of attempting inline media edits', async () => {
    fetchSpy.mockResolvedValueOnce(okResponse({ inline_message_id: 'inline-file' }));
    await saveTelegramGuestSession(SESSION_SCOPE, THREAD_ID, { guestQueryId: 'gq-1' });

    const api = new TelegramApi(BOT_TOKEN);
    await deliverGuestCreate(api, SESSION_SCOPE, THREAD_ID, {
      attachments: [
        {
          fetchUrl: 'https://app.example/f/file-id',
          name: 'report.pdf',
          type: 'file',
        },
      ],
      content: 'Download the report',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const answerBody = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    expect(answerBody.result.input_message_content.message_text).toContain('Download the report');
    expect(answerBody.result.input_message_content.message_text).toContain(
      '<a href="https://app.example/f/file-id">report.pdf</a>',
    );
  });

  it('represents every attachment in the single guest reply', async () => {
    fetchSpy.mockResolvedValueOnce(okResponse({ inline_message_id: 'inline-many' }));
    await saveTelegramGuestSession(SESSION_SCOPE, THREAD_ID, { guestQueryId: 'gq-1' });

    const api = new TelegramApi(BOT_TOKEN);
    await deliverGuestCreate(api, SESSION_SCOPE, THREAD_ID, {
      attachments: [
        { fetchUrl: 'https://cdn.example/first.png', name: 'first.png', type: 'image' },
        { fetchUrl: 'https://cdn.example/second.png', name: 'second.png', type: 'image' },
      ],
      content: 'Generated files',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const answerBody = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    const messageText = answerBody.result.input_message_content.message_text;
    expect(messageText).toContain('<a href="https://cdn.example/first.png">first.png</a>');
    expect(messageText).toContain('<a href="https://cdn.example/second.png">second.png</a>');
  });

  it('shows an explicit notice when later chunks exceed the single-reply limit', async () => {
    fetchSpy
      .mockResolvedValueOnce(okResponse({ inline_message_id: 'inline-long' }))
      .mockResolvedValueOnce(okResponse({}));
    await saveTelegramGuestSession(SESSION_SCOPE, THREAD_ID, { guestQueryId: 'gq-1' });

    const api = new TelegramApi(BOT_TOKEN);
    await deliverGuestCreate(api, SESSION_SCOPE, THREAD_ID, 'A'.repeat(4000));
    await deliverGuestCreate(api, SESSION_SCOPE, THREAD_ID, 'B'.repeat(4000));

    const editBody = JSON.parse((fetchSpy.mock.calls[1]![1] as RequestInit).body as string);
    expect(editBody.text).toHaveLength(4096);
    expect(editBody.text).toContain(
      'Response truncated because Telegram Guest Mode supports one 4096-character reply.',
    );
  });

  it('keeps accumulated text when the final chunk carries an image', async () => {
    fetchSpy
      .mockResolvedValueOnce(okResponse({ inline_message_id: 'inline-image-long' }))
      .mockResolvedValueOnce(okResponse({}));
    await saveTelegramGuestSession(SESSION_SCOPE, THREAD_ID, { guestQueryId: 'gq-1' });

    const api = new TelegramApi(BOT_TOKEN);
    await deliverGuestCreate(api, SESSION_SCOPE, THREAD_ID, 'A'.repeat(4000));
    await deliverGuestCreate(api, SESSION_SCOPE, THREAD_ID, {
      attachments: [
        {
          fetchUrl: 'https://cdn.example/final.png',
          name: 'final.png',
          type: 'image',
        },
      ],
      content: 'B'.repeat(1024),
    });

    expect(String(fetchSpy.mock.calls[1]![0])).toContain('/editMessageText');
    const editBody = JSON.parse((fetchSpy.mock.calls[1]![1] as RequestInit).body as string);
    expect(editBody.text).toContain('A'.repeat(100));
    expect(editBody.text).toContain('<a href="https://cdn.example/final.png">final.png</a>');
    expect(editBody.text).toContain('Response truncated');
  });

  it('localizes guest notices to the summoner locale stored on the session', async () => {
    fetchSpy.mockResolvedValueOnce(okResponse({ inline_message_id: 'inline-zh' }));
    await saveTelegramGuestSession(SESSION_SCOPE, THREAD_ID, {
      guestQueryId: 'gq-1',
      locale: 'zh-CN',
    });

    const api = new TelegramApi(BOT_TOKEN);
    await deliverGuestCreate(api, SESSION_SCOPE, THREAD_ID, {
      attachments: [{ data: 'aGVsbG8=', mimeType: 'image/png', type: 'image' }],
      content: 'text survives',
    });

    const answerBody = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    expect(answerBody.result.input_message_content.message_text).toContain('text survives');
    expect(answerBody.result.input_message_content.message_text).toContain(
      '该附件无法通过 Telegram 访客模式送达。',
    );
    expect(answerBody.result.input_message_content.message_text).not.toContain(
      'This attachment can’t be delivered',
    );
  });

  it('keeps localizing later edits from the persisted session locale', async () => {
    fetchSpy
      .mockResolvedValueOnce(okResponse({ inline_message_id: 'inline-zh-long' }))
      .mockResolvedValueOnce(okResponse({}));
    await saveTelegramGuestSession(SESSION_SCOPE, THREAD_ID, {
      guestQueryId: 'gq-1',
      locale: 'zh-CN',
    });

    const api = new TelegramApi(BOT_TOKEN);
    await deliverGuestCreate(api, SESSION_SCOPE, THREAD_ID, 'A'.repeat(4000));
    await deliverGuestCreate(api, SESSION_SCOPE, THREAD_ID, 'B'.repeat(4000));

    const editBody = JSON.parse((fetchSpy.mock.calls[1]![1] as RequestInit).body as string);
    expect(editBody.text).toHaveLength(4096);
    expect(editBody.text).toContain('回复已被截断：Telegram 访客模式仅支持一条 4096 字符的回复。');
    expect(editBody.text).not.toContain('Response truncated');
  });
});
