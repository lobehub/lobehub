import type { MockInstance } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TelegramApi } from './api';
import {
  deliverGuestCreate,
  deliverGuestEdit,
  messengerContentFromPostable,
} from './guestOutbound';
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

  it('answers the first guest query with Rich Message content', async () => {
    fetchSpy.mockResolvedValueOnce(okResponse({ inline_message_id: 'inline-1' }));
    await saveTelegramGuestSession(SESSION_SCOPE, THREAD_ID, { guestQueryId: 'gq-1' });

    const sent = await deliverGuestCreate(
      new TelegramApi(BOT_TOKEN),
      SESSION_SCOPE,
      THREAD_ID,
      '# Hello',
    );

    expect(sent.id).toBe('guest-inline:inline-1');
    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.result.input_message_content).toEqual({
      rich_message: { markdown: '# Hello' },
    });
  });

  it('edits later guest replies with Rich Message content', async () => {
    fetchSpy.mockResolvedValueOnce(okResponse({}));
    await saveTelegramGuestSession(SESSION_SCOPE, THREAD_ID, {
      guestQueryId: 'gq-1',
      inlineMessageId: 'inline-1',
    });

    await deliverGuestEdit(
      new TelegramApi(BOT_TOKEN),
      SESSION_SCOPE,
      THREAD_ID,
      'guest-inline:inline-1',
      '**final**',
    );

    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.inline_message_id).toBe('inline-1');
    expect(body.rich_message).toEqual({ markdown: '**final**' });
    expect(body.text).toBeUndefined();
  });

  it('answers Guest Query attachments as download links, never URL media', async () => {
    fetchSpy.mockResolvedValueOnce(okResponse({ inline_message_id: 'inline-photo' }));
    await saveTelegramGuestSession(SESSION_SCOPE, THREAD_ID, { guestQueryId: 'gq-1' });

    await deliverGuestCreate(new TelegramApi(BOT_TOKEN), SESSION_SCOPE, THREAD_ID, {
      attachments: [
        {
          fetchUrl: 'https://cdn.example/pic.png',
          name: 'Chart',
          type: 'image',
        },
        {
          fetchUrl: 'https://cdn.example/clip.mp4',
          mimeType: 'video/mp4',
          name: 'clip.mp4',
          type: 'video',
        },
        {
          fetchUrl: 'https://cloud.example/f/audio-id',
          mimeType: 'audio/mpeg',
          name: 'track.mp3',
          type: 'audio',
        },
      ],
      content: 'caption',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0]![0])).toContain('/answerGuestQuery');
    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    const rich = body.result.input_message_content.rich_message;
    expect(rich.markdown).toContain('[Chart](https://cdn.example/pic.png)');
    expect(rich.markdown).toContain('[clip.mp4](https://cdn.example/clip.mp4)');
    expect(rich.markdown).toContain('[track.mp3](https://cloud.example/f/audio-id)');
    expect(rich.markdown).not.toContain('tg://');
    expect(rich.media).toBeUndefined();
  });

  it('reports data-only Guest attachments compactly in inline edits', async () => {
    fetchSpy.mockResolvedValueOnce(okResponse({}));
    await saveTelegramGuestSession(SESSION_SCOPE, THREAD_ID, {
      guestQueryId: 'gq-1',
      inlineMessageId: 'inline-1',
    });

    await deliverGuestEdit(
      new TelegramApi(BOT_TOKEN),
      SESSION_SCOPE,
      THREAD_ID,
      'guest-inline:inline-1',
      {
        attachments: [
          {
            data: Buffer.from('pdf').toString('base64'),
            mimeType: 'application/pdf',
            name: 'report.pdf',
            type: 'file',
          },
        ],
        content: 'final',
      },
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0]![0])).toContain('/editMessageText');
    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.inline_message_id).toBe('inline-1');
    expect(body.rich_message.markdown).toBe(
      'final\n\n⚠️ **report.pdf** — _Unavailable in Telegram Guest Mode._',
    );
    expect(body.rich_message.media).toBeUndefined();
  });

  it('reports data-only Guest attachments compactly in the initial query response', async () => {
    fetchSpy.mockResolvedValueOnce(okResponse({ inline_message_id: 'inline-file' }));
    await saveTelegramGuestSession(SESSION_SCOPE, THREAD_ID, { guestQueryId: 'gq-1' });

    await deliverGuestCreate(new TelegramApi(BOT_TOKEN), SESSION_SCOPE, THREAD_ID, {
      attachments: [
        {
          data: Buffer.from('pdf').toString('base64'),
          mimeType: 'application/pdf',
          name: 'report.pdf',
          type: 'file',
        },
      ],
      content: 'File',
    });

    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.guest_query_id).toBe('gq-1');
    expect(body.result.input_message_content.rich_message.markdown).toBe(
      'File\n\n⚠️ **report.pdf** — _Unavailable in Telegram Guest Mode._',
    );
  });

  it('keeps Guest Query documents as download links', async () => {
    fetchSpy.mockResolvedValueOnce(okResponse({ inline_message_id: 'inline-file' }));
    await saveTelegramGuestSession(SESSION_SCOPE, THREAD_ID, { guestQueryId: 'gq-1' });

    await deliverGuestCreate(new TelegramApi(BOT_TOKEN), SESSION_SCOPE, THREAD_ID, {
      attachments: [
        {
          fetchUrl: 'https://cloud.example/f/file-id',
          name: 'report.pdf',
          type: 'file',
        },
      ],
      content: 'File',
    });

    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    const rich = body.result.input_message_content.rich_message;
    expect(rich.markdown).toBe('File\n\n📎 [report.pdf](https://cloud.example/f/file-id)');
    expect(rich.media).toBeUndefined();
  });

  it('appends later Guest attachments as one download link without chat side effects', async () => {
    fetchSpy.mockResolvedValueOnce(okResponse({}));
    await saveTelegramGuestSession(SESSION_SCOPE, THREAD_ID, {
      guestQueryId: 'gq-1',
      inlineMessageId: 'inline-1',
      lastText: 'thinking',
    });

    await deliverGuestCreate(new TelegramApi(BOT_TOKEN), SESSION_SCOPE, THREAD_ID, {
      attachments: [
        {
          data: Buffer.from('png').toString('base64'),
          fetchUrl: 'https://cdn.example/chart.png',
          name: 'chart.png',
          type: 'image',
        },
      ],
      content: 'more',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0]![0])).toContain('/editMessageText');
    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    const rich = body.rich_message;
    expect(rich.markdown).toContain('thinking\n\nmore');
    expect(rich.markdown).toContain('📎 [chart.png](https://cdn.example/chart.png)');
    expect(rich.markdown.match(/\[chart\.png\]/g)).toHaveLength(1);
    expect(rich.media).toBeUndefined();
  });

  it('appends create chunks and replaces edit chunks', async () => {
    fetchSpy.mockImplementation(async () => okResponse({}));
    await saveTelegramGuestSession(SESSION_SCOPE, THREAD_ID, {
      guestQueryId: 'gq-1',
      inlineMessageId: 'inline-1',
      lastText: 'first',
    });

    const api = new TelegramApi(BOT_TOKEN);
    await deliverGuestCreate(api, SESSION_SCOPE, THREAD_ID, 'second');
    await deliverGuestEdit(api, SESSION_SCOPE, THREAD_ID, 'guest-inline:inline-1', 'replacement');

    const appendBody = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    const replaceBody = JSON.parse((fetchSpy.mock.calls[1]![1] as RequestInit).body as string);
    expect(appendBody.rich_message.markdown).toBe('first\n\nsecond');
    expect(replaceBody.rich_message.markdown).toBe('replacement');
    await expect(getTelegramGuestSession(SESSION_SCOPE, THREAD_ID)).resolves.toMatchObject({
      lastText: 'replacement',
    });
  });

  it('does not fall back when Telegram rejects Rich Message content', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ description: 'Bad Request: invalid rich message', ok: false }),
        { headers: { 'Content-Type': 'application/json' }, status: 400 },
      ),
    );
    await saveTelegramGuestSession(SESSION_SCOPE, THREAD_ID, { guestQueryId: 'gq-1' });

    await expect(
      deliverGuestCreate(new TelegramApi(BOT_TOKEN), SESSION_SCOPE, THREAD_ID, 'hello'),
    ).rejects.toThrow('invalid rich message');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('keeps the newest chunks visible after the Guest reply reaches the rich-message limit', async () => {
    fetchSpy.mockImplementation(async () => okResponse({}));
    await saveTelegramGuestSession(SESSION_SCOPE, THREAD_ID, {
      guestQueryId: 'gq-1',
      inlineMessageId: 'inline-1',
      lastText: 'a'.repeat(32_760),
    });

    const api = new TelegramApi(BOT_TOKEN);
    await deliverGuestCreate(api, SESSION_SCOPE, THREAD_ID, 'FIRST_TAIL');
    await deliverGuestCreate(api, SESSION_SCOPE, THREAD_ID, 'LATEST_TAIL');

    const firstBody = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    const latestBody = JSON.parse((fetchSpy.mock.calls[1]![1] as RequestInit).body as string);
    expect(firstBody.rich_message.markdown).toContain('FIRST_TAIL');
    expect(latestBody.rich_message.markdown).toContain('LATEST_TAIL');
    expect(Array.from(latestBody.rich_message.markdown)).toHaveLength(32_768);
    await expect(getTelegramGuestSession(SESSION_SCOPE, THREAD_ID)).resolves.toMatchObject({
      truncated: true,
    });
  });

  it('clears stale truncation state when the final edit replaces the response', async () => {
    fetchSpy.mockResolvedValueOnce(okResponse({}));
    await saveTelegramGuestSession(SESSION_SCOPE, THREAD_ID, {
      guestQueryId: 'gq-1',
      inlineMessageId: 'inline-1',
      lastText: 'x'.repeat(32_768),
      truncated: true,
    });

    await deliverGuestEdit(
      new TelegramApi(BOT_TOKEN),
      SESSION_SCOPE,
      THREAD_ID,
      'guest-inline:inline-1',
      'short final answer',
    );

    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.rich_message.markdown).toBe('short final answer');
    await expect(getTelegramGuestSession(SESSION_SCOPE, THREAD_ID)).resolves.toMatchObject({
      lastText: 'short final answer',
      truncated: false,
    });
  });

  it('rejects an empty Guest create', async () => {
    fetchSpy.mockResolvedValueOnce(okResponse({ inline_message_id: 'inline-1' }));
    await saveTelegramGuestSession(SESSION_SCOPE, THREAD_ID, { guestQueryId: 'gq-1' });

    await expect(
      deliverGuestCreate(new TelegramApi(BOT_TOKEN), SESSION_SCOPE, THREAD_ID, '   '),
    ).rejects.toThrow('Telegram guest rich reply is empty');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('renders Guest attachments without a URL as unavailable copy', async () => {
    fetchSpy.mockResolvedValueOnce(okResponse({ inline_message_id: 'inline-1' }));
    await saveTelegramGuestSession(SESSION_SCOPE, THREAD_ID, { guestQueryId: 'gq-1' });

    await deliverGuestCreate(new TelegramApi(BOT_TOKEN), SESSION_SCOPE, THREAD_ID, {
      attachments: [{ name: 'secret.pdf', type: 'file' }],
      content: 'File',
    });

    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.result.input_message_content.rich_message.markdown).toContain('secret.pdf');
    expect(body.result.input_message_content.rich_message.markdown).toContain('⚠️');
    expect(body.result.input_message_content.rich_message.markdown).not.toContain('tg://');
  });

  it('renders each linked and unavailable attachment exactly once', async () => {
    fetchSpy.mockResolvedValueOnce(okResponse({ inline_message_id: 'inline-1' }));
    await saveTelegramGuestSession(SESSION_SCOPE, THREAD_ID, { guestQueryId: 'gq-1' });

    await deliverGuestCreate(new TelegramApi(BOT_TOKEN), SESSION_SCOPE, THREAD_ID, {
      attachments: [
        {
          fetchUrl: 'https://cloud.example/f/linked',
          name: 'linked-report.pdf',
          type: 'file',
        },
        {
          data: Buffer.from('pdf').toString('base64'),
          name: 'data-only-report.pdf',
          type: 'file',
        },
      ],
      content: 'Files',
    });

    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    const markdown = body.result.input_message_content.rich_message.markdown as string;
    expect(markdown.match(/linked-report\.pdf/g)).toHaveLength(1);
    expect(markdown.match(/data-only-report\.pdf/g)).toHaveLength(1);
    expect(markdown).toContain('📎 [linked-report.pdf](https://cloud.example/f/linked)');
    expect(markdown).toContain(
      '⚠️ **data-only-report.pdf** — _Unavailable in Telegram Guest Mode._',
    );
  });

  it('rejects an empty Guest edit', async () => {
    fetchSpy.mockResolvedValueOnce(okResponse({}));
    await saveTelegramGuestSession(SESSION_SCOPE, THREAD_ID, {
      guestQueryId: 'gq-1',
      inlineMessageId: 'inline-1',
    });

    await expect(
      deliverGuestEdit(
        new TelegramApi(BOT_TOKEN),
        SESSION_SCOPE,
        THREAD_ID,
        'guest-inline:inline-1',
        '   ',
      ),
    ).rejects.toThrow('Telegram guest rich edit is empty');
  });

  it('converts Chat SDK postable payloads into messenger content', () => {
    expect(messengerContentFromPostable('plain')).toBe('plain');
    expect(messengerContentFromPostable(null)).toBe('');
    expect(
      messengerContentFromPostable({
        attachments: [
          { mimeType: 'image/png', name: 'a.png', type: 'image', url: 'https://cdn.example/a.png' },
          { name: 'skip-me' },
        ],
        markdown: 'caption',
      }),
    ).toEqual({
      attachments: [
        {
          data: undefined,
          fetchUrl: 'https://cdn.example/a.png',
          mimeType: 'image/png',
          name: 'a.png',
          size: undefined,
          type: 'image',
        },
      ],
      content: 'caption',
    });
  });
});
