import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createWechatAdapter, WechatAdapter } from './adapter';
import type { WechatRawMessage } from './types';
import { MessageItemType, MessageState, MessageType } from './types';

// ---- helpers ----

function makeRawMessage(overrides: Partial<WechatRawMessage> = {}): WechatRawMessage {
  return {
    client_id: 'client_1',
    context_token: 'ctx_tok',
    create_time_ms: 1700000000000,
    from_user_id: 'user_abc@im.wechat',
    item_list: [{ text_item: { text: 'hello' }, type: MessageItemType.TEXT }],
    message_id: 42,
    message_state: MessageState.FINISH,
    message_type: MessageType.USER,
    to_user_id: 'bot_id',
    ...overrides,
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

describe('WechatAdapter', () => {
  let adapter: WechatAdapter;

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
    adapter = new WechatAdapter({ botId: 'bot_123', botToken: 'tok' });
    adapter.initialize(mockChat as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---------- constructor & initialize ----------

  describe('constructor', () => {
    it('should set botUserId from config', () => {
      expect(adapter.botUserId).toBe('bot_123');
    });

    it('should default userName to "wechat-bot"', () => {
      const a = new WechatAdapter({ botToken: 'tok' });
      // Before initialize, userName comes from config
      expect(a.userName).toBe('wechat-bot');
    });

    it('should use custom userName if provided', () => {
      const a = new WechatAdapter({ botToken: 'tok', userName: 'MyBot' });
      expect(a.userName).toBe('MyBot');
    });
  });

  describe('initialize', () => {
    it('should set userName from chat instance', () => {
      expect(adapter.userName).toBe('TestBot');
    });
  });

  // ---------- thread ID encoding/decoding ----------

  describe('encodeThreadId / decodeThreadId', () => {
    it('should encode thread ID with wechat prefix', () => {
      const encoded = adapter.encodeThreadId({ id: 'user_abc@im.wechat', type: 'single' });
      expect(encoded).toBe('wechat:single:user_abc@im.wechat');
    });

    it('should encode group thread ID', () => {
      const encoded = adapter.encodeThreadId({ id: 'group_1', type: 'group' });
      expect(encoded).toBe('wechat:group:group_1');
    });

    it('should decode valid thread ID', () => {
      const decoded = adapter.decodeThreadId('wechat:single:user_abc@im.wechat');
      expect(decoded).toEqual({ id: 'user_abc@im.wechat', type: 'single' });
    });

    it('should decode thread ID with colons in user ID', () => {
      const decoded = adapter.decodeThreadId('wechat:single:id:with:colons');
      expect(decoded).toEqual({ id: 'id:with:colons', type: 'single' });
    });

    it('should fallback for invalid thread ID', () => {
      const decoded = adapter.decodeThreadId('some-random-id');
      expect(decoded).toEqual({ id: 'some-random-id', type: 'single' });
    });

    it('should round-trip encode/decode', () => {
      const original = { id: 'user_xyz@im.wechat', type: 'single' as const };
      const encoded = adapter.encodeThreadId(original);
      const decoded = adapter.decodeThreadId(encoded);
      expect(decoded).toEqual(original);
    });
  });

  // ---------- isDM ----------

  describe('isDM', () => {
    it('should return true for single type', () => {
      const threadId = adapter.encodeThreadId({ id: 'u', type: 'single' });
      expect(adapter.isDM(threadId)).toBe(true);
    });

    it('should return false for group type', () => {
      const threadId = adapter.encodeThreadId({ id: 'g', type: 'group' });
      expect(adapter.isDM(threadId)).toBe(false);
    });
  });

  // ---------- channelIdFromThreadId ----------

  describe('channelIdFromThreadId', () => {
    it('should return threadId as-is', () => {
      expect(adapter.channelIdFromThreadId('wechat:single:u')).toBe('wechat:single:u');
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

    it('should skip bot messages', async () => {
      const msg = makeRawMessage({ message_type: MessageType.BOT });
      const res = await adapter.handleWebhook(makeRequest(msg));

      expect(res.status).toBe(200);
      expect(mockChat.processMessage).not.toHaveBeenCalled();
    });

    it('should skip non-finished messages', async () => {
      const msg = makeRawMessage({ message_state: MessageState.GENERATING });
      const res = await adapter.handleWebhook(makeRequest(msg));

      expect(res.status).toBe(200);
      expect(mockChat.processMessage).not.toHaveBeenCalled();
    });

    it('should skip empty text messages', async () => {
      const msg = makeRawMessage({
        item_list: [{ text_item: { text: '  ' }, type: MessageItemType.TEXT }],
      });
      const res = await adapter.handleWebhook(makeRequest(msg));

      expect(res.status).toBe(200);
      expect(mockChat.processMessage).not.toHaveBeenCalled();
    });

    it('should process valid user message', async () => {
      const msg = makeRawMessage();
      const res = await adapter.handleWebhook(makeRequest(msg));

      expect(res.status).toBe(200);
      expect(mockChat.processMessage).toHaveBeenCalledTimes(1);
      expect(mockChat.processMessage).toHaveBeenCalledWith(
        adapter,
        'wechat:single:user_abc@im.wechat',
        expect.any(Function),
        undefined,
      );
    });

    it('should cache context token from message', async () => {
      const msg = makeRawMessage({ context_token: 'new_ctx' });
      await adapter.handleWebhook(makeRequest(msg));

      const threadId = adapter.encodeThreadId({ id: msg.from_user_id, type: 'single' });
      expect(adapter.getContextToken(threadId)).toBe('new_ctx');
    });
  });

  // ---------- parseMessage ----------

  describe('parseMessage', () => {
    it('should parse text message', () => {
      const raw = makeRawMessage();
      const message = adapter.parseMessage(raw);

      expect(message.text).toBe('hello');
      expect(message.id).toBe('42');
      expect(message.author.userId).toBe('user_abc@im.wechat');
      expect(message.author.isBot).toBe(false);
    });

    it('should parse bot message', () => {
      const raw = makeRawMessage({ message_type: MessageType.BOT });
      const message = adapter.parseMessage(raw);

      expect(message.author.isBot).toBe(true);
    });

    it('should extract image placeholder text (parseMessage is sync, no CDN download)', () => {
      const raw = makeRawMessage({
        item_list: [
          {
            image_item: {
              media: { aes_key: 'ABEiM0RVZneImaq7zN3u/w==', encrypt_query_param: 'AAFFtest' },
            },
            type: MessageItemType.IMAGE,
          },
        ],
      });
      const message = adapter.parseMessage(raw);
      expect(message.text).toBe('');
      // parseMessage is sync — CDN download only happens in parseRawEvent
      expect(message.attachments).toEqual([]);
    });

    it('should extract voice text or placeholder', () => {
      const raw = makeRawMessage({
        item_list: [
          {
            type: MessageItemType.VOICE,
            voice_item: {
              media: { aes_key: '', encrypt_query_param: '' },
              text: 'transcribed text',
            },
          },
        ],
      });
      const message = adapter.parseMessage(raw);
      expect(message.text).toBe('transcribed text');
    });

    it('should extract file name', () => {
      const raw = makeRawMessage({
        item_list: [
          {
            file_item: { file_name: 'doc.pdf', media: { aes_key: '', encrypt_query_param: '' } },
            type: MessageItemType.FILE,
          },
        ],
      });
      const message = adapter.parseMessage(raw);
      expect(message.text).toBe('[file: doc.pdf]');
    });

    it('should extract video placeholder', () => {
      const raw = makeRawMessage({
        item_list: [
          {
            type: MessageItemType.VIDEO,
            video_item: { media: { aes_key: '', encrypt_query_param: '' } },
          },
        ],
      });
      const message = adapter.parseMessage(raw);
      expect(message.text).toBe('');
    });

    it('should join multiple items with newline', () => {
      const raw = makeRawMessage({
        item_list: [
          { text_item: { text: 'line1' }, type: MessageItemType.TEXT },
          { text_item: { text: 'line2' }, type: MessageItemType.TEXT },
        ],
      });
      const message = adapter.parseMessage(raw);
      expect(message.text).toBe('line1\nline2');
    });

    it('should download image from CDN and return raw buffer', async () => {
      const imageBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      vi.spyOn((adapter as any).api, 'downloadCdnMedia').mockResolvedValueOnce(imageBytes);

      const raw = makeRawMessage({
        item_list: [
          {
            image_item: {
              aeskey: '00112233445566778899aabbccddeeff',
              media: { aes_key: 'ABEiM0RVZneImaq7zN3u/w==', encrypt_query_param: 'AAFFtest' },
            },
            type: MessageItemType.IMAGE,
          },
        ],
      });

      await adapter.handleWebhook(makeRequest(raw));

      const factory = vi.mocked(mockChat.processMessage).mock.calls[0]?.[2];
      const message = await factory?.();

      expect(message?.attachments).toEqual([
        {
          buffer: imageBytes,
          mimeType: 'image/jpeg',
          name: 'image.jpg',
          type: 'image',
          url: '',
        },
      ]);
      expect(message?.text).toBe('');
    });

    it('should return empty attachments when CDN download fails', async () => {
      vi.spyOn((adapter as any).api, 'downloadCdnMedia').mockRejectedValueOnce(
        new Error('CDN download failed: 500'),
      );

      const raw = makeRawMessage({
        item_list: [
          {
            image_item: {
              media: { aes_key: 'ABEiM0RVZneImaq7zN3u/w==', encrypt_query_param: 'AAFFtest' },
            },
            type: MessageItemType.IMAGE,
          },
        ],
      });

      await adapter.handleWebhook(makeRequest(raw));

      const factory = vi.mocked(mockChat.processMessage).mock.calls[0]?.[2];
      const message = await factory?.();

      expect(message?.attachments).toEqual([]);
    });

    it('should infer MIME type from filename for file attachments', async () => {
      const fileBytes = Buffer.from([0x25, 0x50, 0x44, 0x46]); // %PDF magic bytes
      vi.spyOn((adapter as any).api, 'downloadCdnMedia').mockResolvedValueOnce(fileBytes);

      const raw = makeRawMessage({
        item_list: [
          {
            file_item: {
              file_name: 'report.pdf',
              len: '4',
              media: { aes_key: 'ABEiM0RVZneImaq7zN3u/w==', encrypt_query_param: 'AAFFtest' },
            },
            type: MessageItemType.FILE,
          },
        ],
      });

      await adapter.handleWebhook(makeRequest(raw));

      const factory = vi.mocked(mockChat.processMessage).mock.calls[0]?.[2];
      const message = await factory?.();

      expect(message?.attachments).toEqual([
        {
          buffer: fileBytes,
          mimeType: 'application/pdf',
          name: 'report.pdf',
          size: 4,
          type: 'file',
          url: '',
        },
      ]);
    });

    it('should infer MIME type for xlsx files', async () => {
      const fileBytes = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
      vi.spyOn((adapter as any).api, 'downloadCdnMedia').mockResolvedValueOnce(fileBytes);

      const raw = makeRawMessage({
        item_list: [
          {
            file_item: {
              file_name: 'data.xlsx',
              media: { aes_key: 'ABEiM0RVZneImaq7zN3u/w==', encrypt_query_param: 'AAFFtest' },
            },
            type: MessageItemType.FILE,
          },
        ],
      });

      await adapter.handleWebhook(makeRequest(raw));

      const factory = vi.mocked(mockChat.processMessage).mock.calls[0]?.[2];
      const message = await factory?.();

      expect(message?.attachments?.[0]?.mimeType).toBe(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
    });

    it('should fall back to application/octet-stream for unknown file extensions', async () => {
      const fileBytes = Buffer.from([0x00, 0x01, 0x02]);
      vi.spyOn((adapter as any).api, 'downloadCdnMedia').mockResolvedValueOnce(fileBytes);

      const raw = makeRawMessage({
        item_list: [
          {
            file_item: {
              file_name: 'data.xyz123',
              media: { aes_key: 'ABEiM0RVZneImaq7zN3u/w==', encrypt_query_param: 'AAFFtest' },
            },
            type: MessageItemType.FILE,
          },
        ],
      });

      await adapter.handleWebhook(makeRequest(raw));

      const factory = vi.mocked(mockChat.processMessage).mock.calls[0]?.[2];
      const message = await factory?.();

      expect(message?.attachments?.[0]?.mimeType).toBe('application/octet-stream');
    });
  });

  // ---------- context token management ----------

  describe('context token management', () => {
    it('should get and set context tokens', () => {
      adapter.setContextToken('thread_1', 'token_a');
      expect(adapter.getContextToken('thread_1')).toBe('token_a');
    });

    it('should return undefined for unknown thread', () => {
      expect(adapter.getContextToken('unknown')).toBeUndefined();
    });
  });

  // ---------- fetchThread ----------

  describe('fetchThread', () => {
    it('should return thread info for single chat', async () => {
      const threadId = adapter.encodeThreadId({ id: 'user_1', type: 'single' });
      const info = await adapter.fetchThread(threadId);

      expect(info.id).toBe(threadId);
      expect(info.isDM).toBe(true);
      expect(info.metadata).toEqual({ id: 'user_1', type: 'single' });
    });

    it('should return thread info for group chat', async () => {
      const threadId = adapter.encodeThreadId({ id: 'group_1', type: 'group' });
      const info = await adapter.fetchThread(threadId);

      expect(info.isDM).toBe(false);
    });
  });

  // ---------- fetchMessages ----------

  describe('fetchMessages', () => {
    it('should return empty result', async () => {
      const result = await adapter.fetchMessages('any');
      expect(result).toEqual({ messages: [], nextCursor: undefined });
    });
  });

  // ---------- no-op methods ----------

  describe('no-op methods', () => {
    it('addReaction should resolve', async () => {
      await expect(adapter.addReaction('t', 'm', 'emoji')).resolves.toBeUndefined();
    });

    it('removeReaction should resolve', async () => {
      await expect(adapter.removeReaction('t', 'm', 'emoji')).resolves.toBeUndefined();
    });

    it('startTyping should resolve', async () => {
      await expect(adapter.startTyping('t')).resolves.toBeUndefined();
    });
  });
});

// ---------- createWechatAdapter factory ----------

describe('createWechatAdapter', () => {
  it('should return a WechatAdapter instance', () => {
    const adapter = createWechatAdapter({ botToken: 'tok' });
    expect(adapter).toBeInstanceOf(WechatAdapter);
    expect(adapter.name).toBe('wechat');
  });
});
