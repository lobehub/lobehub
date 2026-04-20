import { createDecipheriv } from 'node:crypto';

import type {
  BaseInfo,
  CDNMedia,
  MessageItem,
  WechatGetConfigResponse,
  WechatGetUpdatesResponse,
  WechatSendMessageResponse,
} from './types';
import { MessageItemType, MessageState, MessageType, WECHAT_RET_CODES } from './types';

export const DEFAULT_BASE_URL = 'https://ilinkai.weixin.qq.com';
export const CDN_BASE_URL = 'https://novac2c.cdn.weixin.qq.com/c2c';

/** Strip trailing slashes without regex (avoids ReDoS on untrusted input). */
function stripTrailingSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url[end - 1] === '/') end--;
  return url.slice(0, end);
}

const CHANNEL_VERSION = '1.0.0';
const MAX_TEXT_LENGTH = 2000;
const POLL_TIMEOUT_MS = 40_000;
const DEFAULT_TIMEOUT_MS = 15_000;

const BASE_INFO: BaseInfo = { channel_version: CHANNEL_VERSION };

/**
 * Generate a random X-WECHAT-UIN header value as required by the iLink API.
 */
function randomUin(): string {
  const uint32 = Math.floor(Math.random() * 0xffff_ffff);
  return btoa(String(uint32));
}

function buildHeaders(botToken: string): Record<string, string> {
  return {
    'Authorization': `Bearer ${botToken}`,
    'AuthorizationType': 'ilink_bot_token',
    'Content-Type': 'application/json',
    'X-WECHAT-UIN': randomUin(),
  };
}

/**
 * Parse JSON response. Throws if HTTP error or ret is non-zero.
 * Matches reference: only throws when ret IS a number AND not 0.
 */
async function parseResponse<T>(response: Response, label: string): Promise<T> {
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as T) : ({} as T);

  if (!response.ok) {
    const msg =
      (payload as { errmsg?: string } | null)?.errmsg ??
      `${label} failed with HTTP ${response.status}`;
    throw new Error(msg);
  }

  const ret = (payload as { ret?: number } | null)?.ret;
  if (typeof ret === 'number' && ret !== WECHAT_RET_CODES.OK) {
    const body = payload as { errcode?: number; errmsg?: string; ret: number };
    throw Object.assign(new Error(body.errmsg ?? `${label} failed with ret=${ret}`), {
      code: body.errcode ?? ret,
    });
  }

  return payload;
}

/**
 * Build a combined AbortSignal from an optional external signal and a timeout.
 */
function combinedSignal(signal?: AbortSignal, timeoutMs: number = POLL_TIMEOUT_MS): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

export class WechatApiClient {
  private readonly botToken: string;
  private readonly baseUrl: string;
  botId: string;

  constructor(botToken: string, botId?: string, baseUrl?: string) {
    this.botToken = botToken;
    this.botId = botId || '';
    this.baseUrl = stripTrailingSlashes(baseUrl || DEFAULT_BASE_URL);
  }

  /**
   * Long-poll for new messages via iLink Bot API.
   * Server holds connection for ~35 seconds.
   */
  async getUpdates(cursor?: string, signal?: AbortSignal): Promise<WechatGetUpdatesResponse> {
    const body = {
      base_info: BASE_INFO,
      get_updates_buf: cursor || '',
    };

    const response = await fetch(`${this.baseUrl}/ilink/bot/getupdates`, {
      body: JSON.stringify(body),
      headers: buildHeaders(this.botToken),
      method: 'POST',
      signal: combinedSignal(signal, POLL_TIMEOUT_MS),
    });

    return parseResponse<WechatGetUpdatesResponse>(response, 'getupdates');
  }

  /**
   * Send a text message via iLink Bot API.
   * Reference: from_user_id is empty string, client_id is random UUID.
   */
  async sendMessage(
    toUserId: string,
    text: string,
    contextToken: string,
  ): Promise<WechatSendMessageResponse> {
    const chunks = chunkText(text, MAX_TEXT_LENGTH);
    let lastResponse: WechatSendMessageResponse = { ret: 0 };

    for (const chunk of chunks) {
      const item: MessageItem = {
        text_item: { text: chunk },
        type: MessageItemType.TEXT,
      };

      const body = {
        base_info: BASE_INFO,
        msg: {
          client_id: crypto.randomUUID(),
          context_token: contextToken,
          from_user_id: '',
          item_list: [item],
          message_state: MessageState.FINISH,
          message_type: MessageType.BOT,
          to_user_id: toUserId,
        },
      };

      const response = await fetch(`${this.baseUrl}/ilink/bot/sendmessage`, {
        body: JSON.stringify(body),
        headers: buildHeaders(this.botToken),
        method: 'POST',
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });

      lastResponse = await parseResponse<WechatSendMessageResponse>(response, 'sendmessage');
    }

    return lastResponse;
  }

  /**
   * Send typing indicator via iLink Bot API.
   */
  async sendTyping(toUserId: string, typingTicket: string, start = true): Promise<void> {
    await fetch(`${this.baseUrl}/ilink/bot/sendtyping`, {
      body: JSON.stringify({
        base_info: BASE_INFO,
        ilink_user_id: toUserId,
        status: start ? 1 : 2,
        typing_ticket: typingTicket,
      }),
      headers: buildHeaders(this.botToken),
      method: 'POST',
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    }).catch(() => {
      // Typing is best-effort
    });
  }

  /**
   * Convenience: getConfig + sendTyping in one call. Best-effort, never throws.
   */
  async startTyping(toUserId: string, contextToken: string): Promise<void> {
    try {
      const config = await this.getConfig(toUserId, contextToken);
      if (config.typing_ticket) {
        await this.sendTyping(toUserId, config.typing_ticket);
      }
    } catch {
      // typing is best-effort
    }
  }

  /**
   * Download and decrypt media from WeChat CDN.
   *
   * Flow per protocol-spec §8.3:
   *   GET CDN_BASE_URL/download?encrypted_query_param=... → AES-128-ECB decrypt
   *
   * Per §8.5: when AES key is missing, try downloading as plaintext.
   *
   * @param media  CDNMedia reference from the message item
   * @param imageAeskey  Optional hex AES key from image_item.aeskey (takes priority)
   */
  async downloadCdnMedia(media: CDNMedia, imageAeskey?: string): Promise<Buffer> {
    if (!media.encrypt_query_param) {
      throw new Error('Missing encrypt_query_param in CDNMedia');
    }

    const url = `${CDN_BASE_URL}/download?encrypted_query_param=${encodeURIComponent(media.encrypt_query_param)}`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`CDN download failed: ${response.status} ${response.statusText}`);
    }

    const raw = Buffer.from(await response.arrayBuffer());

    // Per protocol-spec §8.5: when AES key is missing, return as plaintext
    let key: Buffer;
    try {
      key = resolveAesKey(imageAeskey, media.aes_key);
    } catch {
      // No valid AES key — return plaintext per spec
      return raw;
    }
    return decryptAesEcb(raw, key);
  }

  /**
   * Get bot configuration (including typing_ticket).
   * Requires userId and contextToken per reference implementation.
   */
  async getConfig(userId: string, contextToken: string): Promise<WechatGetConfigResponse> {
    const response = await fetch(`${this.baseUrl}/ilink/bot/getconfig`, {
      body: JSON.stringify({
        base_info: BASE_INFO,
        context_token: contextToken,
        ilink_user_id: userId,
      }),
      headers: buildHeaders(this.botToken),
      method: 'POST',
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });

    return parseResponse<WechatGetConfigResponse>(response, 'getconfig');
  }
}

// ============================================================================
// QR Code Authentication (unauthenticated endpoints)
// ============================================================================

export interface QrCodeResponse {
  qrcode: string;
  qrcode_img_content: string;
}

export interface QrStatusResponse {
  baseurl?: string;
  bot_token?: string;
  ilink_bot_id?: string;
  ilink_user_id?: string;
  status: 'wait' | 'scaned' | 'confirmed' | 'expired';
}

/**
 * Request a new QR code for bot login.
 */
export async function fetchQrCode(baseUrl: string = DEFAULT_BASE_URL): Promise<QrCodeResponse> {
  const url = `${stripTrailingSlashes(baseUrl)}/ilink/bot/get_bot_qrcode?bot_type=3`;
  const response = await fetch(url, { method: 'GET' });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`iLink get_bot_qrcode failed: ${response.status} ${text}`);
  }

  return response.json() as Promise<QrCodeResponse>;
}

/**
 * Poll the QR code scan status.
 */
export async function pollQrStatus(
  qrcode: string,
  baseUrl: string = DEFAULT_BASE_URL,
): Promise<QrStatusResponse> {
  const url = `${stripTrailingSlashes(baseUrl)}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`;
  const response = await fetch(url, {
    headers: { 'iLink-App-ClientVersion': '1' },
    method: 'GET',
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`iLink get_qrcode_status failed: ${response.status} ${text}`);
  }

  return response.json() as Promise<QrStatusResponse>;
}

// ============================================================================
// Utilities
// ============================================================================

function chunkText(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];

  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    chunks.push(remaining.slice(0, limit));
    remaining = remaining.slice(limit);
  }
  return chunks;
}

// ============================================================================
// CDN Media Crypto (protocol-spec §8.3–8.4)
// ============================================================================

/**
 * AES-128-ECB decrypt.
 */
function decryptAesEcb(ciphertext: Buffer, key: Buffer): Buffer {
  const decipher = createDecipheriv('aes-128-ecb', key, null);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * Resolve the 16-byte AES key from the two possible sources and encodings.
 *
 * Priority per protocol-spec §8.4:
 *  1. `image_item.aeskey` — 32-char hex string → hex decode to 16 bytes
 *  2. `media.aes_key` — base64 encoded, two possible formats:
 *     - Format A: base64(raw 16 bytes) → decoded length = 16
 *     - Format B: base64(hex string)   → decoded length = 32, hex decode to 16
 */
export function resolveAesKey(imageAeskey?: string, mediaAesKey?: string): Buffer {
  // Priority 1: image_item.aeskey (hex string, 32 chars)
  if (imageAeskey && /^[\da-f]{32}$/i.test(imageAeskey)) {
    return Buffer.from(imageAeskey, 'hex');
  }

  // Priority 2: media.aes_key (base64 encoded)
  if (mediaAesKey) {
    const decoded = Buffer.from(mediaAesKey, 'base64');

    if (decoded.length === 16) {
      return decoded; // Format A: base64(raw 16 bytes)
    }

    if (decoded.length === 32) {
      const hexStr = decoded.toString('ascii');
      if (/^[\da-f]{32}$/i.test(hexStr)) {
        return Buffer.from(hexStr, 'hex'); // Format B: base64(hex string)
      }
    }
  }

  throw new Error('No valid AES key found for CDN media decryption');
}
