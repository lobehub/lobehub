import { createWatiAdapter } from '@lobechat/chat-adapter-wati';
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
  messengerContentText,
  type PlatformClient,
  type PlatformMessenger,
  type UsageStats,
  type ValidationResult,
} from '../types';
import { formatUsageStats } from '../utils';
import { WatiApiClient } from './api';

const log = debug('bot-platform:wati:bot');

function decodeThread(platformThreadId: string): { waId: string } {
  const parts = platformThreadId.split(':');
  if (parts.length >= 3 && parts[0] === 'wati' && parts[1] === 'user') {
    return { waId: parts.slice(2).join(':') };
  }
  return { waId: platformThreadId };
}

class WatiWebhookClient implements PlatformClient {
  readonly id = 'wati';
  readonly applicationId: string;

  private config: BotProviderConfig;
  private context: BotPlatformRuntimeContext;
  private api: WatiApiClient;

  constructor(config: BotProviderConfig, context: BotPlatformRuntimeContext) {
    this.config = config;
    this.context = context;
    this.applicationId = config.applicationId.replaceAll(/\D/g, '');
    this.api = new WatiApiClient({
      apiBaseUrl: config.credentials.apiBaseUrl,
      bearerToken: config.credentials.bearerToken,
      tenantId: config.credentials.tenantId,
    });
  }

  private buildWebhookUrl(): string {
    const baseUrl = (this.config.credentials.webhookProxyUrl || this.context.appUrl || '')
      .trim()
      .replace(/\/$/, '');
    return `${baseUrl}/api/agent/webhooks/wati/${this.applicationId}`;
  }

  async start(): Promise<void> {
    log('Starting WatiBot appId=%s', this.applicationId);
    await updateBotRuntimeStatus({
      applicationId: this.applicationId,
      platform: this.id,
      status: BOT_RUNTIME_STATUSES.starting,
    });

    try {
      const webhookUrl = this.buildWebhookUrl();
      await this.api.ping();
      await this.api.upsertWebhookEndpoints([
        {
          eventTypes: ['message'],
          phoneNumber: this.applicationId,
          status: 1,
          url: webhookUrl,
        },
      ]);

      await updateBotRuntimeStatus({
        applicationId: this.applicationId,
        platform: this.id,
        status: BOT_RUNTIME_STATUSES.connected,
      });
      log('WatiBot appId=%s started, webhook=%s', this.applicationId, webhookUrl);
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
    log('Stopping WatiBot appId=%s', this.applicationId);
    await updateBotRuntimeStatus({
      applicationId: this.applicationId,
      platform: this.id,
      status: BOT_RUNTIME_STATUSES.disconnected,
    });
  }

  createAdapter(): Record<string, any> {
    return {
      wati: createWatiAdapter({
        apiBaseUrl: this.config.credentials.apiBaseUrl,
        bearerToken: this.config.credentials.bearerToken,
        channelPhoneNumber: this.applicationId,
        tenantId: this.config.credentials.tenantId,
        webhookSecret: this.config.credentials.webhookSecret,
      }),
    };
  }

  getMessenger(platformThreadId: string): PlatformMessenger {
    const { waId } = decodeThread(platformThreadId);
    return {
      createMessage: async (content) => {
        const text = messengerContentText(content);
        if (!text.trim()) return;
        await this.api.sendSessionMessage(waId, text, {
          channelPhoneNumber: this.applicationId,
        });
      },
      editMessage: async (_messageId, content) => {
        const text = messengerContentText(content);
        if (!text.trim()) return;
        await this.api.sendSessionMessage(waId, text, {
          channelPhoneNumber: this.applicationId,
        });
      },
      removeReaction: () => Promise.resolve(),
    };
  }

  extractChatId(platformThreadId: string): string {
    return decodeThread(platformThreadId).waId;
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

export class WatiClientFactory extends ClientFactory {
  createClient(config: BotProviderConfig, context: BotPlatformRuntimeContext): PlatformClient {
    return new WatiWebhookClient(config, context);
  }

  async validateCredentials(
    credentials: Record<string, string>,
    _settings?: Record<string, unknown>,
    applicationId?: string,
  ): Promise<ValidationResult> {
    const errors: Array<{ field: string; message: string }> = [];
    if (!credentials.apiBaseUrl?.trim()) {
      errors.push({ field: 'apiBaseUrl', message: 'Wati API base URL is required' });
    }
    if (!credentials.tenantId?.trim()) {
      errors.push({ field: 'tenantId', message: 'Wati tenant ID is required' });
    }
    if (!credentials.bearerToken?.trim()) {
      errors.push({ field: 'bearerToken', message: 'Wati Bearer token is required' });
    }
    if (!applicationId?.replaceAll(/\D/g, '')) {
      errors.push({ field: 'applicationId', message: 'Channel phone number is required' });
    }
    if (errors.length > 0) {
      return { errors, valid: false };
    }

    try {
      const api = new WatiApiClient({
        apiBaseUrl: credentials.apiBaseUrl,
        bearerToken: credentials.bearerToken,
        tenantId: credentials.tenantId,
      });
      await api.ping();
      return { valid: true };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to authenticate with Wati API';
      return {
        errors: [{ field: 'bearerToken', message }],
        valid: false,
      };
    }
  }
}
