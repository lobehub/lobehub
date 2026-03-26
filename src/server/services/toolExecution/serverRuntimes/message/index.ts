import { MessageToolIdentifier } from '@lobechat/builtin-tool-message';
import { MessageExecutionRuntime } from '@lobechat/builtin-tool-message/executionRuntime';
import { LarkApiClient } from '@lobechat/chat-adapter-feishu';
import { QQApiClient } from '@lobechat/chat-adapter-qq';

import { AgentBotProviderModel } from '@/database/models/agentBotProvider';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { DiscordApi } from '@/server/services/bot/platforms/discord/api';
import { DiscordMessageAdapter } from '@/server/services/bot/platforms/discord/service';
import { FeishuMessageAdapter } from '@/server/services/bot/platforms/feishu/service';
import { QQMessageAdapter } from '@/server/services/bot/platforms/qq/service';
import { SlackApi } from '@/server/services/bot/platforms/slack/api';
import { SlackMessageAdapter } from '@/server/services/bot/platforms/slack/service';
import { TelegramApi } from '@/server/services/bot/platforms/telegram/api';
import { TelegramMessageAdapter } from '@/server/services/bot/platforms/telegram/service';
import { WechatMessageAdapter } from '@/server/services/bot/platforms/wechat/service';

import type { ServerRuntimeRegistration } from '../types';
import { MessageDispatcherService } from './MessageDispatcherService';

/**
 * Resolves credentials for the given platform from the user's configured bot providers.
 */
const resolveCredentials = async (
  providerModel: AgentBotProviderModel,
  platform: string,
): Promise<{ applicationId: string; credentials: Record<string, string> }> => {
  const providers = await providerModel.query({ platform });
  const enabled = providers.find((p) => p.enabled);
  if (!enabled?.credentials) {
    throw new Error(
      `No enabled ${platform} bot provider found. ` +
        `Please configure a ${platform} integration in your bot settings.`,
    );
  }
  return { applicationId: enabled.applicationId, credentials: enabled.credentials };
};

export const messageRuntime: ServerRuntimeRegistration = {
  factory: async (context) => {
    if (!context.serverDB) {
      throw new Error('serverDB is required for Message tool execution');
    }
    if (!context.userId) {
      throw new Error('userId is required for Message tool execution');
    }

    const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
    const providerModel = new AgentBotProviderModel(context.serverDB, context.userId, gateKeeper);

    const service = new MessageDispatcherService({
      discord: async () => {
        const { credentials } = await resolveCredentials(providerModel, 'discord');
        return new DiscordMessageAdapter(new DiscordApi(credentials.botToken));
      },
      feishu: async () => {
        const { applicationId, credentials } = await resolveCredentials(providerModel, 'feishu');
        return new FeishuMessageAdapter(
          new LarkApiClient(applicationId, credentials.appSecret, 'feishu'),
          'feishu',
        );
      },
      lark: async () => {
        const { applicationId, credentials } = await resolveCredentials(providerModel, 'lark');
        return new FeishuMessageAdapter(
          new LarkApiClient(applicationId, credentials.appSecret, 'lark'),
          'lark',
        );
      },
      qq: async () => {
        const { applicationId, credentials } = await resolveCredentials(providerModel, 'qq');
        return new QQMessageAdapter(new QQApiClient(applicationId, credentials.appSecret));
      },
      slack: async () => {
        const { credentials } = await resolveCredentials(providerModel, 'slack');
        return new SlackMessageAdapter(new SlackApi(credentials.botToken));
      },
      telegram: async () => {
        const { credentials } = await resolveCredentials(providerModel, 'telegram');
        return new TelegramMessageAdapter(new TelegramApi(credentials.botToken));
      },
      wechat: async () => {
        return new WechatMessageAdapter();
      },
    });

    return new MessageExecutionRuntime({ service });
  },
  identifier: MessageToolIdentifier,
};
