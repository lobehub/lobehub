import type {
  QQAccessTokenResponse,
  QQGatewayUrlResponse,
  QQSendMessageParams,
  QQSendMessageResponse,
} from './types';
import { QQ_MSG_TYPE } from './types';

const AUTH_URL = 'https://bots.qq.com/app/getAppAccessToken';
const API_BASE_URL = 'https://api.sgroup.qq.com';
const MAX_TEXT_LENGTH = 2000;

export class QQApiClient {
  private readonly appId: string;
  private readonly clientSecret: string;
  private cachedToken?: string;
  private tokenExpiresAt = 0;

  constructor(appId: string, clientSecret: string) {
    this.appId = appId;
    this.clientSecret = clientSecret;
  }

  async getAccessToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.tokenExpiresAt) {
      return this.cachedToken;
    }

    const response = await fetch(AUTH_URL, {
      body: JSON.stringify({
        appId: this.appId,
        clientSecret: this.clientSecret,
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`QQ auth failed: ${response.status} ${text}`);
    }

    const data = (await response.json()) as QQAccessTokenResponse;

    this.cachedToken = data.access_token;
    // Refresh 5 minutes before expiration
    this.tokenExpiresAt = Date.now() + (data.expires_in - 300) * 1000;

    return this.cachedToken;
  }

  private async call<T>(method: string, path: string, body?: Record<string, unknown>): Promise<T> {
    const token = await this.getAccessToken();
    const url = `${API_BASE_URL}${path}`;

    const init: RequestInit = {
      headers: {
        'Authorization': `QQBot ${token}`,
        'Content-Type': 'application/json',
      },
      method,
    };

    if (body && method !== 'GET' && method !== 'DELETE') {
      init.body = JSON.stringify(body);
    }

    const response = await fetch(url, init);

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`QQ API ${method} ${path} failed: ${response.status} ${text}`);
    }

    // Some endpoints return empty response
    const contentType = response.headers.get('content-type');
    if (contentType?.includes('application/json')) {
      return response.json() as Promise<T>;
    }

    return {} as T;
  }

  /**
   * Send message to a QQ group
   */
  async sendGroupMessage(
    groupOpenId: string,
    content: string,
    options?: { eventId?: string; msgId?: string; msgSeq?: number },
  ): Promise<QQSendMessageResponse> {
    const params: QQSendMessageParams = {
      content: this.truncateText(content),
      msg_type: QQ_MSG_TYPE.TEXT,
    };

    if (options?.msgId) {
      params.msg_id = options.msgId;
    }
    if (options?.eventId) {
      params.event_id = options.eventId;
    }
    if (options?.msgSeq !== undefined) {
      params.msg_seq = options.msgSeq;
    }

    return this.call<QQSendMessageResponse>('POST', `/v2/groups/${groupOpenId}/messages`, params);
  }

  /**
   * Send message to a QQ guild channel
   */
  async sendGuildMessage(
    channelId: string,
    content: string,
    options?: { eventId?: string; msgId?: string },
  ): Promise<QQSendMessageResponse> {
    const params: QQSendMessageParams = {
      content: this.truncateText(content),
      msg_type: QQ_MSG_TYPE.TEXT,
    };

    if (options?.msgId) {
      params.msg_id = options.msgId;
    }
    if (options?.eventId) {
      params.event_id = options.eventId;
    }

    return this.call<QQSendMessageResponse>('POST', `/channels/${channelId}/messages`, params);
  }

  /**
   * Send direct message to a user (C2C)
   */
  async sendC2CMessage(
    openId: string,
    content: string,
    options?: { eventId?: string; msgId?: string; msgSeq?: number },
  ): Promise<QQSendMessageResponse> {
    const params: QQSendMessageParams = {
      content: this.truncateText(content),
      msg_type: QQ_MSG_TYPE.TEXT,
    };

    if (options?.msgId) {
      params.msg_id = options.msgId;
    }
    if (options?.eventId) {
      params.event_id = options.eventId;
    }
    if (options?.msgSeq !== undefined) {
      params.msg_seq = options.msgSeq;
    }

    return this.call<QQSendMessageResponse>('POST', `/v2/users/${openId}/messages`, params);
  }

  /**
   * Send direct message in a guild (DMS)
   */
  async sendDmsMessage(
    guildId: string,
    content: string,
    options?: { eventId?: string; msgId?: string },
  ): Promise<QQSendMessageResponse> {
    const params: QQSendMessageParams = {
      content: this.truncateText(content),
      msg_type: QQ_MSG_TYPE.TEXT,
    };

    if (options?.msgId) {
      params.msg_id = options.msgId;
    }
    if (options?.eventId) {
      params.event_id = options.eventId;
    }

    return this.call<QQSendMessageResponse>('POST', `/dms/${guildId}/messages`, params);
  }

  /**
   * Get the WebSocket gateway URL for establishing a persistent connection.
   */
  async getGatewayUrl(): Promise<QQGatewayUrlResponse> {
    return this.call<QQGatewayUrlResponse>('GET', '/gateway');
  }

  /**
   * Get bot information
   */
  async getBotInfo(): Promise<{ avatar: string; id: string; username: string } | null> {
    try {
      const data = await this.call<{ avatar: string; id: string; username: string }>(
        'GET',
        '/users/@me',
      );
      return data;
    } catch {
      return null;
    }
  }

  private truncateText(text: string): string {
    if (text.length > MAX_TEXT_LENGTH) {
      return text.slice(0, MAX_TEXT_LENGTH - 3) + '...';
    }
    return text;
  }
}
