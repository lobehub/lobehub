import debug from 'debug';

import {
  BOT_RUNTIME_STATUSES,
  getRuntimeStatusErrorMessage,
  updateBotRuntimeStatus,
} from '@/server/services/gateway/runtimeStatus';

import { stripMarkdown } from '../stripMarkdown';
import type {
  BotPlatformRuntimeContext,
  BotProviderConfig,
  PlatformClient,
  PlatformMessenger,
  UsageStats,
  ValidationResult,
} from '../types';
import { ClientFactory } from '../types';
import { formatUsageStats } from '../utils';
import { createDingTalkAdapter } from './adapter';
import { DingTalkApi } from './api';
import { decodeDingTalkThreadId, decodeDingTalkWebhookThreadId } from './helpers';

export const DINGTALK_NOT_IMPLEMENTED_MESSAGE = 'DingTalk webhook runtime is not implemented yet';

const DINGTALK_DEFAULT_MARKDOWN_TITLE = 'LobeHub';
const DINGTALK_MAX_CHAR_LIMIT = 40_000;
const DINGTALK_MIN_CHAR_LIMIT = 100;

const log = debug('bot-platform:dingtalk:bot');

const parseDingTalkThreadId = (
  platformThreadId: string,
): ReturnType<typeof decodeDingTalkThreadId> => {
  const parts = platformThreadId.split(':');
  if (parts.length < 3 || parts[0] !== 'dingtalk') {
    throw new Error(`Invalid DingTalk threadId: ${platformThreadId}`);
  }

  if (parts[1] !== 'dm' && parts[1] !== 'group') {
    throw new Error(`Invalid DingTalk threadId: ${platformThreadId}`);
  }

  return decodeDingTalkThreadId(platformThreadId);
};

class DingTalkClient implements PlatformClient {
  readonly id = 'dingtalk';
  readonly applicationId: string;

  private readonly config: BotProviderConfig;
  private readonly api: DingTalkApi;

  constructor(config: BotProviderConfig, _context: BotPlatformRuntimeContext) {
    this.config = config;
    this.applicationId = config.applicationId;
    this.api = new DingTalkApi({
      appKey: config.applicationId,
      appSecret: config.credentials.clientSecret,
    });
  }

  private get messageType(): 'markdown' | 'text' {
    return this.config.settings?.messageType === 'text' ? 'text' : 'markdown';
  }

  private get showUsageStats(): boolean {
    return Boolean(this.config.settings?.showUsageStats);
  }

  private get charLimit(): number | undefined {
    const limit = Number(this.config.settings?.charLimit);
    if (!Number.isFinite(limit)) return undefined;

    return Math.min(Math.max(Math.trunc(limit), DINGTALK_MIN_CHAR_LIMIT), DINGTALK_MAX_CHAR_LIMIT);
  }

  private formatOutboundContent(content: string): string {
    const formatted = this.formatMarkdown(content);
    return this.charLimit ? formatted.slice(0, this.charLimit) : formatted;
  }

  // --- Lifecycle ---

  async start(): Promise<void> {
    log('Starting DingTalkBot appId=%s', this.applicationId);
    await updateBotRuntimeStatus({
      applicationId: this.applicationId,
      platform: this.id,
      status: BOT_RUNTIME_STATUSES.starting,
    });

    try {
      await this.api.getAccessToken();

      await updateBotRuntimeStatus({
        applicationId: this.applicationId,
        platform: this.id,
        status: BOT_RUNTIME_STATUSES.connected,
      });

      log('DingTalkBot appId=%s credentials verified', this.applicationId);
    } catch (error) {
      await updateBotRuntimeStatus({
        applicationId: this.applicationId,
        platform: this.id,
        status: BOT_RUNTIME_STATUSES.failed,
        errorMessage: getRuntimeStatusErrorMessage(error),
      });
      throw error;
    }
  }

  async stop(): Promise<void> {
    log('Stopping DingTalkBot appId=%s', this.applicationId);
    await updateBotRuntimeStatus({
      applicationId: this.applicationId,
      platform: this.id,
      status: BOT_RUNTIME_STATUSES.disconnected,
    });
  }

  // --- Runtime Operations ---

  createAdapter(): Record<string, any> {
    return {
      dingtalk: createDingTalkAdapter({
        applicationId: this.applicationId,
        aesKey: this.config.credentials.aesKey,
        clientSecret: this.config.credentials.clientSecret,
        messageType: this.messageType,
        verificationToken: this.config.credentials.verificationToken,
      }),
    };
  }

  getMessenger(platformThreadId: string): PlatformMessenger {
    const sessionWebhook = decodeDingTalkWebhookThreadId(platformThreadId);

    if (sessionWebhook) {
      const sendViaWebhook = async (content: string): Promise<void> => {
        const formattedContent = this.formatOutboundContent(content);
        await this.api.sendSessionWebhookMessage(sessionWebhook, {
          content: formattedContent,
          messageType: this.messageType,
          title: DINGTALK_DEFAULT_MARKDOWN_TITLE,
        });
      };

      return {
        createMessage: sendViaWebhook,
        editMessage: (_messageId, content) => sendViaWebhook(content),
        removeReaction: () => Promise.resolve(),
        triggerTyping: () => Promise.resolve(),
      };
    }

    const thread = parseDingTalkThreadId(platformThreadId);

    const send = async (content: string): Promise<void> => {
      const formattedContent = this.formatOutboundContent(content);
      const basePayload = {
        content: formattedContent,
        messageType: this.messageType,
        title: DINGTALK_DEFAULT_MARKDOWN_TITLE,
      } as const;

      if (thread.type === 'group') {
        await this.api.sendTextMessage({
          ...basePayload,
          openConversationId: thread.id,
        });
        return;
      }

      await this.api.sendTextMessage({
        ...basePayload,
        userIds: [thread.id],
      });
    };

    return {
      createMessage: send,
      editMessage: (_messageId, content) => send(content),
      removeReaction: () => Promise.resolve(),
      triggerTyping: () => Promise.resolve(),
    };
  }

  extractChatId(platformThreadId: string): string {
    return parseDingTalkThreadId(platformThreadId).id;
  }

  formatMarkdown(markdown: string): string {
    return this.messageType === 'text' ? stripMarkdown(markdown) : markdown;
  }

  formatReply(body: string, stats?: UsageStats): string {
    if (!stats || !this.showUsageStats) return body;
    return `${body}\n\n${formatUsageStats(stats)}`;
  }

  parseMessageId(compositeId: string): string {
    return compositeId;
  }
}

export class DingTalkClientFactory extends ClientFactory {
  createClient(config: BotProviderConfig, context: BotPlatformRuntimeContext): PlatformClient {
    return new DingTalkClient(config, context);
  }

  async validateCredentials(
    credentials: Record<string, string>,
    _settings?: Record<string, unknown>,
    applicationId?: string,
  ): Promise<ValidationResult> {
    const errors: Array<{ field: string; message: string }> = [];

    if (!applicationId) {
      errors.push({ field: 'applicationId', message: 'AppKey is required' });
    }
    if (!credentials.clientSecret) {
      errors.push({ field: 'clientSecret', message: 'Client Secret is required' });
    }
    if (!credentials.verificationToken) {
      errors.push({ field: 'verificationToken', message: 'Verification Token is required' });
    }
    if (!credentials.aesKey) {
      errors.push({ field: 'aesKey', message: 'AES Key is required' });
    }

    if (errors.length) {
      return { errors, valid: false };
    }

    try {
      const api = new DingTalkApi({
        appKey: applicationId!,
        appSecret: credentials.clientSecret!,
      });
      await api.getAccessToken();

      return { valid: true };
    } catch {
      return {
        valid: false,
        errors: [{ field: 'credentials', message: 'Failed to authenticate with DingTalk API' }],
      };
    }
  }
}
