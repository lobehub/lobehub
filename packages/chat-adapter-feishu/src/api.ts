const BASE_URLS: Record<string, string> = {
  feishu: 'https://open.feishu.cn/open-apis',
  lark: 'https://open.larksuite.com/open-apis',
};

const MAX_TEXT_LENGTH = 4000;

/**
 * Lightweight wrapper around the Lark/Feishu Open API.
 *
 * Auth: app_id + app_secret -> tenant_access_token (cached, auto-refreshed).
 */
export class LarkApiClient {
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

  async sendMessage(chatId: string, text: string): Promise<{ messageId: string; raw: any }> {
    const data = await this.call('POST', '/im/v1/messages?receive_id_type=chat_id', {
      content: JSON.stringify({ text: this.truncateText(text) }),
      msg_type: 'text',
      receive_id: chatId,
    });
    return { messageId: data.data.message_id, raw: data.data };
  }

  async editMessage(messageId: string, text: string): Promise<{ raw: any }> {
    const data = await this.call('PUT', `/im/v1/messages/${messageId}`, {
      content: JSON.stringify({ text: this.truncateText(text) }),
      msg_type: 'text',
    });
    return { raw: data.data };
  }

  async deleteMessage(messageId: string): Promise<void> {
    await this.call('DELETE', `/im/v1/messages/${messageId}`, {});
  }

  async getMessage(messageId: string): Promise<any> {
    const data = await this.call('GET', `/im/v1/messages/${messageId}`, {});
    return data.data;
  }

  async listMessages(
    chatId: string,
    options?: { pageSize?: number; pageToken?: string; startTime?: string; endTime?: string },
  ): Promise<{ items: any[]; hasMore: boolean; pageToken?: string }> {
    const params = new URLSearchParams({ container_id_type: 'chat', container_id: chatId });
    if (options?.pageSize) params.set('page_size', String(options.pageSize));
    if (options?.pageToken) params.set('page_token', options.pageToken);
    if (options?.startTime) params.set('start_time', options.startTime);
    if (options?.endTime) params.set('end_time', options.endTime);

    const data = await this.call('GET', `/im/v1/messages?${params.toString()}`, {});
    return {
      hasMore: data.data.has_more,
      items: data.data.items || [],
      pageToken: data.data.page_token,
    };
  }

  async replyMessage(messageId: string, text: string): Promise<{ messageId: string; raw: any }> {
    const data = await this.call('POST', `/im/v1/messages/${messageId}/reply`, {
      content: JSON.stringify({ text: this.truncateText(text) }),
      msg_type: 'text',
    });
    return { messageId: data.data.message_id, raw: data.data };
  }

  async addReaction(messageId: string, emojiType: string): Promise<void> {
    await this.call('POST', `/im/v1/messages/${messageId}/reactions`, {
      reaction_type: { emoji_type: emojiType },
    });
  }

  async removeReaction(messageId: string, reactionId: string): Promise<void> {
    await this.call('DELETE', `/im/v1/messages/${messageId}/reactions/${reactionId}`, {});
  }

  // ------------------------------------------------------------------
  // Chat info
  // ------------------------------------------------------------------

  async getChatInfo(chatId: string): Promise<any> {
    const data = await this.call('GET', `/im/v1/chats/${chatId}`, {});
    return data.data;
  }

  async getBotInfo(): Promise<any> {
    const data = await this.call('GET', '/bot/v3/info', {});
    return data.bot;
  }

  async getUserInfo(openId: string): Promise<{ name?: string } | null> {
    const userIdType = openId.startsWith('ou_')
      ? 'open_id'
      : openId.startsWith('on_')
        ? 'union_id'
        : 'user_id';

    const data = await this.call(
      'GET',
      `/contact/v3/users/${openId}?user_id_type=${userIdType}`,
      {},
    );
    const user = data.data?.user;
    if (!user) return null;

    const name = user.name || user.display_name || user.nickname || user.en_name;
    return name ? { name } : null;
  }

  // ------------------------------------------------------------------
  // Media / Resource download
  // ------------------------------------------------------------------

  /**
   * Download a message resource (image, file, audio, video, sticker).
   *
   * @see https://open.feishu.cn/document/server-docs/im-v1/message-attachment/get
   * @param messageId - The message_id that contains the resource
   * @param fileKey   - file_key or image_key from the message content
   * @param type      - Resource type: 'image' | 'file'
   */
  async downloadResource(
    messageId: string,
    fileKey: string,
    type: 'image' | 'file',
  ): Promise<Buffer> {
    const token = await this.getTenantAccessToken();
    const url = `${this.baseUrl}/im/v1/messages/${messageId}/resources/${fileKey}?type=${type}`;

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      method: 'GET',
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Lark downloadResource failed: ${response.status} ${text}`);
    }

    return Buffer.from(await response.arrayBuffer());
  }

  // ------------------------------------------------------------------
  // Auth
  // ------------------------------------------------------------------

  async getTenantAccessToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.tokenExpiresAt) {
      return this.cachedToken;
    }

    const response = await fetch(`${this.baseUrl}/auth/v3/tenant_access_token/internal`, {
      body: JSON.stringify({ app_id: this.appId, app_secret: this.appSecret }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Lark auth failed: ${response.status} ${text}`);
    }

    const data: any = await response.json();
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

    const init: RequestInit = {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      method,
    };

    if (method !== 'GET' && method !== 'DELETE') {
      init.body = JSON.stringify(body);
    }

    const response = await fetch(url, init);

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Lark API ${method} ${path} failed: ${response.status} ${text}`);
    }

    const data: any = await response.json();

    if (data.code !== 0) {
      throw new Error(`Lark API ${method} ${path} failed: ${data.code} ${data.msg}`);
    }

    return data;
  }
}
