import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createQQAdapter, QQAdapter } from './adapter';
import type { QQAttachment, QQRawMessage, QQWebhookPayload } from './types';
import { QQ_EVENT_TYPES, QQ_OP_CODES } from './types';

// ---- helpers ----

function makeQQRawMessage(overrides: Partial<QQRawMessage> = {}): QQRawMessage {
  return {
    author: { id: 'user_123' },
    content: 'hello',
    id: 'msg_001',
    timestamp: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeWebhookPayload(eventType: string, data: Record<string, any>): QQWebhookPayload {
  return {
    d: {
      author: { id: 'user_123' },
      content: 'hello',
      group_openid: 'group_abc',
      id: 'msg_001',
      timestamp: '2024-01-01T00:00:00Z',
      ...data,
    },
    id: 'event_001',
    op: QQ_OP_CODES.DISPATCH,
    t: eventType,
  };
}

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/webhook', {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
}

function makeAttachment(overrides: Partial<QQAttachment> = {}): QQAttachment {
  return {
    content_type: 'image/png',
    filename: 'image.png',
    height: 600,
    size: 248736,
    url: 'https://multimedia.nt.qq.com.cn/test-image',
    width: 800,
    ...overrides,
  };
}

// ---- tests ----

describe('QQAdapter', () => {
  let adapter: QQAdapter;

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
    adapter = new QQAdapter({ appId: 'test_app', clientSecret: 'test_secret' });
    // Mock API to avoid real network calls
    vi.spyOn((adapter as any).api, 'getAccessToken').mockResolvedValue('mock_token');
    adapter.initialize(mockChat as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---------- constructor ----------

  describe('constructor', () => {
    it('should default userName to "qq-bot"', () => {
      const a = new QQAdapter({ appId: 'a', clientSecret: 's' });
      expect(a.userName).toBe('qq-bot');
    });

    it('should use custom userName if provided', () => {
      const a = new QQAdapter({ appId: 'a', clientSecret: 's', userName: 'MyBot' });
      expect(a.userName).toBe('MyBot');
    });
  });

  // ---------- thread ID encoding/decoding ----------

  describe('encodeThreadId / decodeThreadId', () => {
    it('should encode group thread ID', () => {
      const encoded = adapter.encodeThreadId({ id: 'group_1', type: 'group' });
      expect(encoded).toBe('qq:group:group_1');
    });

    it('should encode guild thread ID with guildId', () => {
      const encoded = adapter.encodeThreadId({ guildId: 'g1', id: 'ch1', type: 'guild' });
      expect(encoded).toBe('qq:guild:ch1:g1');
    });

    it('should decode group thread ID', () => {
      const decoded = adapter.decodeThreadId('qq:group:group_1');
      expect(decoded).toEqual({ guildId: undefined, id: 'group_1', type: 'group' });
    });

    it('should decode guild thread ID with guildId', () => {
      const decoded = adapter.decodeThreadId('qq:guild:ch1:g1');
      expect(decoded).toEqual({ guildId: 'g1', id: 'ch1', type: 'guild' });
    });

    it('should round-trip encode/decode for c2c', () => {
      const original = { id: 'user_1', type: 'c2c' as const };
      const encoded = adapter.encodeThreadId(original);
      const decoded = adapter.decodeThreadId(encoded);
      expect(decoded.id).toBe('user_1');
      expect(decoded.type).toBe('c2c');
    });
  });

  // ---------- isDM ----------

  describe('isDM', () => {
    it('should return true for c2c type', () => {
      expect(adapter.isDM('qq:c2c:user_1')).toBe(true);
    });

    it('should return true for dms type', () => {
      expect(adapter.isDM('qq:dms:guild_1')).toBe(true);
    });

    it('should return false for group type', () => {
      expect(adapter.isDM('qq:group:group_1')).toBe(false);
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

    it('should handle webhook verification (op: 13)', async () => {
      vi.spyOn(await import('./crypto'), 'signWebhookResponse').mockReturnValue('mock_sig');
      const body: QQWebhookPayload = {
        d: { event_ts: '12345', plain_token: 'tok' },
        id: 'v1',
        op: QQ_OP_CODES.VERIFY,
        t: undefined as any,
      };
      const res = await adapter.handleWebhook(makeRequest(body));
      const data = await res.json();
      expect(data.plain_token).toBe('tok');
      expect(data.signature).toBe('mock_sig');
    });

    it('should skip non-message events', async () => {
      const body: QQWebhookPayload = {
        d: {} as any,
        id: 'e1',
        op: QQ_OP_CODES.DISPATCH,
        t: 'GUILD_CREATE',
      };
      const res = await adapter.handleWebhook(makeRequest(body));
      expect(res.status).toBe(200);
      expect(mockChat.processMessage).not.toHaveBeenCalled();
    });

    it('should process group message', async () => {
      const payload = makeWebhookPayload(QQ_EVENT_TYPES.GROUP_AT_MESSAGE_CREATE, {});
      const res = await adapter.handleWebhook(makeRequest(payload));

      expect(res.status).toBe(200);
      expect(mockChat.processMessage).toHaveBeenCalledTimes(1);
    });

    it('should skip empty content with no attachments', async () => {
      const payload = makeWebhookPayload(QQ_EVENT_TYPES.GROUP_AT_MESSAGE_CREATE, {
        content: '  ',
      });
      const res = await adapter.handleWebhook(makeRequest(payload));

      expect(res.status).toBe(200);
      expect(mockChat.processMessage).not.toHaveBeenCalled();
    });

    it('should process message with empty content but attachments', async () => {
      const payload = makeWebhookPayload(QQ_EVENT_TYPES.GROUP_AT_MESSAGE_CREATE, {
        attachments: [makeAttachment()],
        content: '',
      });
      const res = await adapter.handleWebhook(makeRequest(payload));

      expect(res.status).toBe(200);
      expect(mockChat.processMessage).toHaveBeenCalledTimes(1);
    });
  });

  // ---------- attachment mapping ----------

  describe('attachment mapping', () => {
    it('should map image attachments from webhook', async () => {
      const attachment = makeAttachment({
        content_type: 'image/png',
        filename: 'screenshot.png',
        height: 600,
        size: 100000,
        url: 'https://multimedia.nt.qq.com.cn/test.png',
        width: 800,
      });
      const payload = makeWebhookPayload(QQ_EVENT_TYPES.GROUP_AT_MESSAGE_CREATE, {
        attachments: [attachment],
        content: 'check this',
      });
      await adapter.handleWebhook(makeRequest(payload));

      const factory = vi.mocked(mockChat.processMessage).mock.calls[0]?.[2];
      const message = await factory?.();

      expect(message?.attachments).toHaveLength(1);
      expect(message?.attachments[0].type).toBe('image');
      expect(message?.attachments[0].mimeType).toBe('image/png');
      expect(message?.attachments[0].name).toBe('screenshot.png');
      expect(message?.attachments[0].size).toBe(100000);
      expect(message?.attachments[0].width).toBe(800);
      expect(message?.attachments[0].height).toBe(600);
      expect(message?.attachments[0].url).toBe('https://multimedia.nt.qq.com.cn/test.png');
      expect(message?.attachments[0].fetchData).toBeTypeOf('function');
    });

    it('should map video attachments', async () => {
      const attachment = makeAttachment({
        content_type: 'video/mp4',
        filename: 'clip.mp4',
        size: 5000000,
      });
      const payload = makeWebhookPayload(QQ_EVENT_TYPES.GROUP_AT_MESSAGE_CREATE, {
        attachments: [attachment],
        content: 'video',
      });
      await adapter.handleWebhook(makeRequest(payload));

      const factory = vi.mocked(mockChat.processMessage).mock.calls[0]?.[2];
      const message = await factory?.();

      expect(message?.attachments[0].type).toBe('video');
      expect(message?.attachments[0].mimeType).toBe('video/mp4');
    });

    it('should map audio attachments', async () => {
      const attachment = makeAttachment({
        content_type: 'audio/mp3',
        filename: 'voice.mp3',
      });
      const payload = makeWebhookPayload(QQ_EVENT_TYPES.GROUP_AT_MESSAGE_CREATE, {
        attachments: [attachment],
        content: 'audio',
      });
      await adapter.handleWebhook(makeRequest(payload));

      const factory = vi.mocked(mockChat.processMessage).mock.calls[0]?.[2];
      const message = await factory?.();

      expect(message?.attachments[0].type).toBe('audio');
    });

    it('should map file attachments with unknown content type', async () => {
      const attachment = makeAttachment({
        content_type: 'application/pdf',
        filename: 'doc.pdf',
      });
      const payload = makeWebhookPayload(QQ_EVENT_TYPES.GROUP_AT_MESSAGE_CREATE, {
        attachments: [attachment],
        content: 'file',
      });
      await adapter.handleWebhook(makeRequest(payload));

      const factory = vi.mocked(mockChat.processMessage).mock.calls[0]?.[2];
      const message = await factory?.();

      expect(message?.attachments[0].type).toBe('file');
    });

    it('should map multiple attachments', async () => {
      const attachments = [
        makeAttachment({ content_type: 'image/png', filename: 'a.png' }),
        makeAttachment({ content_type: 'video/mp4', filename: 'b.mp4' }),
      ];
      const payload = makeWebhookPayload(QQ_EVENT_TYPES.GROUP_AT_MESSAGE_CREATE, {
        attachments,
        content: 'multi',
      });
      await adapter.handleWebhook(makeRequest(payload));

      const factory = vi.mocked(mockChat.processMessage).mock.calls[0]?.[2];
      const message = await factory?.();

      expect(message?.attachments).toHaveLength(2);
      expect(message?.attachments[0].type).toBe('image');
      expect(message?.attachments[1].type).toBe('video');
    });

    it('should return empty attachments when none provided', async () => {
      const payload = makeWebhookPayload(QQ_EVENT_TYPES.GROUP_AT_MESSAGE_CREATE, {});
      await adapter.handleWebhook(makeRequest(payload));

      const factory = vi.mocked(mockChat.processMessage).mock.calls[0]?.[2];
      const message = await factory?.();

      expect(message?.attachments).toEqual([]);
    });

    it('should store attachments in raw message', async () => {
      const attachment = makeAttachment();
      const payload = makeWebhookPayload(QQ_EVENT_TYPES.GROUP_AT_MESSAGE_CREATE, {
        attachments: [attachment],
        content: 'test',
      });
      await adapter.handleWebhook(makeRequest(payload));

      const factory = vi.mocked(mockChat.processMessage).mock.calls[0]?.[2];
      const message = await factory?.();

      expect(message?.raw.attachments).toHaveLength(1);
      expect(message?.raw.attachments?.[0].url).toBe(attachment.url);
    });
  });

  // ---------- parseMessage attachment mapping ----------

  describe('parseMessage', () => {
    it('should parse text message with no attachments', () => {
      const raw = makeQQRawMessage({ group_openid: 'g1' });
      const message = adapter.parseMessage(raw);

      expect(message.text).toBe('hello');
      expect(message.attachments).toEqual([]);
    });

    it('should map attachments in parseMessage', () => {
      const raw = makeQQRawMessage({
        attachments: [makeAttachment()],
        group_openid: 'g1',
      });
      const message = adapter.parseMessage(raw);

      expect(message.attachments).toHaveLength(1);
      expect(message.attachments[0].type).toBe('image');
      expect(message.attachments[0].mimeType).toBe('image/png');
      expect(message.attachments[0].name).toBe('image.png');
      expect(message.attachments[0].fetchData).toBeTypeOf('function');
    });

    it('should build thread ID from group_openid', () => {
      const raw = makeQQRawMessage({ group_openid: 'group_abc' });
      const message = adapter.parseMessage(raw);
      expect(message.threadId).toBe('qq:group:group_abc');
    });

    it('should build thread ID from channel_id', () => {
      const raw = makeQQRawMessage({ channel_id: 'ch1', guild_id: 'g1' });
      const message = adapter.parseMessage(raw);
      expect(message.threadId).toBe('qq:guild:ch1:g1');
    });

    it('should build thread ID from author for c2c', () => {
      const raw = makeQQRawMessage();
      const message = adapter.parseMessage(raw);
      expect(message.threadId).toBe('qq:c2c:user_123');
    });
  });

  // ---------- fetchAttachmentData ----------

  describe('fetchAttachmentData', () => {
    it('should fetch attachment data via fetchData callback', async () => {
      const imageBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce(new Response(imageBytes, { status: 200 })),
      );

      const raw = makeQQRawMessage({
        attachments: [makeAttachment({ url: 'https://example.com/test.png' })],
        group_openid: 'g1',
      });
      const message = adapter.parseMessage(raw);
      const data = await message.attachments[0].fetchData!();

      expect(data).toBeInstanceOf(Buffer);
      expect(data.length).toBe(4);

      vi.unstubAllGlobals();
    });
  });

  // ---------- no-op methods ----------

  describe('no-op methods', () => {
    it('addReaction should resolve', async () => {
      await expect(adapter.addReaction('t', 'msg', 'emoji')).resolves.toBeUndefined();
    });

    it('removeReaction should resolve', async () => {
      await expect(adapter.removeReaction('t', 'msg', 'emoji')).resolves.toBeUndefined();
    });

    it('startTyping should resolve', async () => {
      await expect(adapter.startTyping('t')).resolves.toBeUndefined();
    });
  });

  // ---------- fetchMessages ----------

  describe('fetchMessages', () => {
    it('should return empty result', async () => {
      const result = await adapter.fetchMessages('any');
      expect(result).toEqual({ messages: [], nextCursor: undefined });
    });
  });
});

// ---------- createQQAdapter factory ----------

describe('createQQAdapter', () => {
  it('should return a QQAdapter instance', () => {
    const adapter = createQQAdapter({ appId: 'a', clientSecret: 's' });
    expect(adapter).toBeInstanceOf(QQAdapter);
    expect(adapter.name).toBe('qq');
  });
});
