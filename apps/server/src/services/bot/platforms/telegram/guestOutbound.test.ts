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

  it('embeds URL-backed media directly in the Rich Message', async () => {
    fetchSpy.mockResolvedValueOnce(okResponse({ inline_message_id: 'inline-photo' }));
    await saveTelegramGuestSession(SESSION_SCOPE, THREAD_ID, { guestQueryId: 'gq-1' });

    await deliverGuestCreate(new TelegramApi(BOT_TOKEN), SESSION_SCOPE, THREAD_ID, {
      attachments: [
        {
          fetchUrl: 'https://cdn.example/pic.png',
          name: 'Chart',
          type: 'image',
        },
      ],
      content: 'caption',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    const rich = body.result.input_message_content.rich_message;
    expect(rich.markdown).toContain('tg://photo?id=media_0');
    expect(rich.media).toEqual([
      {
        id: 'media_0',
        media: { media: 'https://cdn.example/pic.png', type: 'photo' },
      },
    ]);
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
});
