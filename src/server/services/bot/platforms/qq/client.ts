import type { QQAdapter } from '@lobechat/chat-adapter-qq';
import { createQQAdapter, QQApiClient } from '@lobechat/chat-adapter-qq';
import type { Chat as ChatBot, Message } from 'chat';
import debug from 'debug';

import type { AttachmentSource } from '@/server/services/aiAgent/ingestAttachment';
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

const CONNECTED_STATUS_TTL_BUFFER_MS = 60 * 1000;
const DEFAULT_DURATION_MS = 8 * 60 * 60 * 1000; // 8 hours

export interface GatewayListenerOptions {
  durationMs?: number;
  waitUntil?: (task: Promise<any>) => void;
}

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

/**
 * Resolve attachments on an inbound QQ message into `AttachmentSource[]`.
 *
 * QQ is the simplest case: attachments come with public CDN URLs (`https://multimedia.nt.qq.com.cn/...`)
 * that require no auth and survive `Message.toJSON` unchanged. We just walk
 * the surviving attachment metadata and forward URLs to `ingestAttachment`,
 * which `fetch()`es them with no special handling.
 *
 * No `referenced_message` quirk like Discord, no auth like Slack, no
 * file_id download like Telegram/WeChat/Feishu — just URLs.
 */
function qqExtractFiles(message: Message): AttachmentSource[] | undefined {
  const attachments = (message as any).attachments as
    | Array<{
        height?: number;
        mimeType?: string;
        name?: string;
        size?: number;
        type?: string;
        url?: string;
        width?: number;
      }>
    | undefined;
  if (!attachments?.length) return undefined;

  log('extractFiles: msgId=%s, attachments=%d', (message as any).id, attachments.length);

  const results: AttachmentSource[] = [];
  for (const att of attachments) {
    if (!att.url) continue;
    results.push({
      mimeType: att.mimeType,
      name: att.name,
      size: att.size,
      url: att.url,
    });
  }

  return results.length > 0 ? results : undefined;
}

class QQGatewayClient implements PlatformClient {
  readonly id = 'qq';
  readonly applicationId: string;

  private abort = new AbortController();
  private bot: ChatBot<any> | null = null;
  private config: BotProviderConfig;
  private context: BotPlatformRuntimeContext;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(config: BotProviderConfig, context: BotPlatformRuntimeContext) {
    this.config = config;
    this.context = context;
    this.applicationId = config.applicationId;
  }

  // --- Lifecycle ---

  async start(options?: GatewayListenerOptions): Promise<void> {
    log('Starting QQBot appId=%s', this.applicationId);

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

      const adapter = createQQAdapter({
        appId: this.config.applicationId,
        clientSecret: this.config.credentials.appSecret,
      });

      const { Chat, ConsoleLogger } = await import('chat');

      const chatConfig: any = {
        adapters: { qq: adapter },
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

      const qqAdapter = (bot as any).adapters.get('qq') as QQAdapter;
      const waitUntil = options?.waitUntil ?? ((task: Promise<any>) => task.catch(() => {}));

      const webhookUrl = `${(this.context.appUrl || '').trim()}/api/agent/webhooks/qq/${this.applicationId}`;

      await qqAdapter.startGatewayListener(
        { waitUntil },
        durationMs,
        this.abort.signal,
        webhookUrl,
      );

      if (!options) {
        this.refreshTimer = setTimeout(() => {
          if (this.abort.signal.aborted || this.stopped) return;

          log(
            'QQBot appId=%s duration elapsed (%dh), refreshing...',
            this.applicationId,
            durationMs / 3_600_000,
          );
          this.abort.abort();
          this.start().catch((err) => {
            log('Failed to refresh QQBot appId=%s: %O', this.applicationId, err);
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

      log('QQBot appId=%s started, webhookUrl=%s', this.applicationId, webhookUrl);
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
    log('Stopping QQBot appId=%s', this.applicationId);
    this.stopped = true;
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.abort.abort();
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

  async extractFiles(message: Message): Promise<AttachmentSource[] | undefined> {
    return qqExtractFiles(message);
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
    log('Starting QQBot (webhook) appId=%s', this.applicationId);
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

      log('QQBot (webhook) appId=%s credentials verified', this.applicationId);
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
    log('Stopping QQBot (webhook) appId=%s', this.applicationId);
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
      editMessage: (_messageId, content) => sendQQMessage(api, threadType, targetId, content),
      removeReaction: () => Promise.resolve(),
      triggerTyping: () => Promise.resolve(),
    };
  }

  async extractFiles(message: Message): Promise<AttachmentSource[] | undefined> {
    return qqExtractFiles(message);
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
    // Fall back to 'webhook' to preserve behavior for legacy provider rows
    // that pre-date the connectionMode field (QQ shipped as webhook-only
    // before websocket support was added). New providers always go through
    // the form which seeds connectionMode from the schema default.
    const mode = (config.settings?.connectionMode as string) || 'webhook';
    if (mode === 'webhook') {
      return new QQWebhookClient(config, context);
    }
    return new QQGatewayClient(config, context);
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
