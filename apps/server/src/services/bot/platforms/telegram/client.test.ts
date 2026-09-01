import type { MockInstance } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ExtractFilesResult } from '../types';
import { TelegramApi } from './api';
import { TelegramClientFactory } from './client';

const BOT_TOKEN = 'test-bot-token';
const GUEST_THREAD_ID = 'telegram:guest:-100:bot:test-bot-token:message:10';

const createClient = () =>
  new TelegramClientFactory().createClient(
    {
      applicationId: '8654315085',
      credentials: { botToken: BOT_TOKEN },
      platform: 'telegram',
      settings: {},
    },
    {},
  );

/** Build a fake Chat SDK Message with attachments + raw payload. */
const makeMessage = (overrides: {
  attachments?: Array<Record<string, unknown>>;
  raw?: Record<string, unknown>;
  id?: string;
}) =>
  ({
    attachments: overrides.attachments ?? [],
    id: overrides.id ?? '7019597964:158',
    raw: overrides.raw ?? {},
    text: '',
  }) as any;

describe('TelegramWebhookClient.extractFiles', () => {
  let downloadFileSpy: MockInstance<TelegramApi['downloadFile']>;

  beforeEach(() => {
    downloadFileSpy = vi.spyOn(TelegramApi.prototype, 'downloadFile') as MockInstance<
      TelegramApi['downloadFile']
    >;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('extracts a Telegram photo using file_id from raw.photo[] (largest variant)', async () => {
    const buffer = Buffer.from('largest-photo-bytes');
    downloadFileSpy.mockResolvedValue(buffer);

    const client = createClient();
    const result = await client.extractFiles!(
      makeMessage({
        attachments: [{ size: 16_388, type: 'image' }],
        raw: {
          chat: { id: 7019597964 },
          message_id: 158,
          photo: [
            { file_id: 'small-thumb', file_size: 1234, height: 90, width: 90 },
            { file_id: 'medium', file_size: 8000, height: 320, width: 320 },
            { file_id: 'large', file_size: 16_388, height: 1280, width: 1280 },
          ],
        },
      }),
    );

    expect(downloadFileSpy).toHaveBeenCalledTimes(1);
    expect(downloadFileSpy).toHaveBeenCalledWith('large');
    expect((result as ExtractFilesResult)?.files).toEqual([
      {
        buffer,
        mimeType: 'image/jpeg',
        name: 'image.jpg',
        size: 16_388,
      },
    ]);
  });

  it('extracts a Telegram video using file_id from raw.video', async () => {
    const buffer = Buffer.from('video-bytes');
    downloadFileSpy.mockResolvedValue(buffer);

    const client = createClient();
    const result = await client.extractFiles!(
      makeMessage({
        attachments: [{ mimeType: 'video/mp4', name: 'star.mp4', size: 932_036, type: 'video' }],
        raw: {
          video: {
            file_id: 'tg-video-1',
            file_name: 'star.mp4',
            file_size: 932_036,
            mime_type: 'video/mp4',
          },
        },
      }),
    );

    expect(downloadFileSpy).toHaveBeenCalledWith('tg-video-1');
    expect((result as ExtractFilesResult)?.files).toEqual([
      { buffer, mimeType: 'video/mp4', name: 'star.mp4', size: 932_036 },
    ]);
  });

  it('extracts a direct Telegram video note using raw.video_note', async () => {
    const buffer = Buffer.from('video-note-bytes');
    downloadFileSpy.mockResolvedValue(buffer);

    const client = createClient();
    const result = await client.extractFiles!(
      makeMessage({
        attachments: [{ size: 2048, type: 'video' }],
        raw: {
          video_note: {
            file_id: 'tg-video-note',
            file_size: 2048,
            length: 320,
          },
        },
      }),
    );

    expect(downloadFileSpy).toHaveBeenCalledWith('tg-video-note');
    expect((result as ExtractFilesResult)?.files).toEqual([
      { buffer, mimeType: 'video/mp4', name: 'video.mp4', size: 2048 },
    ]);
  });

  it('extracts a Telegram document using file_id from raw.document', async () => {
    const buffer = Buffer.from('pdf-bytes');
    downloadFileSpy.mockResolvedValue(buffer);

    const client = createClient();
    const result = await client.extractFiles!(
      makeMessage({
        attachments: [
          {
            mimeType: 'application/pdf',
            name: 'report.pdf',
            size: 4096,
            type: 'file',
          },
        ],
        raw: {
          document: {
            file_id: 'tg-doc-1',
            file_name: 'report.pdf',
            file_size: 4096,
            mime_type: 'application/pdf',
          },
        },
      }),
    );

    expect(downloadFileSpy).toHaveBeenCalledWith('tg-doc-1');
    expect((result as ExtractFilesResult)?.files).toEqual([
      { buffer, mimeType: 'application/pdf', name: 'report.pdf', size: 4096 },
    ]);
  });

  it('extracts a Telegram voice note (raw.voice) under the audio type', async () => {
    const buffer = Buffer.from('voice-bytes');
    downloadFileSpy.mockResolvedValue(buffer);

    const client = createClient();
    const result = await client.extractFiles!(
      makeMessage({
        attachments: [{ mimeType: 'audio/ogg', size: 4321, type: 'audio' }],
        raw: {
          voice: { file_id: 'tg-voice-1', file_size: 4321, mime_type: 'audio/ogg' },
        },
      }),
    );

    expect(downloadFileSpy).toHaveBeenCalledWith('tg-voice-1');
    expect((result as ExtractFilesResult)?.files?.[0]?.mimeType).toBe('audio/ogg');
  });

  it('extracts a Telegram audio file (raw.audio) under the audio type', async () => {
    const buffer = Buffer.from('mp3-bytes');
    downloadFileSpy.mockResolvedValue(buffer);

    const client = createClient();
    const result = await client.extractFiles!(
      makeMessage({
        attachments: [
          {
            mimeType: 'audio/mpeg',
            name: 'Erik Lund - Summertime.mp3',
            size: 7_699_566,
            type: 'audio',
          },
        ],
        raw: {
          audio: {
            file_id: 'tg-audio-1',
            file_name: 'Erik Lund - Summertime.mp3',
            file_size: 7_699_566,
            mime_type: 'audio/mpeg',
          },
        },
      }),
    );

    expect(downloadFileSpy).toHaveBeenCalledWith('tg-audio-1');
    expect((result as ExtractFilesResult)?.files?.[0]?.name).toBe('Erik Lund - Summertime.mp3');
  });

  it('returns undefined when no attachments are present', async () => {
    const client = createClient();
    const result = await client.extractFiles!(makeMessage({ attachments: [] }));
    expect(downloadFileSpy).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });

  it('returns undefined when attachment type has no matching media field in raw', async () => {
    const client = createClient();
    const result = await client.extractFiles!(
      makeMessage({
        attachments: [{ type: 'image' }],
        raw: {},
      }),
    );
    expect(downloadFileSpy).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });

  it('falls back to image/jpeg + image.jpg when att.mimeType and att.name are missing', async () => {
    const buffer = Buffer.from('photo-bytes');
    downloadFileSpy.mockResolvedValue(buffer);

    const client = createClient();
    const result = await client.extractFiles!(
      makeMessage({
        attachments: [{ size: 16_388, type: 'image' }],
        raw: { photo: [{ file_id: 'tg-photo' }] },
      }),
    );

    expect((result as ExtractFilesResult)?.files).toEqual([
      {
        buffer,
        mimeType: 'image/jpeg',
        name: 'image.jpg',
        size: 16_388,
      },
    ]);
  });

  it('uses the explicit mimeType / name from the attachment when present', async () => {
    const buffer = Buffer.from('quicktime-bytes');
    downloadFileSpy.mockResolvedValue(buffer);

    const client = createClient();
    const result = await client.extractFiles!(
      makeMessage({
        attachments: [{ mimeType: 'video/quicktime', name: 'clip.mov', size: 100, type: 'video' }],
        raw: { video: { file_id: 'tg-video-mov' } },
      }),
    );

    expect((result as ExtractFilesResult)?.files?.[0]?.mimeType).toBe('video/quicktime');
    expect((result as ExtractFilesResult)?.files?.[0]?.name).toBe('clip.mov');
  });

  it('skips a single failing attachment without dropping the others', async () => {
    const goodBuffer = Buffer.from('good');
    downloadFileSpy
      .mockRejectedValueOnce(new Error('telegram getFile 404'))
      .mockResolvedValueOnce(goodBuffer);

    const client = createClient();
    const result = await client.extractFiles!(
      makeMessage({
        attachments: [{ type: 'image' }, { type: 'file' }],
        raw: {
          document: { file_id: 'doc-good', file_name: 'good.pdf' },
          photo: [{ file_id: 'photo-bad' }],
        },
      }),
    );

    expect(downloadFileSpy).toHaveBeenCalledTimes(2);
    expect((result as ExtractFilesResult)?.files).toEqual([
      {
        buffer: goodBuffer,
        mimeType: 'application/octet-stream',
        name: 'file.bin',
        size: goodBuffer.length,
      },
    ]);
  });

  it('skips oversized file (>20 MB) and returns warning instead of downloading', async () => {
    const client = createClient();
    const result = await client.extractFiles!(
      makeMessage({
        attachments: [
          {
            mimeType: 'application/pdf',
            name: 'huge-report.pdf',
            size: 25_000_000, // 25 MB — exceeds 20 MB limit
            type: 'file',
          },
        ],
        raw: {
          chat: { id: 7019597964 },
          document: {
            file_id: 'tg-doc-big',
            file_name: 'huge-report.pdf',
            file_size: 25_000_000,
            mime_type: 'application/pdf',
          },
        },
      }),
    );

    expect(downloadFileSpy).not.toHaveBeenCalled();
    expect((result as ExtractFilesResult)?.files).toBeUndefined();
    expect((result as ExtractFilesResult)?.warnings).toHaveLength(1);
    expect((result as ExtractFilesResult).warnings![0]).toContain('20 MB');
    expect((result as ExtractFilesResult).warnings![0]).toContain('huge-report.pdf');
  });

  it('skips oversized file but still downloads smaller attachments in the same message', async () => {
    const goodBuffer = Buffer.from('small-pdf');
    downloadFileSpy.mockResolvedValueOnce(goodBuffer);

    const client = createClient();
    const result = await client.extractFiles!(
      makeMessage({
        attachments: [
          { mimeType: 'video/mp4', name: 'big-video.mp4', size: 50_000_000, type: 'video' },
          { mimeType: 'application/pdf', name: 'small.pdf', size: 4096, type: 'file' },
        ],
        raw: {
          chat: { id: 7019597964 },
          document: {
            file_id: 'tg-doc-small',
            file_name: 'small.pdf',
            file_size: 4096,
            mime_type: 'application/pdf',
          },
          video: {
            file_id: 'tg-video-big',
            file_name: 'big-video.mp4',
            file_size: 50_000_000,
            mime_type: 'video/mp4',
          },
        },
      }),
    );

    // Only the small file should be downloaded
    expect(downloadFileSpy).toHaveBeenCalledTimes(1);
    expect(downloadFileSpy).toHaveBeenCalledWith('tg-doc-small');
    expect((result as ExtractFilesResult)?.files).toEqual([
      { buffer: goodBuffer, mimeType: 'application/pdf', name: 'small.pdf', size: 4096 },
    ]);
    // Warning returned for the oversized video
    expect((result as ExtractFilesResult)?.warnings).toHaveLength(1);
    expect((result as ExtractFilesResult).warnings![0]).toContain('big-video.mp4');
  });

  it('returns undefined and does not throw when downloadFile rejects entirely', async () => {
    downloadFileSpy.mockRejectedValue(new Error('network down'));

    const client = createClient();
    const result = await client.extractFiles!(
      makeMessage({
        attachments: [{ type: 'image' }],
        raw: { photo: [{ file_id: 'tg-photo' }] },
      }),
    );

    expect(downloadFileSpy).toHaveBeenCalledTimes(1);
    expect(result).toBeUndefined();
  });

  it('downloads photo/video/document from reply_to_message when the summon has no attachments', async () => {
    const buffer = Buffer.from('quoted-photo');
    downloadFileSpy.mockResolvedValue(buffer);

    const client = createClient();
    const result = await client.extractFiles!(
      makeMessage({
        attachments: [],
        raw: {
          reply_to_message: {
            caption: 'a cat',
            photo: [
              { file_id: 'small', file_size: 100 },
              { file_id: 'quoted-large', file_size: 20_000 },
            ],
          },
          text: '@bot what is this',
        },
      }),
    );

    expect(downloadFileSpy).toHaveBeenCalledTimes(1);
    expect(downloadFileSpy).toHaveBeenCalledWith('quoted-large');
    expect((result as ExtractFilesResult)?.files).toEqual([
      { buffer, mimeType: 'image/jpeg', name: 'image.jpg', size: 20_000 },
    ]);
  });

  it('downloads a document on reply_to_message', async () => {
    const buffer = Buffer.from('quoted-pdf');
    downloadFileSpy.mockResolvedValue(buffer);

    const client = createClient();
    const result = await client.extractFiles!(
      makeMessage({
        raw: {
          reply_to_message: {
            document: {
              file_id: 'quoted-doc',
              file_name: 'notes.pdf',
              file_size: 2048,
              mime_type: 'application/pdf',
            },
          },
        },
      }),
    );

    expect(downloadFileSpy).toHaveBeenCalledWith('quoted-doc');
    expect((result as ExtractFilesResult)?.files).toEqual([
      { buffer, mimeType: 'application/pdf', name: 'notes.pdf', size: 2048 },
    ]);
  });

  it('downloads a video note on reply_to_message', async () => {
    const buffer = Buffer.from('quoted-video-note');
    downloadFileSpy.mockResolvedValue(buffer);

    const client = createClient();
    const result = await client.extractFiles!(
      makeMessage({
        raw: {
          reply_to_message: {
            video_note: {
              file_id: 'quoted-video-note',
              file_size: 4096,
              length: 320,
            },
          },
        },
      }),
    );

    expect(downloadFileSpy).toHaveBeenCalledWith('quoted-video-note');
    expect((result as ExtractFilesResult)?.files).toEqual([
      { buffer, mimeType: 'video/mp4', name: 'video.mp4', size: 4096 },
    ]);
  });

  it('keeps direct attachments and still pulls reply_to_message media', async () => {
    downloadFileSpy
      .mockResolvedValueOnce(Buffer.from('direct'))
      .mockResolvedValueOnce(Buffer.from('quoted'));

    const client = createClient();
    const result = await client.extractFiles!(
      makeMessage({
        attachments: [{ size: 10, type: 'image' }],
        raw: {
          photo: [{ file_id: 'direct-photo' }],
          reply_to_message: {
            video: {
              file_id: 'quoted-video',
              file_name: 'clip.mp4',
              file_size: 88,
              mime_type: 'video/mp4',
            },
          },
        },
      }),
    );

    expect(downloadFileSpy).toHaveBeenCalledWith('direct-photo');
    expect(downloadFileSpy).toHaveBeenCalledWith('quoted-video');
    expect((result as ExtractFilesResult)?.files).toHaveLength(2);
    expect((result as ExtractFilesResult)?.files?.[1]).toEqual({
      buffer: Buffer.from('quoted'),
      mimeType: 'video/mp4',
      name: 'clip.mp4',
      size: 88,
    });
  });
});

describe('TelegramWebhookClient.extractAuthorLocale', () => {
  it('returns the language_code from raw.from when present', () => {
    const client = createClient();
    expect(
      client.extractAuthorLocale!(makeMessage({ raw: { from: { language_code: 'pt-br' } } })),
    ).toBe('pt-br');
  });

  it('returns undefined when raw.from is missing or has no language_code', () => {
    const client = createClient();
    expect(client.extractAuthorLocale!(makeMessage({ raw: {} }))).toBeUndefined();
    expect(client.extractAuthorLocale!(makeMessage({ raw: { from: {} } }))).toBeUndefined();
    expect(
      client.extractAuthorLocale!(makeMessage({ raw: { from: { language_code: '' } } })),
    ).toBeUndefined();
  });
});

describe('TelegramWebhookClient thread ids', () => {
  it('extractChatId does not return "guest" for guest thread ids', () => {
    const client = createClient();
    expect(client.extractChatId('telegram:guest:-100123')).toBe('-100123');
    expect(client.extractChatId('telegram:-100123')).toBe('-100123');
    expect(client.extractChatId('telegram:guest:-100123:4')).toBe('-100123');
  });

  it('does not subscribe one-shot guest threads', () => {
    const client = createClient();
    expect(client.shouldSubscribe?.(GUEST_THREAD_ID)).toBe(false);
    expect(client.shouldSubscribe?.('telegram:-100123')).toBe(true);
  });
});

describe('TelegramWebhookClient rich messenger', () => {
  const okResponse = (body: Record<string, unknown>) =>
    new Response(JSON.stringify({ ok: true, result: body }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends raw Markdown through sendRichMessage', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(okResponse({ message_id: 12 }));
    const messenger = createClient().getMessenger('telegram:7');

    await messenger.createMessage('# Title\n\n| A | B |\n| - | - |');

    expect(String(fetchSpy.mock.calls[0]![0])).toContain('/sendRichMessage');
    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.rich_message.markdown).toContain('| A | B |');
  });

  it('does not fall back when Rich Messages are unavailable', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          description: 'Bad Request: method is not available',
          error_code: 400,
          ok: false,
        }),
        { headers: { 'Content-Type': 'application/json' }, status: 200 },
      ),
    );
    const messenger = createClient().getMessenger('telegram:7');

    await expect(messenger.createMessage('**Required**')).rejects.toThrow(
      'method is not available',
    );

    expect(String(fetchSpy.mock.calls[0]![0])).toContain('/sendRichMessage');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('creates and updates a native private-chat draft', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => okResponse({}));
    const client = createClient();
    const messenger = client.getMessenger('telegram:7');

    const draftId = await messenger.createDraft?.('Thinking…', {
      userId: 'user-1',
    });
    await messenger.updateDraft?.(draftId!, 'Using a tool…');

    expect(draftId).toMatch(/^\d+$/);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    const secondBody = JSON.parse((fetchSpy.mock.calls[1]![1] as RequestInit).body as string);
    expect(firstBody.draft_id).toBe(secondBody.draft_id);
    expect(firstBody.can_stop).toBe(true);
    expect(secondBody.rich_message.markdown).toBe('Using a tool…');
  });

  it('does not fall back when Rich Drafts are unavailable', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          description: 'Bad Request: method is not available',
          error_code: 400,
          ok: false,
        }),
        { headers: { 'Content-Type': 'application/json' }, status: 200 },
      ),
    );
    const client = createClient();
    const messenger = client.getMessenger('telegram:7');

    await expect(
      messenger.createDraft?.('Thinking…', {
        userId: 'user-1',
      }),
    ).rejects.toThrow('method is not available');

    expect(String(fetchSpy.mock.calls[0]![0])).toContain('/sendRichMessageDraft');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('does not expose native drafts for group chats', () => {
    const messenger = createClient().getMessenger('telegram:-100123');
    expect(messenger.createDraft).toBeUndefined();
    expect(messenger.updateDraft).toBeUndefined();
  });
});

describe('TelegramWebhookClient guest messenger', () => {
  const okResponse = (body: Record<string, unknown>) =>
    new Response(JSON.stringify({ ok: true, result: body }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    });

  let fetchSpy: MockInstance<typeof fetch>;
  let resetSessions: () => void;

  beforeEach(async () => {
    const guestSession = await import('./guestSession');
    resetSessions = guestSession.resetTelegramGuestSessionsForTest;
    resetSessions();
    const client = createClient();
    await guestSession.saveTelegramGuestSession(client.applicationId, GUEST_THREAD_ID, {
      guestQueryId: 'gq-1',
    });
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    resetSessions();
    fetchSpy.mockRestore();
  });

  it('createMessage answers the guest query instead of sendMessage', async () => {
    fetchSpy.mockResolvedValueOnce(okResponse({ inline_message_id: 'inline-9' }));
    const client = createClient();
    const messenger = client.getMessenger(GUEST_THREAD_ID);

    await messenger.createMessage('thinking');
    await messenger.addReaction?.('1', '👀');

    // Guest messengers must NOT expose `triggerTyping`: its presence makes
    // AgentBridgeService treat the thread as typing-capable and skip the
    // initial placeholder post when the message gateway is enabled, leaving
    // the one-shot guest query unanswered until agent completion.
    expect(messenger.triggerTyping).toBeUndefined();

    expect(String(fetchSpy.mock.calls[0]![0])).toContain('/answerGuestQuery');
    expect(fetchSpy.mock.calls.some((call) => String(call[0]).includes('/sendMessage'))).toBe(
      false,
    );
    expect(fetchSpy.mock.calls.some((call) => String(call[0]).includes('/sendChatAction'))).toBe(
      false,
    );
  });
});
