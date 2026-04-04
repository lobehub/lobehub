import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createLarkAdapter, LarkAdapter } from './adapter';
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

  // ---------- parseRawEvent media download ----------

  describe('parseRawEvent media download', () => {
    it('should download image and create attachment', async () => {
      const imageBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      vi.spyOn((adapter as any).api, 'downloadResource').mockResolvedValueOnce(imageBytes);

      const msg = makeLarkMessage({
        content: JSON.stringify({ image_key: 'img_test' }),
        message_type: 'image',
      });
      await adapter.handleWebhook(makeRequest(makeWebhookPayload(msg)));

      const factory = vi.mocked(mockChat.processMessage).mock.calls[0]?.[2];
      const message = await factory?.();

      expect(message?.attachments).toEqual([
        { buffer: imageBytes, mimeType: 'image/jpeg', name: 'image.jpg', type: 'image' },
      ]);
    });

    it('should download file and create attachment', async () => {
      const fileBytes = Buffer.from([0x25, 0x50, 0x44, 0x46]);
      vi.spyOn((adapter as any).api, 'downloadResource').mockResolvedValueOnce(fileBytes);

      const msg = makeLarkMessage({
        content: JSON.stringify({ file_key: 'file_test', file_name: 'report.pdf' }),
        message_type: 'file',
      });
      await adapter.handleWebhook(makeRequest(makeWebhookPayload(msg)));

      const factory = vi.mocked(mockChat.processMessage).mock.calls[0]?.[2];
      const message = await factory?.();

      expect(message?.attachments).toEqual([
        {
          buffer: fileBytes,
          mimeType: 'application/octet-stream',
          name: 'report.pdf',
          type: 'file',
        },
      ]);
    });

    it('should download audio and create attachment', async () => {
      const audioBytes = Buffer.from([0x4f, 0x67, 0x67, 0x53]);
      vi.spyOn((adapter as any).api, 'downloadResource').mockResolvedValueOnce(audioBytes);

      const msg = makeLarkMessage({
        content: JSON.stringify({ file_key: 'audio_key' }),
        message_type: 'audio',
      });
      await adapter.handleWebhook(makeRequest(makeWebhookPayload(msg)));

      const factory = vi.mocked(mockChat.processMessage).mock.calls[0]?.[2];
      const message = await factory?.();

      expect(message?.attachments).toEqual([
        { buffer: audioBytes, mimeType: 'audio/ogg', name: 'audio.ogg', type: 'audio' },
      ]);
    });

    it('should download video (media) and create attachment', async () => {
      const videoBytes = Buffer.from([0x00, 0x00, 0x00, 0x1c]);
      vi.spyOn((adapter as any).api, 'downloadResource').mockResolvedValueOnce(videoBytes);

      const msg = makeLarkMessage({
        content: JSON.stringify({ file_key: 'video_key', image_key: 'thumb_key' }),
        message_type: 'media',
      });
      await adapter.handleWebhook(makeRequest(makeWebhookPayload(msg)));

      const factory = vi.mocked(mockChat.processMessage).mock.calls[0]?.[2];
      const message = await factory?.();

      expect(message?.attachments).toEqual([
        { buffer: videoBytes, mimeType: 'video/mp4', name: 'video.mp4', type: 'video' },
      ]);
    });

    it('should download sticker and create attachment', async () => {
      const stickerBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      vi.spyOn((adapter as any).api, 'downloadResource').mockResolvedValueOnce(stickerBytes);

      const msg = makeLarkMessage({
        content: JSON.stringify({ file_key: 'sticker_key' }),
        message_type: 'sticker',
      });
      await adapter.handleWebhook(makeRequest(makeWebhookPayload(msg)));

      const factory = vi.mocked(mockChat.processMessage).mock.calls[0]?.[2];
      const message = await factory?.();

      expect(message?.attachments).toEqual([
        { buffer: stickerBytes, mimeType: 'image/png', name: 'sticker.png', type: 'image' },
      ]);
    });

    it('should return empty attachments when download fails', async () => {
      vi.spyOn((adapter as any).api, 'downloadResource').mockRejectedValueOnce(
        new Error('Download failed: 500'),
      );

      const msg = makeLarkMessage({
        content: JSON.stringify({ image_key: 'img_broken' }),
        message_type: 'image',
      });
      await adapter.handleWebhook(makeRequest(makeWebhookPayload(msg)));

      const factory = vi.mocked(mockChat.processMessage).mock.calls[0]?.[2];
      const message = await factory?.();

      expect(message?.attachments).toEqual([]);
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

    it('should create lazy attachment for image message', () => {
      const raw = makeLarkMessage({
        content: JSON.stringify({ image_key: 'img_lazy' }),
        message_type: 'image',
      });
      const message = adapter.parseMessage(raw);

      expect(message.attachments).toHaveLength(1);
      expect(message.attachments[0].type).toBe('image');
      expect(message.attachments[0].mimeType).toBe('image/jpeg');
      expect(message.attachments[0].fetchData).toBeTypeOf('function');
    });

    it('should create lazy attachment for file message', () => {
      const raw = makeLarkMessage({
        content: JSON.stringify({ file_key: 'file_lazy', file_name: 'doc.xlsx' }),
        message_type: 'file',
      });
      const message = adapter.parseMessage(raw);

      expect(message.attachments).toHaveLength(1);
      expect(message.attachments[0].type).toBe('file');
      expect(message.attachments[0].name).toBe('doc.xlsx');
    });

    it('should create lazy attachment for audio message', () => {
      const raw = makeLarkMessage({
        content: JSON.stringify({ file_key: 'audio_lazy' }),
        message_type: 'audio',
      });
      const message = adapter.parseMessage(raw);

      expect(message.attachments).toHaveLength(1);
      expect(message.attachments[0].type).toBe('audio');
    });

    it('should create lazy attachment for video message', () => {
      const raw = makeLarkMessage({
        content: JSON.stringify({ file_key: 'video_lazy', image_key: 'thumb' }),
        message_type: 'media',
      });
      const message = adapter.parseMessage(raw);

      expect(message.attachments).toHaveLength(1);
      expect(message.attachments[0].type).toBe('video');
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
