import type {
  WechatBotInfoResponse,
  WechatGetUpdatesResponse,
  WechatSendMessageParams,
  WechatSendMessageResponse,
} from './types';
import { WECHAT_ERROR_CODES, WECHAT_MSG_TYPE } from './types';

const API_BASE_URL = 'https://ilinkai.weixin.qq.com/cgi-bin';
const MAX_TEXT_LENGTH = 2048;
const DEFAULT_POLL_TIMEOUT = 35;

export class WechatApiClient {
  private readonly appToken: string;

  constructor(appToken: string) {
    this.appToken = appToken;
  }

  /**
   * Long-poll for new messages from iLink Bot API.
   *
   * @param offset - Cursor offset for pagination (next offset from previous response)
   * @param timeout - Long-poll timeout in seconds (default 35s)
   * @param signal - AbortSignal for cancellation
   */
  async getUpdates(
    offset?: number,
    timeout: number = DEFAULT_POLL_TIMEOUT,
    signal?: AbortSignal,
  ): Promise<WechatGetUpdatesResponse> {
    const body: Record<string, unknown> = { timeout };
    if (offset !== undefined) {
      body.offset = offset;
    }

    const response = await fetch(`${API_BASE_URL}/getUpdates`, {
      body: JSON.stringify(body),
      headers: {
        'Authorization': `Bearer ${this.appToken}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
      signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`iLink getUpdates failed: ${response.status} ${text}`);
    }

    return response.json() as Promise<WechatGetUpdatesResponse>;
  }

  /**
   * Send a text message via iLink Bot API.
   */
  async sendMessage(params: WechatSendMessageParams): Promise<WechatSendMessageResponse> {
    const body: Record<string, unknown> = {
      content: this.truncateText(params.content),
      to: params.to,
      type: params.type ?? WECHAT_MSG_TYPE.TEXT,
    };

    if (params.contextToken) {
      body.contextToken = params.contextToken;
    }

    const response = await fetch(`${API_BASE_URL}/sendMessage`, {
      body: JSON.stringify(body),
      headers: {
        'Authorization': `Bearer ${this.appToken}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`iLink sendMessage failed: ${response.status} ${text}`);
    }

    const data = (await response.json()) as WechatSendMessageResponse;

    if (data.errcode !== WECHAT_ERROR_CODES.OK) {
      throw new Error(`iLink sendMessage error: ${data.errcode} ${data.errmsg}`);
    }

    return data;
  }

  /**
   * Get bot info to verify credentials.
   */
  async getBotInfo(): Promise<WechatBotInfoResponse> {
    const response = await fetch(`${API_BASE_URL}/getBotInfo`, {
      headers: {
        'Authorization': `Bearer ${this.appToken}`,
        'Content-Type': 'application/json',
      },
      method: 'GET',
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`iLink getBotInfo failed: ${response.status} ${text}`);
    }

    return response.json() as Promise<WechatBotInfoResponse>;
  }

  private truncateText(text: string): string {
    if (text.length > MAX_TEXT_LENGTH) {
      return text.slice(0, MAX_TEXT_LENGTH - 3) + '...';
    }
    return text;
  }
}
