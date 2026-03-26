import { createQQAdapter, QQApiClient } from '@lobechat/chat-adapter-qq';
import debug from 'debug';

import {
  BOT_RUNTIME_STATUSES,
  getRuntimeStatusErrorMessage,
  updateBotRuntimeStatus,
} from '@/server/services/gateway/runtimeStatus';

import { stripMarkdown } from '../stripMarkdown';
import {
  type BotPlatformRuntimeContext,
  type BotProviderConfig,
  ClientFactory,
  type PlatformClient,
  type PlatformMessenger,
  type UsageStats,
  type ValidationResult,
} from '../types';
import { formatUsageStats } from '../utils';

const log = debug('bot-platform:qq:bot');

function extractChatId(platformThreadId: string): string {
  return platformThreadId.split(':')[2];
}

function extractThreadType(platformThreadId: string): string {
  return platformThreadId.split(':')[1] || 'group';
}

async function sendQQMessage(
  api: QQApiClient,
  threadType: string,
  targetId: string,
  content: string,
): Promise<void> {
  switch (threadType) {
    case 'group': {
      await api.sendGroupMessage(targetId, content);
      return;
    }
    case 'guild': {
      await api.sendGuildMessage(targetId, content);
      return;
    }
    case 'c2c': {
      await api.sendC2CMessage(targetId, content);
      return;
    }
    case 'dms': {
      await api.sendDmsMessage(targetId, content);
      return;
    }
    default: {
      await api.sendGroupMessage(targetId, content);
    }
  }
}

class QQWebhookClient implements PlatformClient {
  readonly id = 'qq';
  readonly applicationId: string;

  private config: BotProviderConfig;

  constructor(config: BotProviderConfig, _context: BotPlatformRuntimeContext) {
    this.config = config;
    this.applicationId = config.applicationId;
  }

  // --- Lifecycle ---

  async start(): Promise<void> {
    log('Starting QQBot appId=%s', this.applicationId);
    await updateBotRuntimeStatus({
      applicationId: this.applicationId,
      platform: this.id,
      status: BOT_RUNTIME_STATUSES.starting,
    });

    try {
      // Verify credentials by fetching an access token
      const api = new QQApiClient(this.config.applicationId, this.config.credentials.appSecret);
      await api.getAccessToken();

      await updateBotRuntimeStatus({
        applicationId: this.applicationId,
        platform: this.id,
        status: BOT_RUNTIME_STATUSES.connected,
      });

      log('QQBot appId=%s credentials verified', this.applicationId);
    } catch (error) {
      await updateBotRuntimeStatus({
        applicationId: this.applicationId,
        errorMessage: getRuntimeStatusErrorMessage(error),
        platform: this.id,
        status: BOT_RUNTIME_STATUSES.failed,
      });
      throw error;
    }
  }

  async stop(): Promise<void> {
    log('Stopping QQBot appId=%s', this.applicationId);
    // No cleanup needed — webhook is configured in QQ Open Platform
    await updateBotRuntimeStatus({
      applicationId: this.applicationId,
      platform: this.id,
      status: BOT_RUNTIME_STATUSES.disconnected,
    });
  }

  // --- Runtime Operations ---

  createAdapter(): Record<string, any> {
    return {
      qq: createQQAdapter({
        appId: this.config.applicationId,
        clientSecret: this.config.credentials.appSecret,
      }),
    };
  }

  getMessenger(platformThreadId: string): PlatformMessenger {
    const api = new QQApiClient(this.config.applicationId, this.config.credentials.appSecret);
    const targetId = extractChatId(platformThreadId);
    const threadType = extractThreadType(platformThreadId);
    return {
      createMessage: (content) => sendQQMessage(api, threadType, targetId, content),
      editMessage: (_messageId, content) =>
        // QQ does not support editing — send a new message as fallback
        sendQQMessage(api, threadType, targetId, content),
      // QQ Bot API doesn't support reactions or typing
      removeReaction: () => Promise.resolve(),
      triggerTyping: () => Promise.resolve(),
    };
  }

  extractChatId(platformThreadId: string): string {
    return extractChatId(platformThreadId);
  }

  formatMarkdown(markdown: string): string {
    return stripMarkdown(markdown);
  }

  formatReply(body: string, stats?: UsageStats): string {
    if (!stats || !this.config.settings?.showUsageStats) return body;
    return `${body}\n\n${formatUsageStats(stats)}`;
  }

  parseMessageId(compositeId: string): string {
    return compositeId;
  }
}

export class QQClientFactory extends ClientFactory {
  createClient(config: BotProviderConfig, context: BotPlatformRuntimeContext): PlatformClient {
    return new QQWebhookClient(config, context);
  }

  async validateCredentials(
    credentials: Record<string, string>,
    _settings?: Record<string, unknown>,
    applicationId?: string,
  ): Promise<ValidationResult> {
    const errors: Array<{ field: string; message: string }> = [];

    if (!applicationId) errors.push({ field: 'applicationId', message: 'App ID is required' });
    if (!credentials.appSecret)
      errors.push({ field: 'appSecret', message: 'App Secret is required' });

    if (errors.length > 0) return { errors, valid: false };

    try {
      const api = new QQApiClient(applicationId!, credentials.appSecret);
      await api.getAccessToken();
      return { valid: true };
    } catch {
      return {
        errors: [{ field: 'credentials', message: 'Failed to authenticate with QQ API' }],
        valid: false,
      };
    }
  }
}
