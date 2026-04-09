import type { MockInstance } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createLarkAdapter,
  downloadMediaFromRawMessage,
  extractMediaMetadata,
  LarkAdapter,
} from './adapter';
import { LarkApiClient } from './api';
import type { LarkMessageBody } from './types';

// ---- helpers ----

function makeLarkMessage(overrides: Partial<LarkMessageBody> = {}): LarkMessageBody {
  return {
    chat_id: 'oc_test_chat',
    content: JSON.stringify({ text: 'hello' }),
    create_time: '1700000000000',
    message_id: 'om_test_msg_001',
    message_type: 'text',
    ...overrides,
  };
}

function makeSender(overrides: Record<string, any> = {}) {
  return {
    sender_id: { open_id: 'ou_user_abc' },
    sender_type: 'user',
    ...overrides,
  };
}

function makeWebhookPayload(message: LarkMessageBody, sender = makeSender()) {
  return {
    event: { message, sender },
    header: {
      event_type: 'im.message.receive_v1',
      token: 'verify_tok',
    },
  };
}

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/webhook', {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
}

// ---- tests ----

describe('LarkAdapter', () => {
  let adapter: LarkAdapter;

  const mockChat = {
    getLogger: vi.fn(() => ({
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    })),
    getUserName: vi.fn(() => 'TestBot'),
    processMessage: vi.fn(),
  };

  beforeEach(() => {
    vi.resetAllMocks();
    adapter = new LarkAdapter({
      appId: 'cli_test',
      appSecret: 'secret_test',
      platform: 'lark',
      verificationToken: 'verify_tok',
    });
    // Mock API methods to avoid real network calls
    vi.spyOn((adapter as any).api, 'getTenantAccessToken').mockResolvedValue('mock_token');
    adapter.initialize(mockChat as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---------- constructor & initialize ----------

  describe('constructor', () => {
    it('should default userName to "lark-bot"', () => {
      const a = new LarkAdapter({ appId: 'a', appSecret: 's' });
      expect(a.userName).toBe('lark-bot');
    });

    it('should use custom userName if provided', () => {
      const a = new LarkAdapter({ appId: 'a', appSecret: 's', userName: 'MyBot' });
      expect(a.userName).toBe('MyBot');
    });
  });

  // ---------- thread ID encoding/decoding ----------

  describe('encodeThreadId / decodeThreadId', () => {
    it('should encode thread ID with platform prefix', () => {
      const encoded = adapter.encodeThreadId({ chatId: 'oc_chat1', platform: 'lark' });
      expect(encoded).toBe('lark:oc_chat1');
    });

    it('should decode valid thread ID', () => {
      const decoded = adapter.decodeThreadId('lark:oc_chat1');
      expect(decoded).toEqual({ chatId: 'oc_chat1', platform: 'lark' });
    });

    it('should decode feishu prefix', () => {
      const decoded = adapter.decodeThreadId('feishu:oc_chat2');
      expect(decoded).toEqual({ chatId: 'oc_chat2', platform: 'feishu' });
    });

    it('should fallback for bare chat ID', () => {
      const decoded = adapter.decodeThreadId('oc_chat3');
      expect(decoded).toEqual({ chatId: 'oc_chat3', platform: 'lark' });
    });

    it('should round-trip encode/decode', () => {
      const original = { chatId: 'oc_abc', platform: 'lark' as const };
      expect(adapter.decodeThreadId(adapter.encodeThreadId(original))).toEqual(original);
    });
  });

  // ---------- handleWebhook ----------

  describe('handleWebhook', () => {
    it('should return 400 for invalid JSON', async () => {
      const req = new Request('http://localhost/webhook', {
        body: 'not json',
        method: 'POST',
      });
      const res = await adapter.handleWebhook(req);
      expect(res.status).toBe(400);
    });

    it('should respond to url_verification challenge', async () => {
      const body = { challenge: 'challenge_123', token: 'verify_tok', type: 'url_verification' };
      const res = await adapter.handleWebhook(makeRequest(body));
      const data = await res.json();
      expect(data.challenge).toBe('challenge_123');
    });

    it('should reject invalid verification token', async () => {
      const body = {
        event: {},
        header: { event_type: 'im.message.receive_v1', token: 'wrong_tok' },
      };
      const res = await adapter.handleWebhook(makeRequest(body));
      expect(res.status).toBe(401);
    });

    it('should process text message', async () => {
      const msg = makeLarkMessage();
      const res = await adapter.handleWebhook(makeRequest(makeWebhookPayload(msg)));

      expect(res.status).toBe(200);
      expect(mockChat.processMessage).toHaveBeenCalledTimes(1);
    });

    it('should skip empty text messages with no media', async () => {
      const msg = makeLarkMessage({
        content: JSON.stringify({ text: '  ' }),
        message_type: 'text',
      });
      const res = await adapter.handleWebhook(makeRequest(makeWebhookPayload(msg)));

      expect(res.status).toBe(200);
      expect(mockChat.processMessage).not.toHaveBeenCalled();
    });

    it('should process image message', async () => {
      const msg = makeLarkMessage({
        content: JSON.stringify({ image_key: 'img_test_key' }),
        message_type: 'image',
      });
      const res = await adapter.handleWebhook(makeRequest(makeWebhookPayload(msg)));

      expect(res.status).toBe(200);
      expect(mockChat.processMessage).toHaveBeenCalledTimes(1);
    });

    it('should process file message', async () => {
      const msg = makeLarkMessage({
        content: JSON.stringify({ file_key: 'file_test_key', file_name: 'doc.pdf' }),
        message_type: 'file',
      });
      const res = await adapter.handleWebhook(makeRequest(makeWebhookPayload(msg)));

      expect(res.status).toBe(200);
      expect(mockChat.processMessage).toHaveBeenCalledTimes(1);
    });

    it('should process audio message', async () => {
      const msg = makeLarkMessage({
        content: JSON.stringify({ file_key: 'audio_key' }),
        message_type: 'audio',
      });
      const res = await adapter.handleWebhook(makeRequest(makeWebhookPayload(msg)));

      expect(res.status).toBe(200);
      expect(mockChat.processMessage).toHaveBeenCalledTimes(1);
    });

    it('should process video (media) message', async () => {
      const msg = makeLarkMessage({
        content: JSON.stringify({ file_key: 'video_key', image_key: 'thumb_key' }),
        message_type: 'media',
      });
      const res = await adapter.handleWebhook(makeRequest(makeWebhookPayload(msg)));

      expect(res.status).toBe(200);
      expect(mockChat.processMessage).toHaveBeenCalledTimes(1);
    });

    it('should process sticker message', async () => {
      const msg = makeLarkMessage({
        content: JSON.stringify({ file_key: 'sticker_key' }),
        message_type: 'sticker',
      });
      const res = await adapter.handleWebhook(makeRequest(makeWebhookPayload(msg)));

      expect(res.status).toBe(200);
      expect(mockChat.processMessage).toHaveBeenCalledTimes(1);
    });

    it('should skip unsupported message types', async () => {
      const msg = makeLarkMessage({
        content: JSON.stringify({ chat_id: 'oc_xxx' }),
        message_type: 'share_chat',
      });
      const res = await adapter.handleWebhook(makeRequest(makeWebhookPayload(msg)));

      expect(res.status).toBe(200);
      expect(mockChat.processMessage).not.toHaveBeenCalled();
    });
  });

  // ---------- parseRawEvent metadata-only attachments (webhook path) ----------
  //
  // The inbound parse path is metadata-only — it does NOT call the Lark
  // resource API. Eager downloading was removed because the chat-sdk's
  // `Message.toJSON` strips both `att.buffer` AND `att.fetchData` whenever
  // the message is enqueued, making any pre-downloaded buffer or lazy
  // closure pure waste. Server-side `Feishu*Client.extractFiles` is now the
  // sole download path; it walks `message.raw` on demand via the standalone
  // `downloadMediaFromRawMessage` helper (separately tested below).

  describe('parseRawEvent metadata-only attachments', () => {
    it('should produce metadata-only image attachment without calling the API', async () => {
      const downloadSpy = vi.spyOn((adapter as any).api, 'downloadResource');

      const msg = makeLarkMessage({
        content: JSON.stringify({ image_key: 'img_test' }),
        message_type: 'image',
      });
      await adapter.handleWebhook(makeRequest(makeWebhookPayload(msg)));

      const factory = vi.mocked(mockChat.processMessage).mock.calls[0]?.[2];
      const message = await factory?.();

      expect(downloadSpy).not.toHaveBeenCalled();
      expect(message?.attachments).toEqual([
        { mimeType: 'image/jpeg', name: 'image.jpg', type: 'image' },
      ]);
      // raw is preserved so server-side extractFiles can re-fetch from image_key.
      expect(message?.raw).toBeDefined();
    });

    it('should produce metadata-only file attachment with name from content', async () => {
      const downloadSpy = vi.spyOn((adapter as any).api, 'downloadResource');

      const msg = makeLarkMessage({
        content: JSON.stringify({ file_key: 'file_test', file_name: 'report.pdf' }),
        message_type: 'file',
      });
      await adapter.handleWebhook(makeRequest(makeWebhookPayload(msg)));

      const factory = vi.mocked(mockChat.processMessage).mock.calls[0]?.[2];
      const message = await factory?.();

      expect(downloadSpy).not.toHaveBeenCalled();
      expect(message?.attachments).toEqual([
        {
          mimeType: 'application/octet-stream',
          name: 'report.pdf',
          type: 'file',
        },
      ]);
    });

    it('should produce metadata-only audio attachment', async () => {
      const downloadSpy = vi.spyOn((adapter as any).api, 'downloadResource');

      const msg = makeLarkMessage({
        content: JSON.stringify({ file_key: 'audio_key' }),
        message_type: 'audio',
      });
      await adapter.handleWebhook(makeRequest(makeWebhookPayload(msg)));

      const factory = vi.mocked(mockChat.processMessage).mock.calls[0]?.[2];
      const message = await factory?.();

      expect(downloadSpy).not.toHaveBeenCalled();
      expect(message?.attachments).toEqual([
        { mimeType: 'audio/ogg', name: 'audio.ogg', type: 'audio' },
      ]);
    });

    it('should produce metadata-only video attachment', async () => {
      const downloadSpy = vi.spyOn((adapter as any).api, 'downloadResource');

      const msg = makeLarkMessage({
        content: JSON.stringify({ file_key: 'video_key', image_key: 'thumb_key' }),
        message_type: 'media',
      });
      await adapter.handleWebhook(makeRequest(makeWebhookPayload(msg)));

      const factory = vi.mocked(mockChat.processMessage).mock.calls[0]?.[2];
      const message = await factory?.();

      expect(downloadSpy).not.toHaveBeenCalled();
      expect(message?.attachments).toEqual([
        { mimeType: 'video/mp4', name: 'video.mp4', type: 'video' },
      ]);
    });

    it('should produce metadata-only sticker attachment as image type', async () => {
      const downloadSpy = vi.spyOn((adapter as any).api, 'downloadResource');

      const msg = makeLarkMessage({
        content: JSON.stringify({ file_key: 'sticker_key' }),
        message_type: 'sticker',
      });
      await adapter.handleWebhook(makeRequest(makeWebhookPayload(msg)));

      const factory = vi.mocked(mockChat.processMessage).mock.calls[0]?.[2];
      const message = await factory?.();

      expect(downloadSpy).not.toHaveBeenCalled();
      expect(message?.attachments).toEqual([
        { mimeType: 'image/png', name: 'sticker.png', type: 'image' },
      ]);
    });

    it('should return no attachments for text messages', async () => {
      const msg = makeLarkMessage();
      await adapter.handleWebhook(makeRequest(makeWebhookPayload(msg)));

      const factory = vi.mocked(mockChat.processMessage).mock.calls[0]?.[2];
      const message = await factory?.();

      expect(message?.attachments).toEqual([]);
    });
  });

  // ---------- parseMessage (sync, lazy attachments) ----------

  describe('parseMessage', () => {
    it('should parse text message with no attachments', () => {
      const raw = makeLarkMessage();
      const message = adapter.parseMessage(raw);

      expect(message.text).toBe('hello');
      expect(message.id).toBe('om_test_msg_001');
      expect(message.attachments).toEqual([]);
    });

    it('should strip @mentions from text', () => {
      const raw = makeLarkMessage({
        content: JSON.stringify({ text: '@_user_1 hello @_all' }),
      });
      const message = adapter.parseMessage(raw);
      expect(message.text).toBe('hello');
    });

    it('should create metadata-only attachment for image message', () => {
      const raw = makeLarkMessage({
        content: JSON.stringify({ image_key: 'img_lazy' }),
        message_type: 'image',
      });
      const message = adapter.parseMessage(raw);

      expect(message.attachments).toHaveLength(1);
      expect(message.attachments[0].type).toBe('image');
      expect(message.attachments[0].mimeType).toBe('image/jpeg');
      // No fetchData closure or buffer — actual download is server-side via
      // FeishuWebhookClient.extractFiles → downloadMediaFromRawMessage(api, raw).
      expect((message.attachments[0] as any).fetchData).toBeUndefined();
      expect((message.attachments[0] as any).buffer).toBeUndefined();
    });

    it('should create metadata-only attachment for file message', () => {
      const raw = makeLarkMessage({
        content: JSON.stringify({ file_key: 'file_lazy', file_name: 'doc.xlsx' }),
        message_type: 'file',
      });
      const message = adapter.parseMessage(raw);

      expect(message.attachments).toHaveLength(1);
      expect(message.attachments[0].type).toBe('file');
      expect(message.attachments[0].name).toBe('doc.xlsx');
      expect((message.attachments[0] as any).fetchData).toBeUndefined();
    });

    it('should create metadata-only attachment for audio message', () => {
      const raw = makeLarkMessage({
        content: JSON.stringify({ file_key: 'audio_lazy' }),
        message_type: 'audio',
      });
      const message = adapter.parseMessage(raw);

      expect(message.attachments).toHaveLength(1);
      expect(message.attachments[0].type).toBe('audio');
      expect((message.attachments[0] as any).fetchData).toBeUndefined();
    });

    it('should create metadata-only attachment for video message', () => {
      const raw = makeLarkMessage({
        content: JSON.stringify({ file_key: 'video_lazy', image_key: 'thumb' }),
        message_type: 'media',
      });
      const message = adapter.parseMessage(raw);

      expect(message.attachments).toHaveLength(1);
      expect(message.attachments[0].type).toBe('video');
      expect((message.attachments[0] as any).fetchData).toBeUndefined();
    });

    it('should return empty attachments for malformed content', () => {
      const raw = makeLarkMessage({
        content: 'not json',
        message_type: 'image',
      });
      const message = adapter.parseMessage(raw);
      expect(message.attachments).toEqual([]);
    });

    it('should return empty attachments when key is missing', () => {
      const raw = makeLarkMessage({
        content: JSON.stringify({}),
        message_type: 'image',
      });
      const message = adapter.parseMessage(raw);
      expect(message.attachments).toEqual([]);
    });
  });

  // ---------- no-op methods ----------

  describe('no-op methods', () => {
    it('addReaction should resolve', async () => {
      vi.spyOn((adapter as any).api, 'addReaction').mockResolvedValue(undefined);
      await expect(adapter.addReaction('t', 'msg', 'thumbsup')).resolves.toBeUndefined();
    });

    it('removeReaction should resolve (no-op)', async () => {
      await expect(adapter.removeReaction('t', 'msg', 'emoji')).resolves.toBeUndefined();
    });

    it('startTyping should resolve (no-op)', async () => {
      await expect(adapter.startTyping('t')).resolves.toBeUndefined();
    });
  });

  // ---------- isDM ----------

  describe('isDM', () => {
    it('should return false (cannot determine from threadId)', () => {
      expect(adapter.isDM('lark:oc_chat1')).toBe(false);
    });
  });
});

// ---------- createLarkAdapter factory ----------

describe('createLarkAdapter', () => {
  it('should return a LarkAdapter instance', () => {
    const adapter = createLarkAdapter({ appId: 'a', appSecret: 's' });
    expect(adapter).toBeInstanceOf(LarkAdapter);
    expect(adapter.name).toBe('lark');
  });

  it('should use feishu platform when specified', () => {
    const adapter = createLarkAdapter({ appId: 'a', appSecret: 's', platform: 'feishu' });
    expect(adapter.name).toBe('feishu');
  });
});

// ---------- extractMediaMetadata (the metadata-only parse-time helper) ----------

describe('extractMediaMetadata', () => {
  it('returns empty array for text messages', () => {
    expect(extractMediaMetadata(makeLarkMessage())).toEqual([]);
  });

  it('returns empty array for post messages', () => {
    expect(
      extractMediaMetadata(makeLarkMessage({ message_type: 'post', content: JSON.stringify({}) })),
    ).toEqual([]);
  });

  it('returns empty array for malformed content JSON', () => {
    expect(
      extractMediaMetadata(makeLarkMessage({ content: 'not json', message_type: 'image' })),
    ).toEqual([]);
  });

  it('returns metadata-only image attachment', () => {
    const attachments = extractMediaMetadata(
      makeLarkMessage({
        content: JSON.stringify({ image_key: 'img_1' }),
        message_type: 'image',
      }),
    );
    expect(attachments).toEqual([{ mimeType: 'image/jpeg', name: 'image.jpg', type: 'image' }]);
  });

  it('returns metadata-only file attachment with name from content', () => {
    const attachments = extractMediaMetadata(
      makeLarkMessage({
        content: JSON.stringify({ file_key: 'f_1', file_name: 'plan.pdf' }),
        message_type: 'file',
      }),
    );
    expect(attachments).toEqual([
      { mimeType: 'application/octet-stream', name: 'plan.pdf', type: 'file' },
    ]);
  });

  it('falls back to "file" name when file_name missing', () => {
    const attachments = extractMediaMetadata(
      makeLarkMessage({
        content: JSON.stringify({ file_key: 'f_1' }),
        message_type: 'file',
      }),
    );
    expect(attachments[0].name).toBe('file');
  });

  it('returns metadata-only audio attachment', () => {
    const attachments = extractMediaMetadata(
      makeLarkMessage({
        content: JSON.stringify({ file_key: 'a_1' }),
        message_type: 'audio',
      }),
    );
    expect(attachments).toEqual([{ mimeType: 'audio/ogg', name: 'audio.ogg', type: 'audio' }]);
  });

  it('returns metadata-only video attachment for media type', () => {
    const attachments = extractMediaMetadata(
      makeLarkMessage({
        content: JSON.stringify({ file_key: 'v_1', image_key: 't_1' }),
        message_type: 'media',
      }),
    );
    expect(attachments).toEqual([{ mimeType: 'video/mp4', name: 'video.mp4', type: 'video' }]);
  });

  it('returns metadata-only sticker attachment as image type', () => {
    const attachments = extractMediaMetadata(
      makeLarkMessage({
        content: JSON.stringify({ file_key: 's_1' }),
        message_type: 'sticker',
      }),
    );
    expect(attachments).toEqual([{ mimeType: 'image/png', name: 'sticker.png', type: 'image' }]);
  });

  it('returns empty array when image_key is missing', () => {
    expect(
      extractMediaMetadata(makeLarkMessage({ content: JSON.stringify({}), message_type: 'image' })),
    ).toEqual([]);
  });
});

// ---------- downloadMediaFromRawMessage (the on-demand download path) ----------
//
// This is the helper called by server-side `Feishu*Client.extractFiles` to
// materialize media after a chat-sdk Redis round-trip has stripped any
// in-memory buffer/fetchData. It walks `raw.content` (JSON) and downloads
// each media item via `LarkApiClient.downloadResource(messageId, key, type)`.

describe('downloadMediaFromRawMessage', () => {
  let api: LarkApiClient;
  let downloadSpy: MockInstance<LarkApiClient['downloadResource']>;

  beforeEach(() => {
    api = new LarkApiClient('app', 'secret', 'feishu');
    downloadSpy = vi.spyOn(api, 'downloadResource') as MockInstance<
      LarkApiClient['downloadResource']
    >;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('downloads an image via image_key + downloadResource(messageId, key, "image")', async () => {
    const imageBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    downloadSpy.mockResolvedValueOnce(imageBytes);

    const result = await downloadMediaFromRawMessage(
      api,
      makeLarkMessage({
        content: JSON.stringify({ image_key: 'img_1' }),
        message_type: 'image',
      }),
    );

    expect(downloadSpy).toHaveBeenCalledTimes(1);
    expect(downloadSpy).toHaveBeenCalledWith('om_test_msg_001', 'img_1', 'image');
    expect(result).toEqual([
      {
        buffer: imageBytes,
        mimeType: 'image/jpeg',
        name: 'image.jpg',
        type: 'image',
      },
    ]);
  });

  it('downloads a file via file_key with name from content', async () => {
    const pdfBytes = Buffer.from([0x25, 0x50, 0x44, 0x46]);
    downloadSpy.mockResolvedValueOnce(pdfBytes);

    const result = await downloadMediaFromRawMessage(
      api,
      makeLarkMessage({
        content: JSON.stringify({ file_key: 'f_1', file_name: 'doc.pdf' }),
        message_type: 'file',
      }),
    );

    expect(downloadSpy).toHaveBeenCalledWith('om_test_msg_001', 'f_1', 'file');
    expect(result).toEqual([
      {
        buffer: pdfBytes,
        mimeType: 'application/octet-stream',
        name: 'doc.pdf',
        type: 'file',
      },
    ]);
  });

  it('downloads audio via file_key as audio/ogg', async () => {
    const audioBytes = Buffer.from([0x4f, 0x67, 0x67, 0x53]);
    downloadSpy.mockResolvedValueOnce(audioBytes);

    const result = await downloadMediaFromRawMessage(
      api,
      makeLarkMessage({
        content: JSON.stringify({ file_key: 'a_1' }),
        message_type: 'audio',
      }),
    );

    expect(downloadSpy).toHaveBeenCalledWith('om_test_msg_001', 'a_1', 'file');
    expect(result).toEqual([
      { buffer: audioBytes, mimeType: 'audio/ogg', name: 'audio.ogg', type: 'audio' },
    ]);
  });

  it('downloads video via file_key as video/mp4', async () => {
    const videoBytes = Buffer.from([0x00, 0x00, 0x00, 0x18]);
    downloadSpy.mockResolvedValueOnce(videoBytes);

    const result = await downloadMediaFromRawMessage(
      api,
      makeLarkMessage({
        content: JSON.stringify({ file_key: 'v_1', image_key: 't_1' }),
        message_type: 'media',
      }),
    );

    expect(downloadSpy).toHaveBeenCalledWith('om_test_msg_001', 'v_1', 'file');
    expect(result?.[0]?.type).toBe('video');
  });

  it('downloads sticker via file_key with type "image" (not "file")', async () => {
    const stickerBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    downloadSpy.mockResolvedValueOnce(stickerBytes);

    const result = await downloadMediaFromRawMessage(
      api,
      makeLarkMessage({
        content: JSON.stringify({ file_key: 's_1' }),
        message_type: 'sticker',
      }),
    );

    expect(downloadSpy).toHaveBeenCalledWith('om_test_msg_001', 's_1', 'image');
    expect(result?.[0]?.mimeType).toBe('image/png');
  });

  it('returns empty array when downloadResource throws (per-item swallow)', async () => {
    downloadSpy.mockRejectedValueOnce(new Error('Download failed: 500'));

    const result = await downloadMediaFromRawMessage(
      api,
      makeLarkMessage({
        content: JSON.stringify({ image_key: 'img_broken' }),
        message_type: 'image',
      }),
    );

    expect(result).toEqual([]);
  });

  it('returns empty array for text messages', async () => {
    const result = await downloadMediaFromRawMessage(api, makeLarkMessage());
    expect(downloadSpy).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it('returns empty array when content is malformed JSON', async () => {
    const result = await downloadMediaFromRawMessage(
      api,
      makeLarkMessage({ content: 'not json', message_type: 'image' }),
    );
    expect(downloadSpy).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it('forwards warnings to the optional logger on download failure', async () => {
    downloadSpy.mockRejectedValueOnce(new Error('boom'));
    const warn = vi.fn();

    await downloadMediaFromRawMessage(
      api,
      makeLarkMessage({
        content: JSON.stringify({ image_key: 'img_1' }),
        message_type: 'image',
      }),
      { warn },
    );

    expect(warn).toHaveBeenCalled();
  });
});
