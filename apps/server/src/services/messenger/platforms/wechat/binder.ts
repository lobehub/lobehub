import { appEnv } from '@/envs/app';
import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';
import type { PlatformClient } from '@/server/services/bot/platforms';
import { WechatClientFactory } from '@/server/services/bot/platforms/wechat/client';

import type { InstallationCredentials } from '../../installations/types';
import type { MessengerPlatformBinder } from '../../types';

export class MessengerWechatBinder implements MessengerPlatformBinder {
  constructor(private readonly credentials?: InstallationCredentials) {}

  async createClient(): Promise<PlatformClient | null> {
    if (!this.credentials?.botToken) return null;

    return new WechatClientFactory().createClient(
      {
        applicationId: this.credentials.applicationId,
        credentials: {
          baseUrl: this.credentials.baseUrl ?? '',
          botId: this.credentials.botId ?? this.credentials.applicationId,
          botToken: this.credentials.botToken,
        },
        platform: 'wechat',
        settings: {},
      },
      {
        appUrl: appEnv.APP_URL,
        redisClient: getAgentRuntimeRedisClient() as any,
      },
    );
  }

  async handleUnlinkedMessage(): Promise<void> {
    // WeChat account connections resolve by the exact scanned user id. Unknown
    // contacts fail closed in the credential store and never reach here.
  }

  async notifyLinkSuccess(): Promise<void> {
    // QR confirmation happens before an inbound context_token exists. The
    // settings UI is the durable success surface; the first WeChat message
    // establishes the token used for subsequent replies.
  }

  async sendDmText(chatId: string, text: string): Promise<void> {
    const client = await this.createClient();
    if (!client) return;
    await client.getMessenger(`wechat:dm:${chatId}`).createMessage(text);
  }
}
