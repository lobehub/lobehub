import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

import type {
  BaseInfo,
  CDNMedia,
  MessageItem,
  WechatGetConfigResponse,
  WechatGetUpdatesResponse,
  WechatSendMessageResponse,
} from './types';
import { MessageItemType, MessageState, MessageType, WECHAT_RET_CODES } from './types';

/** iLink CDN media types — see protocol-spec §8.2. */
export enum WechatUploadMediaType {
  IMAGE = 1,
  VIDEO = 2,
  FILE = 3,
  VOICE = 4,
}

/** Result of uploading media to the iLink CDN. */
export interface WechatUploadResult {
  /** Base64-encoded hex string of the AES key — the format expected in outbound `media.aes_key`. */
  aesKey: string;
  /** AES-128-ECB ciphertext size (matches `mid_size` for image_item / video_item). */
  cipherSize: number;
  /** `encrypt_query_param` returned by CDN; place into outbound `media.encrypt_query_param`. */
  encryptQueryParam: string;
  /** Plaintext file size. */
  rawSize: number;
}

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
      lastResponse = await this.sendItem(
        toUserId,
        { text_item: { text: chunk }, type: MessageItemType.TEXT },
        contextToken,
      );
    }

    return lastResponse;
  }

  /**
   * Send a single MessageItem (text or media) via iLink Bot API.
   *
   * Per protocol-spec §6.7, the stable public pattern is one MessageItem per
   * request — text + media messages are sent as separate calls. Callers should
   * generate fresh `client_id`s per call; this method allocates one internally.
   */
  async sendItem(
    toUserId: string,
    item: MessageItem,
    contextToken: string,
  ): Promise<WechatSendMessageResponse> {
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

    return parseResponse<WechatSendMessageResponse>(response, 'sendmessage');
  }

  /**
   * Upload outbound media to the iLink CDN.
   *
   * Implements the 3-step flow from protocol-spec §8.2:
   *   1. `getuploadurl` — request `upload_param` with media metadata + AES key
   *   2. Local AES-128-ECB + PKCS7 encrypt
   *   3. POST ciphertext to CDN; read `x-encrypted-param` response header
   *
   * The returned `aesKey` is base64-of-hex-string (the format openclaw uses for
   * outbound `media.aes_key`, see protocol-spec §8.4 format B). Plug the result
   * directly into `image_item.media` / `file_item.media` / `video_item.media`.
   */
  async uploadCdnMedia(
    toUserId: string,
    mediaType: WechatUploadMediaType,
    plaintext: Buffer,
  ): Promise<WechatUploadResult> {
    const aesKeyBuf = randomBytes(16);
    const aesKeyHex = aesKeyBuf.toString('hex');
    const filekey = randomBytes(16).toString('hex');
    const rawSize = plaintext.length;
    const ciphertext = encryptAesEcb(plaintext, aesKeyBuf);
    const cipherSize = ciphertext.length;
    const rawfilemd5 = createHash('md5').update(plaintext).digest('hex');

    // Step 1: request upload_param
    const uploadParamResp = await fetch(`${this.baseUrl}/ilink/bot/getuploadurl`, {
      body: JSON.stringify({
        aeskey: aesKeyHex,
        base_info: BASE_INFO,
        filekey,
        filesize: cipherSize,
        media_type: mediaType,
        no_need_thumb: true,
        rawfilemd5,
        rawsize: rawSize,
        to_user_id: toUserId,
      }),
      headers: buildHeaders(this.botToken),
      method: 'POST',
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });

    const { upload_param: uploadParam } = await parseResponse<{ upload_param?: string }>(
      uploadParamResp,
      'getuploadurl',
    );
    if (!uploadParam) {
      throw new Error('getuploadurl returned empty upload_param');
    }

    // Step 2 + 3: upload ciphertext to CDN
    const cdnUrl = `${CDN_BASE_URL}/upload?encrypted_query_param=${encodeURIComponent(
      uploadParam,
    )}&filekey=${filekey}`;
    const cdnResp = await fetch(cdnUrl, {
      body: new Uint8Array(ciphertext),
      headers: { 'Content-Type': 'application/octet-stream' },
      method: 'POST',
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });

    if (!cdnResp.ok) {
      const text = await cdnResp.text().catch(() => '');
      throw new Error(`CDN upload failed: ${cdnResp.status} ${text}`);
    }

    const encryptQueryParam = cdnResp.headers.get('x-encrypted-param');
    if (!encryptQueryParam) {
      throw new Error('CDN upload response missing x-encrypted-param header');
    }

    // Outbound media.aes_key encoding follows openclaw: base64 of the 32-char hex string
    // (protocol-spec §8.4 format B). Inbound code accepts both formats.
    const aesKey = Buffer.from(aesKeyHex, 'ascii').toString('base64');

    return { aesKey, cipherSize, encryptQueryParam, rawSize };
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
  /** URL payload that clients must encode into a QR code for scanning. */
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
 * AES-128-ECB encrypt with PKCS7 padding (Node's default for createCipheriv).
 *
 * Used for outbound media uploads — see {@link WechatApiClient.uploadCdnMedia}.
 */
function encryptAesEcb(plaintext: Buffer, key: Buffer): Buffer {
  const cipher = createCipheriv('aes-128-ecb', key, null);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]);
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
