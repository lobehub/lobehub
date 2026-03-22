import type {
  BaseInfo,
  MessageItem,
  WechatGetConfigResponse,
  WechatGetUpdatesResponse,
  WechatSendMessageResponse,
} from './types';
import { MessageItemType, MessageState, MessageType, WECHAT_RET_CODES } from './types';

export const DEFAULT_BASE_URL = 'https://ilinkai.weixin.qq.com';
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

export class WechatApiClient {
  private readonly botToken: string;
  private readonly baseUrl: string;
  /** Bot's own user ID, needed for from_user_id in sendmessage */
  botId: string;

  constructor(botToken: string, botId?: string, baseUrl?: string) {
    this.botToken = botToken;
    this.botId = botId || '';
    this.baseUrl = (baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  }

  /**
   * Long-poll for new messages via iLink Bot API.
   * Server holds connection for ~35 seconds.
   *
   * @param cursor - Opaque `get_updates_buf` from previous response
   * @param signal - AbortSignal for cancellation
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
      signal: signal ?? AbortSignal.timeout(POLL_TIMEOUT_MS),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`iLink getupdates failed: ${response.status} ${text}`);
    }

    return response.json() as Promise<WechatGetUpdatesResponse>;
  }

  /**
   * Send a text message via iLink Bot API.
   *
   * @param toUserId - Target user ID (xxx@im.wechat)
   * @param text - Message text (auto-chunked at 2000 chars)
   * @param contextToken - context_token from the inbound message
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
          client_id: `lobehub_${Date.now()}`,
          context_token: contextToken,
          from_user_id: this.botId,
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

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`iLink sendmessage failed: ${response.status} ${errText}`);
      }

      lastResponse = (await response.json()) as WechatSendMessageResponse;

      if (lastResponse.ret !== WECHAT_RET_CODES.OK) {
        throw new Error(
          `iLink sendmessage error: ret=${lastResponse.ret} ${lastResponse.errmsg || ''}`,
        );
      }
    }

    return lastResponse;
  }

  /**
   * Send typing indicator via iLink Bot API.
   * @param start - true to start, false to stop
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
   * Get bot configuration (including typing_ticket).
   */
  async getConfig(): Promise<WechatGetConfigResponse> {
    const response = await fetch(`${this.baseUrl}/ilink/bot/getconfig`, {
      body: JSON.stringify({ base_info: BASE_INFO }),
      headers: buildHeaders(this.botToken),
      method: 'POST',
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`iLink getconfig failed: ${response.status} ${text}`);
    }

    return response.json() as Promise<WechatGetConfigResponse>;
  }

  /**
   * Verify bot token by attempting a getupdates call with empty cursor.
   * Returns true if the API responds successfully (ret === 0).
   */
  async verifyToken(): Promise<boolean> {
    const res = await this.getUpdates('', AbortSignal.timeout(DEFAULT_TIMEOUT_MS));
    return res.ret === WECHAT_RET_CODES.OK;
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
  const url = `${baseUrl.replace(/\/+$/, '')}/ilink/bot/get_bot_qrcode?bot_type=3`;
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
  const url = `${baseUrl.replace(/\/+$/, '')}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`;
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

/**
 * Split text into chunks of at most `limit` characters.
 */
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
