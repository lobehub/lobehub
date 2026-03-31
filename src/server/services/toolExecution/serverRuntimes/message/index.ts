import { MessageToolIdentifier } from '@lobechat/builtin-tool-message';
import type { BotProviderQuery } from '@lobechat/builtin-tool-message/executionRuntime';
import { MessageExecutionRuntime } from '@lobechat/builtin-tool-message/executionRuntime';
import { LarkApiClient } from '@lobechat/chat-adapter-feishu';
import { QQApiClient } from '@lobechat/chat-adapter-qq';
import { WechatApiClient } from '@lobechat/chat-adapter-wechat';

import { AgentBotProviderModel } from '@/database/models/agentBotProvider';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { platformRegistry } from '@/server/services/bot/platforms';
import { DiscordApi } from '@/server/services/bot/platforms/discord/api';
import { DiscordMessageService } from '@/server/services/bot/platforms/discord/service';
import { FeishuMessageService } from '@/server/services/bot/platforms/feishu/service';
import { QQMessageService } from '@/server/services/bot/platforms/qq/service';
import { SlackApi } from '@/server/services/bot/platforms/slack/api';
import { SlackMessageService } from '@/server/services/bot/platforms/slack/service';
import { TelegramApi } from '@/server/services/bot/platforms/telegram/api';
import { TelegramMessageService } from '@/server/services/bot/platforms/telegram/service';
import { WechatMessageService } from '@/server/services/bot/platforms/wechat/service';
import { GatewayService } from '@/server/services/gateway';
import { getBotRuntimeStatus } from '@/server/services/gateway/runtimeStatus';

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
        return new DiscordMessageService(new DiscordApi(credentials.botToken));
      },
      feishu: async () => {
        const { applicationId, credentials } = await resolveCredentials(providerModel, 'feishu');
        return new FeishuMessageService(
          new LarkApiClient(applicationId, credentials.appSecret, 'feishu'),
          'feishu',
        );
      },
      lark: async () => {
        const { applicationId, credentials } = await resolveCredentials(providerModel, 'lark');
        return new FeishuMessageService(
          new LarkApiClient(applicationId, credentials.appSecret, 'lark'),
          'lark',
        );
      },
      qq: async () => {
        const { applicationId, credentials } = await resolveCredentials(providerModel, 'qq');
        return new QQMessageService(new QQApiClient(applicationId, credentials.appSecret));
      },
      slack: async () => {
        const { credentials } = await resolveCredentials(providerModel, 'slack');
        return new SlackMessageService(new SlackApi(credentials.botToken));
      },
      telegram: async () => {
        const { credentials } = await resolveCredentials(providerModel, 'telegram');
        return new TelegramMessageService(new TelegramApi(credentials.botToken));
      },
      wechat: async () => {
        const { applicationId, credentials } = await resolveCredentials(providerModel, 'wechat');
        return new WechatMessageService(
          new WechatApiClient(credentials.botToken, credentials.botId),
          applicationId,
        );
      },
    });

    const botProvider: BotProviderQuery = {
      connectBot: async (botId) => {
        const bot = await providerModel.findById(botId);
        if (!bot) throw new Error(`Bot not found: ${botId}`);
        const gateway = new GatewayService();
        const status = await gateway.startClient(bot.platform, bot.applicationId, context.userId!);
        return { status };
      },
      createBot: async (params) => {
        const result = await providerModel.create(params);
        return { id: result.id, platform: params.platform };
      },
      deleteBot: async (botId) => {
        await providerModel.delete(botId);
      },
      getBotDetail: async (botId) => {
        const bot = await providerModel.findById(botId);
        if (!bot) return null;
        const status = await getBotRuntimeStatus(bot.platform, bot.applicationId);
        return {
          applicationId: bot.applicationId,
          enabled: bot.enabled,
          id: bot.id,
          platform: bot.platform,
          runtimeStatus: status.status,
          settings: (bot.settings as Record<string, unknown>) ?? undefined,
        };
      },
      listBots: async () => {
        if (!context.agentId) {
          throw new Error('agentId is required to list bots');
        }
        const providers = await providerModel.findByAgentId(context.agentId);

        const statuses = await Promise.all(
          providers.map((p) => getBotRuntimeStatus(p.platform, p.applicationId)),
        );
        return providers.map((p, i) => ({
          applicationId: p.applicationId,
          enabled: p.enabled,
          id: p.id,
          serverId: (p.settings as any)?.serverId as string | undefined,
          userId: (p.settings as any)?.userId as string | undefined,
          platform: p.platform,
          runtimeStatus: statuses[i].status,
        }));
      },
      listPlatforms: async () => {
        return platformRegistry.listSerializedPlatforms().map((p) => {
          const credSchema = (p.schema ?? []).find(
            (f: any) => f.key === 'credentials' && f.properties,
          );
          const credFields = (credSchema as any)?.properties ?? [];
          return {
            credentialFields: credFields.map((f: any) => ({
              key: f.key,
              label: f.label ?? f.key,
              required: !!f.required,
              type: f.type ?? 'string',
            })),
            id: p.id,
            name: p.name,
          };
        });
      },
      toggleBot: async (botId, enabled) => {
        await providerModel.update(botId, { enabled });
      },
      updateBot: async (botId, params) => {
        await providerModel.update(botId, params);
      },
    };

    return new MessageExecutionRuntime({ botProvider, service });
  },
  identifier: MessageToolIdentifier,
};
