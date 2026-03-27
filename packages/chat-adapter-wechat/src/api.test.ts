import { createCipheriv } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CDN_BASE_URL,
  DEFAULT_BASE_URL,
  fetchQrCode,
  pollQrStatus,
  resolveAesKey,
  WechatApiClient,
} from './api';
import { WECHAT_RET_CODES } from './types';

// ---- helpers ----

const mockFetch = vi.fn<typeof fetch>();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status,
  });
}

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---- tests ----

describe('WechatApiClient', () => {
  let client: WechatApiClient;

  beforeEach(() => {
    mockFetch.mockReset();
    client = new WechatApiClient('test-token', 'bot-123');
  });

  // ---------- constructor ----------

  describe('constructor', () => {
    it('should use default base URL when none provided', () => {
      const c = new WechatApiClient('tok');
      expect(c.botId).toBe('');
    });

    it('should strip trailing slashes from base URL', async () => {
      const c = new WechatApiClient('tok', 'id', 'https://example.com///');
      mockFetch.mockResolvedValueOnce(jsonResponse({ ret: 0, msgs: [], get_updates_buf: '' }));

      await c.getUpdates();
      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/ilink/bot/getupdates',
        expect.anything(),
      );
    });
  });

  // ---------- getUpdates ----------

  describe('getUpdates', () => {
    it('should return parsed response on success', async () => {
      const payload = { ret: 0, msgs: [], get_updates_buf: 'cursor_1' };
      mockFetch.mockResolvedValueOnce(jsonResponse(payload));

      const result = await client.getUpdates();
      expect(result).toEqual(payload);
    });

    it('should send cursor in request body', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ ret: 0, msgs: [], get_updates_buf: 'cursor_2' }),
      );

      await client.getUpdates('prev_cursor');
      const body = JSON.parse(mockFetch.mock.calls[0][1]!.body as string);
      expect(body.get_updates_buf).toBe('prev_cursor');
    });

    it('should throw on HTTP error', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ errmsg: 'Unauthorized' }, 401));

      await expect(client.getUpdates()).rejects.toThrow('Unauthorized');
    });

    it('should throw on non-zero ret code', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ ret: WECHAT_RET_CODES.SESSION_EXPIRED, errmsg: 'session expired' }),
      );

      await expect(client.getUpdates()).rejects.toThrow('session expired');
    });

    it('should include Authorization and X-WECHAT-UIN headers', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ ret: 0, msgs: [], get_updates_buf: '' }));

      await client.getUpdates();
      const headers = mockFetch.mock.calls[0][1]!.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer test-token');
      expect(headers['X-WECHAT-UIN']).toBeDefined();
    });
  });

  // ---------- sendMessage ----------

  describe('sendMessage', () => {
    it('should send a short text in a single call', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ ret: 0 }));

      const result = await client.sendMessage('user_1', 'hello', 'ctx_token');
      expect(result).toEqual({ ret: 0 });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should chunk long text into multiple requests', async () => {
      mockFetch.mockImplementation(() => Promise.resolve(jsonResponse({ ret: 0 })));

      const longText = 'a'.repeat(4500); // > 2 * 2000
      await client.sendMessage('user_1', longText, 'ctx');

      // 4500 / 2000 = 3 chunks
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('should include correct fields in request body', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ ret: 0 }));

      await client.sendMessage('user_1', 'hi', 'ctx_tok');
      const body = JSON.parse(mockFetch.mock.calls[0][1]!.body as string);

      expect(body.msg.to_user_id).toBe('user_1');
      expect(body.msg.context_token).toBe('ctx_tok');
      expect(body.msg.from_user_id).toBe('');
      expect(body.msg.item_list[0].text_item.text).toBe('hi');
      expect(body.msg.message_state).toBe(2); // FINISH
      expect(body.msg.message_type).toBe(2); // BOT
    });

    it('should throw on API error', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ ret: -1, errmsg: 'send failed' }));

      await expect(client.sendMessage('u', 'hi', 'ctx')).rejects.toThrow('send failed');
    });
  });

  // ---------- sendTyping ----------

  describe('sendTyping', () => {
    it('should not throw on success', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ ret: 0 }));

      await expect(client.sendTyping('user_1', 'ticket_1')).resolves.toBeUndefined();
    });

    it('should not throw on network error (best-effort)', async () => {
      mockFetch.mockRejectedValueOnce(new Error('network error'));

      await expect(client.sendTyping('user_1', 'ticket_1')).resolves.toBeUndefined();
    });

    it('should send status=1 for start and status=2 for stop', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ ret: 0 }));

      await client.sendTyping('u', 'tk', true);
      const startBody = JSON.parse(mockFetch.mock.calls[0][1]!.body as string);
      expect(startBody.status).toBe(1);

      await client.sendTyping('u', 'tk', false);
      const stopBody = JSON.parse(mockFetch.mock.calls[1][1]!.body as string);
      expect(stopBody.status).toBe(2);
    });
  });

  // ---------- getConfig ----------

  describe('downloadCdnMedia', () => {
    // Helper: encrypt plaintext with AES-128-ECB for test fixtures
    function encryptAesEcb(plaintext: Buffer, key: Buffer): Buffer {
      const cipher = createCipheriv('aes-128-ecb', key, null);
      return Buffer.concat([cipher.update(plaintext), cipher.final()]);
    }

    it('should download from CDN and decrypt with AES-128-ECB', async () => {
      const aesKeyHex = '00112233445566778899aabbccddeeff';
      const aesKey = Buffer.from(aesKeyHex, 'hex');
      const plaintext = Buffer.from('hello image data');
      const ciphertext = encryptAesEcb(plaintext, aesKey);

      mockFetch.mockResolvedValueOnce(new Response(new Uint8Array(ciphertext), { status: 200 }));

      const result = await client.downloadCdnMedia(
        { aes_key: 'ABEiM0RVZneImaq7zN3u/w==', encrypt_query_param: 'AAFFtest' },
        aesKeyHex,
      );

      expect(result).toEqual(plaintext);
      expect(mockFetch).toHaveBeenCalledWith(
        `${CDN_BASE_URL}/download?encrypted_query_param=AAFFtest`,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    it('should throw on CDN HTTP error', async () => {
      mockFetch.mockResolvedValueOnce(new Response('Not Found', { status: 404 }));

      await expect(
        client.downloadCdnMedia({ aes_key: 'x', encrypt_query_param: 'AAFFtest' }),
      ).rejects.toThrow('CDN download failed: 404');
    });

    it('should throw when encrypt_query_param is missing', async () => {
      await expect(
        client.downloadCdnMedia({ aes_key: 'x', encrypt_query_param: '' }),
      ).rejects.toThrow('Missing encrypt_query_param');
    });

    it('should return raw bytes when no valid AES key is available', async () => {
      const rawBytes = Buffer.from('plaintext image data');
      mockFetch.mockResolvedValueOnce(new Response(new Uint8Array(rawBytes), { status: 200 }));

      const result = await client.downloadCdnMedia({
        aes_key: '',
        encrypt_query_param: 'AAFFtest',
      });

      expect(result).toEqual(rawBytes);
    });

    it('should throw when AES key is valid but ciphertext is corrupt', async () => {
      const aesKeyHex = '00112233445566778899aabbccddeeff';
      // Not valid AES-128-ECB ciphertext (wrong length / padding)
      const corruptCiphertext = Buffer.from('not valid ciphertext!');
      mockFetch.mockResolvedValueOnce(
        new Response(new Uint8Array(corruptCiphertext), { status: 200 }),
      );

      await expect(
        client.downloadCdnMedia(
          { aes_key: 'ABEiM0RVZneImaq7zN3u/w==', encrypt_query_param: 'AAFFtest' },
          aesKeyHex,
        ),
      ).rejects.toThrow();
    });
  });

  describe('getConfig', () => {
    it('should return config with typing_ticket', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ ret: 0, typing_ticket: 'ticket_abc' }));

      const config = await client.getConfig('user_1', 'ctx_tok');
      expect(config.typing_ticket).toBe('ticket_abc');
    });

    it('should throw on non-zero ret', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ ret: -14, errmsg: 'expired' }));

      await expect(client.getConfig('u', 'c')).rejects.toThrow('expired');
    });
  });
});

// ---- QR code helpers ----

describe('fetchQrCode', () => {
  beforeEach(() => mockFetch.mockReset());

  it('should return qr code data on success', async () => {
    const payload = { qrcode: 'qr_123', qrcode_img_content: 'base64...' };
    mockFetch.mockResolvedValueOnce(jsonResponse(payload));

    const result = await fetchQrCode();
    expect(result).toEqual(payload);
    expect(mockFetch).toHaveBeenCalledWith(
      `${DEFAULT_BASE_URL}/ilink/bot/get_bot_qrcode?bot_type=3`,
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('should throw on HTTP error', async () => {
    mockFetch.mockResolvedValueOnce(new Response('Not Found', { status: 404 }));

    await expect(fetchQrCode()).rejects.toThrow('iLink get_bot_qrcode failed');
  });

  it('should strip trailing slashes from custom base URL', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ qrcode: 'x', qrcode_img_content: 'y' }));

    await fetchQrCode('https://custom.example.com//');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://custom.example.com/ilink/bot/get_bot_qrcode?bot_type=3',
      expect.anything(),
    );
  });
});

describe('pollQrStatus', () => {
  beforeEach(() => mockFetch.mockReset());

  it('should return status on success', async () => {
    const payload = { status: 'wait' as const };
    mockFetch.mockResolvedValueOnce(jsonResponse(payload));

    const result = await pollQrStatus('qr_123');
    expect(result.status).toBe('wait');
  });

  it('should encode qrcode in URL', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ status: 'scaned' }));

    await pollQrStatus('qr=special&chars');
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain(encodeURIComponent('qr=special&chars'));
  });

  it('should throw on HTTP error', async () => {
    mockFetch.mockResolvedValueOnce(new Response('error', { status: 500 }));

    await expect(pollQrStatus('qr')).rejects.toThrow('iLink get_qrcode_status failed');
  });
});

// ---- resolveAesKey ----

describe('resolveAesKey', () => {
  it('should prefer image_item.aeskey (hex string)', () => {
    const key = resolveAesKey('00112233445566778899aabbccddeeff', 'ABEiM0RVZneImaq7zN3u/w==');
    expect(key).toEqual(Buffer.from('00112233445566778899aabbccddeeff', 'hex'));
  });

  it('should handle Format A: base64(raw 16 bytes)', () => {
    // base64 of raw bytes [0x00, 0x11, 0x22, ..., 0xff]
    const key = resolveAesKey(undefined, 'ABEiM0RVZneImaq7zN3u/w==');
    expect(key).toEqual(Buffer.from('00112233445566778899aabbccddeeff', 'hex'));
    expect(key.length).toBe(16);
  });

  it('should handle Format B: base64(hex string)', () => {
    // base64 of ASCII "00112233445566778899aabbccddeeff"
    const key = resolveAesKey(undefined, 'MDAxMTIyMzM0NDU1NjY3Nzg4OTlhYWJiY2NkZGVlZmY=');
    expect(key).toEqual(Buffer.from('00112233445566778899aabbccddeeff', 'hex'));
    expect(key.length).toBe(16);
  });

  it('should throw when no valid key is found', () => {
    expect(() => resolveAesKey(undefined, undefined)).toThrow('No valid AES key');
    expect(() => resolveAesKey('tooshort', undefined)).toThrow('No valid AES key');
  });
});
