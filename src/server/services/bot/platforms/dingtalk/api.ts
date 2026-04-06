const OAUTH_ACCESS_TOKEN_URL = 'https://api.dingtalk.com/v1.0/oauth2/accessToken';
const ROBOT_O_TO_MESSAGES_URL = 'https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend';
const ROBOT_GROUP_MESSAGES_URL = 'https://api.dingtalk.com/v1.0/robot/groupMessages/send';

interface OAuthAccessTokenResponse {
  accessToken?: string;
  expireIn?: number;
}

export interface DingTalkApiOptions {
  appKey: string;
  appSecret: string;
}

export interface DingTalkSendTextMessageParams {
  content: string;
  openConversationId?: string;
  userIds?: string[];
}

/**
 * Minimal DingTalk API helper.
 * - Fetches OAuth access token via appKey/appSecret
 * - Caches the token and refreshes ~1 minute before expiry
 */
export class DingTalkApi {
  private readonly appKey: string;
  private readonly appSecret: string;

  private cached?: { token: string; expiresAt: number };

  constructor(options: DingTalkApiOptions) {
    this.appKey = options.appKey;
    this.appSecret = options.appSecret;
  }

  async getAccessToken(): Promise<string> {
    const now = Date.now();

    // Refresh the token ~1 minute before expiry to avoid edge-of-expiry failures.
    if (this.cached && now < this.cached.expiresAt - 60_000) return this.cached.token;

    const { token, expiresAt } = await this.fetchAccessToken();
    this.cached = { token, expiresAt };

    return token;
  }

  async sendTextMessage(params: DingTalkSendTextMessageParams): Promise<unknown> {
    const openConversationId =
      typeof params.openConversationId === 'string' ? params.openConversationId.trim() : '';
    const userIds = Array.isArray(params.userIds)
      ? params.userIds.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim())
      : [];

    const hasGroupTarget = Boolean(openConversationId);
    const hasUserTargets = userIds.length > 0;

    if (hasGroupTarget === hasUserTargets) {
      const reason = hasGroupTarget
        ? 'received both openConversationId and userIds'
        : 'received neither openConversationId nor userIds';
      throw new Error(
        `sendTextMessage requires exactly one target: openConversationId (group) or userIds (direct); ${reason}`,
      );
    }

    const token = await this.getAccessToken();

    const isGroup = hasGroupTarget;
    const url = isGroup ? ROBOT_GROUP_MESSAGES_URL : ROBOT_O_TO_MESSAGES_URL;

    // DingTalk proactive robot API uses message templates (sampleText / sampleMarkdown).
    const payload = {
      // DingTalk contract: robotCode is the appKey (a.k.a clientId).
      robotCode: this.appKey,
      msgKey: 'sampleText',
      msgParam: JSON.stringify({ content: params.content }),
      ...(isGroup
        ? { openConversationId }
        : { userIds }),
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-acs-dingtalk-access-token': token,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      throw new Error(`DingTalk robot send failed with status ${res.status}`);
    }

    return res.json();
  }

  private async fetchAccessToken(): Promise<{ token: string; expiresAt: number }> {
    const res = await fetch(OAUTH_ACCESS_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ appKey: this.appKey, appSecret: this.appSecret }),
    });

    if (!res.ok) {
      throw new Error(`DingTalk OAuth failed with status ${res.status}`);
    }

    const data = (await res.json()) as OAuthAccessTokenResponse;
    const accessToken = data.accessToken;
    const expireIn = data.expireIn;

    if (!accessToken || !expireIn) {
      throw new Error('DingTalk OAuth response is missing accessToken/expireIn');
    }

    return { token: accessToken, expiresAt: Date.now() + expireIn * 1000 };
  }
}
