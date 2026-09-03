import type { MockInstance } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ExtractFilesResult } from '../types';
import { TelegramApi } from './api';
import { TelegramClientFactory } from './client';
import { resolveTelegramSecretToken } from './helpers';

const { createTelegramAdapterMock } = vi.hoisted(() => ({
  // Typed parameter so `mock.calls[n][0]` is a config object, not `never`.
  createTelegramAdapterMock: vi.fn((_config: Record<string, unknown>) => ({ name: 'telegram' })),
}));

vi.mock('@chat-adapter/telegram', () => ({
  createTelegramAdapter: createTelegramAdapterMock,
}));

vi.mock('@/server/services/gateway/runtimeStatus', () => ({
  BOT_RUNTIME_STATUSES: {
    connected: 'connected',
    disconnected: 'disconnected',
    failed: 'failed',
    starting: 'starting',
  },
  getRuntimeStatusErrorMessage: (e: unknown) => String(e),
  updateBotRuntimeStatus: vi.fn().mockResolvedValue(undefined),
}));

const BOT_TOKEN = 'test-bot-token';

const createClient = (credentials: Record<string, string> = {}) =>
  new TelegramClientFactory().createClient(
    {
      applicationId: '8654315085',
      credentials: { botToken: BOT_TOKEN, ...credentials },
      platform: 'telegram',
      settings: {},
    },
    { appUrl: 'https://cloud.example' },
  );

describe('TelegramWebhookClient.createAdapter', () => {
  beforeEach(() => {
    createTelegramAdapterMock.mockClear();
  });

  it('always configures a secretToken — derived when the channel has none', () => {
    // Webhook verification is mandatory on this platform. A blank field must
    // never reach the adapter as `undefined` / `allowUnverifiedWebhooks`.
    createClient().createAdapter();

    expect(createTelegramAdapterMock).toHaveBeenCalledTimes(1);
    const config = createTelegramAdapterMock.mock.calls[0][0];
    expect(config.botToken).toBe(BOT_TOKEN);
    expect(config.secretToken).toBe(resolveTelegramSecretToken({ botToken: BOT_TOKEN }));
    expect(config.secretToken).toMatch(/^[\w-]{43}$/);
    expect(config).not.toHaveProperty('allowUnverifiedWebhooks');
  });

  it('treats an empty-string secretToken as not configured and derives the same value', () => {
    createClient({ secretToken: '' }).createAdapter();

    expect(createTelegramAdapterMock).toHaveBeenCalledWith({
      botToken: BOT_TOKEN,
      secretToken: resolveTelegramSecretToken({ botToken: BOT_TOKEN }),
    });
  });

  it('uses the operator-provided secretToken when configured', () => {
    createClient({ secretToken: 'my-webhook-secret' }).createAdapter();

    expect(createTelegramAdapterMock).toHaveBeenCalledWith({
      botToken: BOT_TOKEN,
      secretToken: 'my-webhook-secret',
    });
  });
});

describe('TelegramWebhookClient webhook registration', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const setWebhookBody = () => {
    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/setWebhook'));
    expect(call).toBeDefined();
    return JSON.parse((call![1] as RequestInit).body as string);
  };

  it('start() registers the webhook with the same derived secret the adapter verifies', async () => {
    const client = createClient();
    await client.start();

    const body = setWebhookBody();
    expect(body.url).toBe(`https://cloud.example/api/agent/webhooks/telegram/${BOT_TOKEN}`);
    expect(body.secret_token).toBe(resolveTelegramSecretToken({ botToken: BOT_TOKEN }));

    client.createAdapter();
    const adapterConfig = createTelegramAdapterMock.mock.calls.at(-1)![0];
    expect(adapterConfig.secretToken).toBe(body.secret_token);
  });

  it('start() registers the operator-provided secret when configured', async () => {
    await createClient({ secretToken: 'my-webhook-secret' }).start();

    expect(setWebhookBody().secret_token).toBe('my-webhook-secret');
  });

  it('reconcileWebhook() re-runs setWebhook with the current secret', async () => {
    const client = createClient();
    await client.reconcileWebhook!();

    const body = setWebhookBody();
    expect(body.secret_token).toBe(resolveTelegramSecretToken({ botToken: BOT_TOKEN }));
    expect(body.url).toBe(`https://cloud.example/api/agent/webhooks/telegram/${BOT_TOKEN}`);
  });
});

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
