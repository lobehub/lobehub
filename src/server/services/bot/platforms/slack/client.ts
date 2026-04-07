import { createSlackAdapter } from '@chat-adapter/slack';
import type { Chat as ChatBot } from 'chat';
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
import { SLACK_API_BASE, SlackApi } from './api';
import { SlackSocketModeConnection } from './gateway';
import { markdownToSlackMrkdwn } from './markdownToMrkdwn';

const log = debug('bot-platform:slack:bot');

const CONNECTED_STATUS_TTL_BUFFER_MS = 60 * 1000;
const DEFAULT_DURATION_MS = 8 * 60 * 60 * 1000; // 8 hours

export interface GatewayListenerOptions {
  durationMs?: number;
  waitUntil?: (task: Promise<any>) => void;
}

function extractChannelId(platformThreadId: string): string {
  return platformThreadId.split(':')[1];
}

function extractThreadTs(platformThreadId: string): string | undefined {
  return platformThreadId.split(':')[2];
}

// ---------- Shared runtime operations mixin ----------

function createMessenger(config: BotProviderConfig, platformThreadId: string): PlatformMessenger {
  const slack = new SlackApi(config.credentials.botToken);
  const channelId = extractChannelId(platformThreadId);
  const threadTs = extractThreadTs(platformThreadId);

  return {
    createMessage: (content) =>
      threadTs
        ? slack.postMessageInThread(channelId, threadTs, content).then(() => {})
        : slack.postMessage(channelId, content).then(() => {}),
    editMessage: (messageId, content) => slack.updateMessage(channelId, messageId, content),
    removeReaction: (messageId, emoji) => slack.removeReaction(channelId, messageId, emoji),
    triggerTyping: () => Promise.resolve(),
  };
}

// ---------- Webhook Client (existing behavior) ----------

class SlackWebhookClient implements PlatformClient {
  readonly id = 'slack';
  readonly applicationId: string;

  private config: BotProviderConfig;

  constructor(config: BotProviderConfig, _context: BotPlatformRuntimeContext) {
    this.config = config;
    this.applicationId = config.applicationId;
  }

  async start(): Promise<void> {
    log('Starting SlackBot (webhook) appId=%s', this.applicationId);
    await updateBotRuntimeStatus({
      applicationId: this.applicationId,
      platform: this.id,
      status: BOT_RUNTIME_STATUSES.starting,
    });

    try {
      await updateBotRuntimeStatus({
        applicationId: this.applicationId,
        platform: this.id,
        status: BOT_RUNTIME_STATUSES.connected,
      });
      log('SlackBot (webhook) appId=%s started', this.applicationId);
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
    log('Stopping SlackBot (webhook) appId=%s', this.applicationId);
    await updateBotRuntimeStatus({
      applicationId: this.applicationId,
      platform: this.id,
      status: BOT_RUNTIME_STATUSES.disconnected,
    });
  }

  createAdapter(): Record<string, any> {
    return {
      slack: createSlackAdapter({
        botToken: this.config.credentials.botToken,
        signingSecret: this.config.credentials.signingSecret,
      }),
    };
  }

  getMessenger(platformThreadId: string): PlatformMessenger {
    return createMessenger(this.config, platformThreadId);
  }

  extractChatId(platformThreadId: string): string {
    return extractChannelId(platformThreadId);
  }

  formatMarkdown(markdown: string): string {
    return markdownToSlackMrkdwn(markdown);
  }

  formatReply(body: string, stats?: UsageStats): string {
    if (!stats || !this.config.settings?.showUsageStats) return body;
    return `${body}\n\n${formatUsageStats(stats)}`;
  }

  parseMessageId(compositeId: string): string {
    return compositeId;
  }

  sanitizeUserInput(text: string): string {
    return text.replaceAll(/<@[A-Z\d]+>\s*/g, '').trim();
  }
}

// ---------- Socket Mode Client (persistent) ----------

class SlackSocketModeClient implements PlatformClient {
  readonly id = 'slack';
  readonly applicationId: string;

  private abort = new AbortController();
  private bot: ChatBot<any> | null = null;
  private config: BotProviderConfig;
  private context: BotPlatformRuntimeContext;
  private gateway: SlackSocketModeConnection | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(config: BotProviderConfig, context: BotPlatformRuntimeContext) {
    this.config = config;
    this.context = context;
    this.applicationId = config.applicationId;
  }

  async start(options?: GatewayListenerOptions): Promise<void> {
    log('Starting SlackBot (socket mode) appId=%s', this.applicationId);

    this.stopped = false;
    this.abort = new AbortController();
    const durationMs = options?.durationMs ?? DEFAULT_DURATION_MS;
    const runtimeStatusTtlMs = durationMs + CONNECTED_STATUS_TTL_BUFFER_MS;
    await updateBotRuntimeStatus(
      {
        applicationId: this.applicationId,
        platform: this.id,
        status: BOT_RUNTIME_STATUSES.starting,
      },
      { redisClient: this.context.redisClient as any, ttlMs: runtimeStatusTtlMs },
    );

    try {
      if (this.bot) {
        await this.bot.shutdown().catch(() => {});
        this.bot = null;
      }

      const adapter = createSlackAdapter({
        botToken: this.config.credentials.botToken,
        signingSecret: this.config.credentials.signingSecret,
      });

      const { Chat, ConsoleLogger } = await import('chat');

      const chatConfig: any = {
        adapters: { slack: adapter },
        userName: `lobehub-gateway-${this.applicationId}`,
      };

      if (this.context.redisClient) {
        const { createIoRedisState } = await import('@chat-adapter/state-ioredis');
        chatConfig.state = createIoRedisState({
          client: this.context.redisClient as any,
          logger: new ConsoleLogger(),
        });
      }

      const bot = new Chat(chatConfig);
      this.bot = bot;
      await bot.initialize();

      const webhookUrl = `${(this.context.appUrl || '').trim()}/api/agent/webhooks/slack/${this.applicationId}`;

      this.gateway = new SlackSocketModeConnection({
        abortSignal: this.abort.signal,
        appToken: this.config.credentials.appToken,
        durationMs,
        signingSecret: this.config.credentials.signingSecret,
        webhookUrl,
      });

      const waitUntil = options?.waitUntil ?? ((task: Promise<any>) => task.catch(() => {}));
      const gatewayTask = this.gateway.connect();
      waitUntil(gatewayTask);
      await gatewayTask;

      if (!options) {
        this.refreshTimer = setTimeout(() => {
          if (this.abort.signal.aborted || this.stopped) return;

          log(
            'SlackBot appId=%s duration elapsed (%dh), refreshing...',
            this.applicationId,
            durationMs / 3_600_000,
          );
          this.abort.abort();
          this.start().catch((err) => {
            log('Failed to refresh SlackBot appId=%s: %O', this.applicationId, err);
          });
        }, durationMs);
      }

      await updateBotRuntimeStatus(
        {
          applicationId: this.applicationId,
          platform: this.id,
          status: BOT_RUNTIME_STATUSES.connected,
        },
        { redisClient: this.context.redisClient as any, ttlMs: runtimeStatusTtlMs },
      );

      log('SlackBot (socket mode) appId=%s started, webhookUrl=%s', this.applicationId, webhookUrl);
    } catch (error) {
      await updateBotRuntimeStatus(
        {
          applicationId: this.applicationId,
          errorMessage: getRuntimeStatusErrorMessage(error),
          platform: this.id,
          status: BOT_RUNTIME_STATUSES.failed,
        },
        { redisClient: this.context.redisClient as any, ttlMs: runtimeStatusTtlMs },
      );
      throw error;
    }
  }

  async stop(): Promise<void> {
    log('Stopping SlackBot (socket mode) appId=%s', this.applicationId);
    this.stopped = true;
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.abort.abort();
    this.gateway?.close();
    this.gateway = null;
    if (this.bot) {
      await this.bot.shutdown().catch(() => {});
      this.bot = null;
    }
    await updateBotRuntimeStatus(
      {
        applicationId: this.applicationId,
        platform: this.id,
        status: BOT_RUNTIME_STATUSES.disconnected,
      },
      { redisClient: this.context.redisClient as any },
    );
  }

  createAdapter(): Record<string, any> {
    return {
      slack: createSlackAdapter({
        botToken: this.config.credentials.botToken,
        signingSecret: this.config.credentials.signingSecret,
      }),
    };
  }

  getMessenger(platformThreadId: string): PlatformMessenger {
    return createMessenger(this.config, platformThreadId);
  }

  extractChatId(platformThreadId: string): string {
    return extractChannelId(platformThreadId);
  }

  formatMarkdown(markdown: string): string {
    return markdownToSlackMrkdwn(markdown);
  }

  formatReply(body: string, stats?: UsageStats): string {
    if (!stats || !this.config.settings?.showUsageStats) return body;
    return `${body}\n\n${formatUsageStats(stats)}`;
  }

  parseMessageId(compositeId: string): string {
    return compositeId;
  }

  sanitizeUserInput(text: string): string {
    return text.replaceAll(/<@[A-Z\d]+>\s*/g, '').trim();
  }
}

// ---------- Factory ----------

export class SlackClientFactory extends ClientFactory {
  createClient(config: BotProviderConfig, context: BotPlatformRuntimeContext): PlatformClient {
    // Fall back to 'webhook' to preserve behavior for legacy provider rows
    // that pre-date the connectionMode field. New providers always go through
    // the form which seeds connectionMode from the schema default.
    const mode = (config.settings?.connectionMode as string) || 'webhook';
    if (mode === 'websocket' && config.credentials.appToken) {
      return new SlackSocketModeClient(config, context);
    }
    return new SlackWebhookClient(config, context);
  }

  async validateCredentials(credentials: Record<string, string>): Promise<ValidationResult> {
    if (!credentials.botToken) {
      return { errors: [{ field: 'botToken', message: 'Bot Token is required' }], valid: false };
    }
    if (!credentials.signingSecret) {
      return {
        errors: [{ field: 'signingSecret', message: 'Signing Secret is required' }],
        valid: false,
      };
    }

    try {
      const res = await fetch(`${SLACK_API_BASE}/auth.test`, {
        headers: {
          'Authorization': `Bearer ${credentials.botToken}`,
          'Content-Type': 'application/json',
        },
        method: 'POST',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = (await res.json()) as { ok: boolean; error?: string; bot_id?: string };
      if (!data.ok) throw new Error(data.error || 'auth.test failed');

      // Validate app token if provided
      if (credentials.appToken) {
        const appRes = await fetch(`${SLACK_API_BASE}/apps.connections.open`, {
          headers: {
            'Authorization': `Bearer ${credentials.appToken}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          method: 'POST',
        });
        if (!appRes.ok) throw new Error(`HTTP ${appRes.status}`);

        const appData = (await appRes.json()) as { ok: boolean; error?: string };
        if (!appData.ok) {
          return {
            errors: [
              { field: 'appToken', message: `App Token validation failed: ${appData.error}` },
            ],
            valid: false,
          };
        }
      }

      return { valid: true };
    } catch (error: any) {
      return {
        errors: [
          { field: 'botToken', message: error.message || 'Failed to authenticate with Slack API' },
        ],
        valid: false,
      };
    }
  }
}
