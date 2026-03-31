import { createTelegramAdapter } from '@chat-adapter/telegram';
import debug from 'debug';

import {
  BOT_RUNTIME_STATUSES,
  getRuntimeStatusErrorMessage,
  updateBotRuntimeStatus,
} from '@/server/services/gateway/runtimeStatus';

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
import { TELEGRAM_API_BASE, TelegramApi } from './api';
import { extractBotId, setTelegramWebhook } from './helpers';
import { markdownToTelegramHTML } from './markdownToHTML';

const log = debug('bot-platform:telegram:bot');

function extractChatId(platformThreadId: string): string {
  return platformThreadId.split(':')[1];
}

function parseTelegramMessageId(compositeId: string): number {
  const colonIdx = compositeId.lastIndexOf(':');
  return colonIdx !== -1 ? Number(compositeId.slice(colonIdx + 1)) : Number(compositeId);
}

class TelegramWebhookClient implements PlatformClient {
  readonly id = 'telegram';
  readonly applicationId: string;

  private config: BotProviderConfig;
  private context: BotPlatformRuntimeContext;

  constructor(config: BotProviderConfig, context: BotPlatformRuntimeContext) {
    this.config = config;
    this.context = context;
    this.applicationId = extractBotId(config.credentials.botToken);
  }

  // --- Lifecycle ---

  async start(): Promise<void> {
    log('Starting TelegramBot appId=%s', this.applicationId);
    await updateBotRuntimeStatus({
      applicationId: this.applicationId,
      platform: this.id,
      status: BOT_RUNTIME_STATUSES.starting,
    });

    try {
      const baseUrl = (this.config.credentials.webhookProxyUrl || this.context.appUrl || '')
        .trim()
        .replace(/\/$/, '');
      const webhookUrl = `${baseUrl}/api/agent/webhooks/telegram/${this.applicationId}`;
      await setTelegramWebhook(
        this.config.credentials.botToken,
        webhookUrl,
        this.config.credentials.secretToken || undefined,
      );

      await updateBotRuntimeStatus({
        applicationId: this.applicationId,
        platform: this.id,
        status: BOT_RUNTIME_STATUSES.connected,
      });

      log('TelegramBot appId=%s started, webhook=%s', this.applicationId, webhookUrl);
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
    log('Stopping TelegramBot appId=%s', this.applicationId);
    try {
      const response = await fetch(
        `${TELEGRAM_API_BASE}/bot${this.config.credentials.botToken}/deleteWebhook`,
        { method: 'POST' },
      );
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Failed to delete Telegram webhook: ${response.status} ${text}`);
      }
      log('TelegramBot appId=%s webhook deleted', this.applicationId);
    } catch (error) {
      log('Failed to delete webhook for appId=%s: %O', this.applicationId, error);
    } finally {
      await updateBotRuntimeStatus({
        applicationId: this.applicationId,
        platform: this.id,
        status: BOT_RUNTIME_STATUSES.disconnected,
      });
    }
  }

  // --- Runtime Operations ---

  createAdapter(): Record<string, any> {
    return {
      telegram: createTelegramAdapter({
        botToken: this.config.credentials.botToken,
        secretToken: this.config.credentials.secretToken || undefined,
      }),
    };
  }

  getMessenger(platformThreadId: string): PlatformMessenger {
    const telegram = new TelegramApi(this.config.credentials.botToken);
    const chatId = extractChatId(platformThreadId);
    return {
      createMessage: (content) => telegram.sendMessage(chatId, content).then(() => {}),
      editMessage: (messageId, content) =>
        telegram.editMessageText(chatId, parseTelegramMessageId(messageId), content),
      removeReaction: (messageId) =>
        telegram.removeMessageReaction(chatId, parseTelegramMessageId(messageId)),
      triggerTyping: () => telegram.sendChatAction(chatId, 'typing'),
    };
  }

  extractChatId(platformThreadId: string): string {
    return extractChatId(platformThreadId);
  }

  async registerBotCommands(
    commands: Array<{ command: string; description: string }>,
  ): Promise<void> {
    const telegram = new TelegramApi(this.config.credentials.botToken);
    await telegram.setMyCommands(commands);
    log('TelegramBot appId=%s registered %d commands', this.applicationId, commands.length);
  }

  formatMarkdown(markdown: string): string {
    return markdownToTelegramHTML(markdown);
  }

  formatReply(body: string, stats?: UsageStats): string {
    if (!stats || !this.config.settings?.showUsageStats) return body;
    return `${body}\n\n${formatUsageStats(stats)}`;
  }

  parseMessageId(compositeId: string): number {
    return parseTelegramMessageId(compositeId);
  }
}

export class TelegramClientFactory extends ClientFactory {
  createClient(config: BotProviderConfig, context: BotPlatformRuntimeContext): PlatformClient {
    return new TelegramWebhookClient(config, context);
  }

  async validateCredentials(credentials: Record<string, string>): Promise<ValidationResult> {
    if (!credentials.botToken) {
      return { errors: [{ field: 'botToken', message: 'Bot Token is required' }], valid: false };
    }

    try {
      const res = await fetch(`${TELEGRAM_API_BASE}/bot${credentials.botToken}/getMe`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { valid: true };
    } catch {
      return {
        errors: [{ field: 'botToken', message: 'Failed to authenticate with Telegram API' }],
        valid: false,
      };
    }
  }
}
