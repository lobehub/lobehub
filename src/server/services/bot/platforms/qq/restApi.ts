import debug from 'debug';

const log = debug('lobe-server:bot:qq-rest');

const AUTH_URL = 'https://bots.qq.com/app/getAppAccessToken';
export const QQ_API_BASE = 'https://api.sgroup.qq.com';

const MAX_TEXT_LENGTH = 2000;

/**
 * Lightweight wrapper around the QQ Bot API.
 * Used by bot-callback webhooks to send messages directly.
 *
 * Auth: appId + clientSecret → access_token (cached, auto-refreshed).
 */
export class QQRestApi {
  private readonly appId: string;
  private readonly clientSecret: string;

  private cachedToken?: string;
  private tokenExpiresAt = 0;

  constructor(appId: string, clientSecret: string) {
    this.appId = appId;
    this.clientSecret = clientSecret;
  }

  // ------------------------------------------------------------------
  // Messages
  // ------------------------------------------------------------------

  async sendMessage(
    threadType: string,
    targetId: string,
    content: string,
  ): Promise<{ id: string }> {
    log('sendMessage: type=%s, targetId=%s', threadType, targetId);

    const path = this.getMessagePath(threadType, targetId);
    const data = await this.call<{ id: string }>('POST', path, {
      content: this.truncateText(content),
      msg_type: 0, // TEXT
    });
    return { id: data.id };
  }

  /**
   * QQ does not support editing messages.
   * Fallback: send a new message instead.
   */
  async sendAsEdit(threadType: string, targetId: string, content: string): Promise<{ id: string }> {
    log('sendAsEdit (QQ no edit support): type=%s, targetId=%s', threadType, targetId);
    return this.sendMessage(threadType, targetId, content);
  }

  // ------------------------------------------------------------------
  // Auth
  // ------------------------------------------------------------------

  async getAccessToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.tokenExpiresAt) {
      return this.cachedToken;
    }

    log('getAccessToken: refreshing for appId=%s', this.appId);

    const response = await fetch(AUTH_URL, {
      body: JSON.stringify({ appId: this.appId, clientSecret: this.clientSecret }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`QQ auth failed: ${response.status} ${text}`);
    }

    const data = await response.json();

    this.cachedToken = data.access_token;
    // Expire 5 minutes early to avoid edge cases
    this.tokenExpiresAt = Date.now() + (data.expires_in - 300) * 1000;

    return this.cachedToken!;
  }

  // ------------------------------------------------------------------
  // Internal
  // ------------------------------------------------------------------

  private getMessagePath(threadType: string, targetId: string): string {
    switch (threadType) {
      case 'group': {
        return `/v2/groups/${targetId}/messages`;
      }
      case 'guild': {
        return `/channels/${targetId}/messages`;
      }
      case 'c2c': {
        return `/v2/users/${targetId}/messages`;
      }
      case 'dms': {
        return `/dms/${targetId}/messages`;
      }
      default: {
        return `/v2/groups/${targetId}/messages`;
      }
    }
  }

  private truncateText(text: string): string {
    if (text.length > MAX_TEXT_LENGTH) return text.slice(0, MAX_TEXT_LENGTH - 3) + '...';
    return text;
  }

  private async call<T>(method: string, path: string, body: Record<string, unknown>): Promise<T> {
    const token = await this.getAccessToken();
    const url = `${QQ_API_BASE}${path}`;

    const response = await fetch(url, {
      body: JSON.stringify(body),
      headers: {
        'Authorization': `QQBot ${token}`,
        'Content-Type': 'application/json',
      },
      method,
    });

    if (!response.ok) {
      const text = await response.text();
      log('QQ API error: %s %s, status=%d, body=%s', method, path, response.status, text);
      throw new Error(`QQ API ${method} ${path} failed: ${response.status} ${text}`);
    }

    const contentType = response.headers.get('content-type');
    if (contentType?.includes('application/json')) {
      return response.json() as Promise<T>;
    }

    return {} as T;
  }
}
