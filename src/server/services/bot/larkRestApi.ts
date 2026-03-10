import debug from 'debug';

const log = debug('lobe-server:bot:lark-rest');

const BASE_URLS: Record<string, string> = {
  feishu: 'https://open.feishu.cn/open-apis',
  lark: 'https://open.larksuite.com/open-apis',
};

// Lark message limit is ~32KB for content, but we cap text at 4000 chars for readability
const MAX_TEXT_LENGTH = 4000;

/**
 * Lightweight wrapper around the Lark/Feishu Open API.
 * Used by bot-callback webhooks and BotMessageRouter to send/edit messages directly.
 *
 * Auth: app_id + app_secret → tenant_access_token (cached, auto-refreshed).
 */
export class LarkRestApi {
  private readonly appId: string;
  private readonly appSecret: string;
  private readonly baseUrl: string;

  private cachedToken?: string;
  private tokenExpiresAt = 0;

  constructor(appId: string, appSecret: string, platform: string = 'lark') {
    this.appId = appId;
    this.appSecret = appSecret;
    this.baseUrl = BASE_URLS[platform] || BASE_URLS.lark;
  }

  // ------------------------------------------------------------------
  // Messages
  // ------------------------------------------------------------------

  async sendMessage(chatId: string, text: string): Promise<{ messageId: string }> {
    log('sendMessage: chatId=%s', chatId);
    const data = await this.call('POST', '/im/v1/messages?receive_id_type=chat_id', {
      content: JSON.stringify({ text: this.truncateText(text) }),
      msg_type: 'text',
      receive_id: chatId,
    });
    return { messageId: data.data.message_id };
  }

  async editMessage(messageId: string, text: string): Promise<void> {
    log('editMessage: messageId=%s', messageId);
    await this.call('PUT', `/im/v1/messages/${messageId}`, {
      content: JSON.stringify({ text: this.truncateText(text) }),
      msg_type: 'text',
    });
  }

  async replyMessage(messageId: string, text: string): Promise<{ messageId: string }> {
    log('replyMessage: messageId=%s', messageId);
    const data = await this.call('POST', `/im/v1/messages/${messageId}/reply`, {
      content: JSON.stringify({ text: this.truncateText(text) }),
      msg_type: 'text',
    });
    return { messageId: data.data.message_id };
  }

  // ------------------------------------------------------------------
  // Auth
  // ------------------------------------------------------------------

  async getTenantAccessToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.tokenExpiresAt) {
      return this.cachedToken;
    }

    log('getTenantAccessToken: refreshing for appId=%s', this.appId);

    const response = await fetch(`${this.baseUrl}/auth/v3/tenant_access_token/internal`, {
      body: JSON.stringify({ app_id: this.appId, app_secret: this.appSecret }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Lark auth failed: ${response.status} ${text}`);
    }

    const data = await response.json();
    if (data.code !== 0) {
      throw new Error(`Lark auth error: ${data.code} ${data.msg}`);
    }

    this.cachedToken = data.tenant_access_token;
    // Expire 5 minutes early to avoid edge cases
    this.tokenExpiresAt = Date.now() + (data.expire - 300) * 1000;

    return this.cachedToken!;
  }

  // ------------------------------------------------------------------
  // Internal
  // ------------------------------------------------------------------

  private truncateText(text: string): string {
    if (text.length > MAX_TEXT_LENGTH) return text.slice(0, MAX_TEXT_LENGTH - 3) + '...';
    return text;
  }

  private async call(method: string, path: string, body: Record<string, unknown>): Promise<any> {
    const token = await this.getTenantAccessToken();
    const url = `${this.baseUrl}${path}`;

    const response = await fetch(url, {
      body: JSON.stringify(body),
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      method,
    });

    if (!response.ok) {
      const text = await response.text();
      log('Lark API error: %s %s, status=%d, body=%s', method, path, response.status, text);
      throw new Error(`Lark API ${method} ${path} failed: ${response.status} ${text}`);
    }

    const data = await response.json();

    if (data.code !== 0) {
      log('Lark API logical error: %s %s, code=%d, msg=%s', method, path, data.code, data.msg);
      throw new Error(`Lark API ${method} ${path} failed: ${data.code} ${data.msg}`);
    }

    return data;
  }
}
