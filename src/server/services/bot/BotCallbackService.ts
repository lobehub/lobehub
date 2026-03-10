import debug from 'debug';

import { AgentBotProviderModel } from '@/database/models/agentBotProvider';
import { TopicModel } from '@/database/models/topic';
import { type LobeChatDatabase } from '@/database/type';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { SystemAgentService } from '@/server/services/systemAgent';

import { DiscordRestApi } from './discordRestApi';
import { LarkRestApi } from './larkRestApi';
import { renderError, renderFinalReply, renderStepProgress, splitMessage } from './replyTemplate';
import { TelegramRestApi } from './telegramRestApi';

const log = debug('lobe-server:bot:callback');

// --------------- Platform helpers ---------------

function extractDiscordChannelId(platformThreadId: string): string {
  const parts = platformThreadId.split(':');
  return parts[3] || parts[2];
}

function extractTelegramChatId(platformThreadId: string): string {
  return platformThreadId.split(':')[1];
}

function extractLarkChatId(platformThreadId: string): string {
  return platformThreadId.split(':')[1];
}

function parseTelegramMessageId(compositeId: string): number {
  const colonIdx = compositeId.lastIndexOf(':');
  return colonIdx !== -1 ? Number(compositeId.slice(colonIdx + 1)) : Number(compositeId);
}

const TELEGRAM_CHAR_LIMIT = 4000;
const LARK_CHAR_LIMIT = 4000;

// --------------- Platform-agnostic messenger ---------------

interface PlatformMessenger {
  createMessage: (content: string) => Promise<void>;
  editMessage: (messageId: string, content: string) => Promise<void>;
  removeReaction: (messageId: string, emoji: string) => Promise<void>;
  triggerTyping: () => Promise<void>;
  updateThreadName?: (name: string) => Promise<void>;
}

function createDiscordMessenger(
  discord: DiscordRestApi,
  channelId: string,
  platformThreadId: string,
): PlatformMessenger {
  return {
    createMessage: (content) => discord.createMessage(channelId, content).then(() => {}),
    editMessage: (messageId, content) => discord.editMessage(channelId, messageId, content),
    removeReaction: (messageId, emoji) => discord.removeOwnReaction(channelId, messageId, emoji),
    triggerTyping: () => discord.triggerTyping(channelId),
    updateThreadName: (name) => {
      const threadId = platformThreadId.split(':')[3];
      return threadId ? discord.updateChannelName(threadId, name) : Promise.resolve();
    },
  };
}

function createTelegramMessenger(telegram: TelegramRestApi, chatId: string): PlatformMessenger {
  return {
    createMessage: (content) => telegram.sendMessage(chatId, content).then(() => {}),
    editMessage: (messageId, content) =>
      telegram.editMessageText(chatId, parseTelegramMessageId(messageId), content),
    removeReaction: (messageId) =>
      telegram.removeMessageReaction(chatId, parseTelegramMessageId(messageId)),
    triggerTyping: () => telegram.sendChatAction(chatId, 'typing'),
  };
}

function createLarkMessenger(lark: LarkRestApi, chatId: string): PlatformMessenger {
  return {
    createMessage: (content) => lark.sendMessage(chatId, content).then(() => {}),
    editMessage: (messageId, content) => lark.editMessage(messageId, content),
    // Lark has no reaction/typing API for bots
    removeReaction: () => Promise.resolve(),
    triggerTyping: () => Promise.resolve(),
  };
}

// --------------- Callback body types ---------------

export interface BotCallbackBody {
  applicationId: string;
  content?: string;
  cost?: number;
  duration?: number;
  elapsedMs?: number;
  errorMessage?: string;
  executionTimeMs?: number;
  lastAssistantContent?: string;
  lastLLMContent?: string;
  lastToolsCalling?: any;
  llmCalls?: number;
  platformThreadId: string;
  progressMessageId: string;
  reactionChannelId?: string;
  reason?: string;
  reasoning?: string;
  shouldContinue?: boolean;
  stepType?: 'call_llm' | 'call_tool';
  thinking?: boolean;
  toolCalls?: number;
  toolsCalling?: any;
  toolsResult?: any;
  topicId?: string;
  totalCost?: number;
  totalInputTokens?: number;
  totalOutputTokens?: number;
  totalSteps?: number;
  totalTokens?: number;
  totalToolCalls?: any;
  type: 'completion' | 'step';
  userId?: string;
  userMessageId?: string;
  userPrompt?: string;
}

// --------------- Service ---------------

export class BotCallbackService {
  private readonly db: LobeChatDatabase;

  constructor(db: LobeChatDatabase) {
    this.db = db;
  }

  async handleCallback(body: BotCallbackBody): Promise<void> {
    const { type, applicationId, platformThreadId, progressMessageId } = body;
    const platform = platformThreadId.split(':')[0];

    const { botToken, messenger, charLimit } = await this.createMessenger(
      platform,
      applicationId,
      platformThreadId,
    );

    if (type === 'step') {
      await this.handleStep(body, messenger, progressMessageId, platform);
    } else if (type === 'completion') {
      await this.handleCompletion(body, messenger, progressMessageId, platform, charLimit);
      await this.removeEyesReaction(body, messenger, botToken, platform, platformThreadId);
      this.summarizeTopicTitle(body, messenger);
    }
  }

  private async createMessenger(
    platform: string,
    applicationId: string,
    platformThreadId: string,
  ): Promise<{ botToken: string; charLimit?: number; messenger: PlatformMessenger }> {
    const row = await AgentBotProviderModel.findByPlatformAndAppId(
      this.db,
      platform,
      applicationId,
    );

    if (!row?.credentials) {
      throw new Error(`Bot provider not found for ${platform} appId=${applicationId}`);
    }

    const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
    let credentials: Record<string, string>;
    try {
      credentials = JSON.parse((await gateKeeper.decrypt(row.credentials)).plaintext);
    } catch {
      credentials = JSON.parse(row.credentials);
    }

    const isLark = platform === 'lark' || platform === 'feishu';

    if (isLark ? !credentials.appId || !credentials.appSecret : !credentials.botToken) {
      throw new Error(`Bot credentials incomplete for ${platform} appId=${applicationId}`);
    }

    switch (platform) {
      case 'telegram': {
        const telegram = new TelegramRestApi(credentials.botToken);
        const chatId = extractTelegramChatId(platformThreadId);
        return {
          botToken: credentials.botToken,
          charLimit: TELEGRAM_CHAR_LIMIT,
          messenger: createTelegramMessenger(telegram, chatId),
        };
      }
      case 'lark':
      case 'feishu': {
        const lark = new LarkRestApi(credentials.appId, credentials.appSecret, platform);
        const chatId = extractLarkChatId(platformThreadId);
        return {
          botToken: credentials.appId,
          charLimit: LARK_CHAR_LIMIT,
          messenger: createLarkMessenger(lark, chatId),
        };
      }
      case 'discord':
      default: {
        const discord = new DiscordRestApi(credentials.botToken);
        const channelId = extractDiscordChannelId(platformThreadId);
        return {
          botToken: credentials.botToken,
          messenger: createDiscordMessenger(discord, channelId, platformThreadId),
        };
      }
    }
  }

  private async handleStep(
    body: BotCallbackBody,
    messenger: PlatformMessenger,
    progressMessageId: string,
    platform: string,
  ): Promise<void> {
    if (!body.shouldContinue) return;

    const progressText = renderStepProgress({
      content: body.content,
      elapsedMs: body.elapsedMs,
      executionTimeMs: body.executionTimeMs ?? 0,
      lastContent: body.lastLLMContent,
      lastToolsCalling: body.lastToolsCalling,
      platform,
      reasoning: body.reasoning,
      stepType: body.stepType ?? ('call_llm' as const),
      thinking: body.thinking ?? false,
      toolsCalling: body.toolsCalling,
      toolsResult: body.toolsResult,
      totalCost: body.totalCost ?? 0,
      totalInputTokens: body.totalInputTokens ?? 0,
      totalOutputTokens: body.totalOutputTokens ?? 0,
      totalSteps: body.totalSteps ?? 0,
      totalTokens: body.totalTokens ?? 0,
      totalToolCalls: body.totalToolCalls,
    });

    const isLlmFinalResponse =
      body.stepType === 'call_llm' && !body.toolsCalling?.length && body.content;

    try {
      await messenger.editMessage(progressMessageId, progressText);
      if (!isLlmFinalResponse) {
        await messenger.triggerTyping();
      }
    } catch (error) {
      log('handleStep: failed to edit progress message: %O', error);
    }
  }

  private async handleCompletion(
    body: BotCallbackBody,
    messenger: PlatformMessenger,
    progressMessageId: string,
    platform: string,
    charLimit?: number,
  ): Promise<void> {
    const { reason, lastAssistantContent, errorMessage } = body;

    if (reason === 'error') {
      const errorText = renderError(errorMessage || 'Agent execution failed');
      try {
        await messenger.editMessage(progressMessageId, errorText);
      } catch (error) {
        log('handleCompletion: failed to edit error message: %O', error);
      }
      return;
    }

    if (!lastAssistantContent) {
      log('handleCompletion: no lastAssistantContent, skipping');
      return;
    }

    const finalText = renderFinalReply(lastAssistantContent, {
      elapsedMs: body.duration,
      llmCalls: body.llmCalls ?? 0,
      platform,
      toolCalls: body.toolCalls ?? 0,
      totalCost: body.cost ?? 0,
      totalTokens: body.totalTokens ?? 0,
    });

    const chunks = splitMessage(finalText, charLimit);

    try {
      await messenger.editMessage(progressMessageId, chunks[0]);
      for (let i = 1; i < chunks.length; i++) {
        await messenger.createMessage(chunks[i]);
      }
    } catch (error) {
      log('handleCompletion: failed to edit/post final message: %O', error);
    }
  }

  private async removeEyesReaction(
    body: BotCallbackBody,
    messenger: PlatformMessenger,
    botToken: string,
    platform: string,
    platformThreadId: string,
  ): Promise<void> {
    const { userMessageId, reactionChannelId } = body;
    if (!userMessageId) return;

    try {
      if (platform === 'discord') {
        // Use reactionChannelId (parent channel for mentions, thread for follow-ups)
        const discord = new DiscordRestApi(botToken);
        const targetChannelId = reactionChannelId || extractDiscordChannelId(platformThreadId);
        await discord.removeOwnReaction(targetChannelId, userMessageId, '👀');
      } else {
        await messenger.removeReaction(userMessageId, '👀');
      }
    } catch (error) {
      log('removeEyesReaction: failed: %O', error);
    }
  }

  private summarizeTopicTitle(body: BotCallbackBody, messenger: PlatformMessenger): void {
    const { reason, topicId, userId, userPrompt, lastAssistantContent } = body;
    if (reason === 'error' || !topicId || !userId || !userPrompt || !lastAssistantContent) return;

    const topicModel = new TopicModel(this.db, userId);
    topicModel
      .findById(topicId)
      .then(async (topic) => {
        if (topic?.title) return;

        const systemAgent = new SystemAgentService(this.db, userId);
        const title = await systemAgent.generateTopicTitle({
          lastAssistantContent,
          userPrompt,
        });
        if (!title) return;

        await topicModel.update(topicId, { title });

        if (messenger.updateThreadName) {
          messenger.updateThreadName(title).catch((error) => {
            log('summarizeTopicTitle: failed to update thread name: %O', error);
          });
        }
      })
      .catch((error) => {
        log('summarizeTopicTitle: failed: %O', error);
      });
  }
}
