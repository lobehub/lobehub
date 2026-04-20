import {
  createLarkAdapter,
  decodeLarkThreadId,
  downloadMediaFromRawMessage,
  LarkApiClient,
  type LarkRawMessage,
} from '@lobechat/chat-adapter-feishu';
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
import { FeishuWSConnection } from './gateway';

const log = debug('bot-platform:feishu:client');

const CONNECTED_STATUS_TTL_BUFFER_MS = 60 * 1000;
const DEFAULT_DURATION_MS = 8 * 60 * 60 * 1000; // 8 hours

export interface GatewayListenerOptions {
  durationMs?: number;
  waitUntil?: (task: Promise<any>) => void;
}

function extractChatId(platformThreadId: string): string {
  // Delegate to the adapter's shared decoder so this stays in sync with the
  // threadId format. New format is `lark:p2p:oc_xxx` / `lark:group:oc_xxx`,
  // legacy is `lark:oc_xxx` — naive `split(':')[1]` would return `'p2p'` /
  // `'group'` for the new format and break outbound API calls.
  return decodeLarkThreadId(platformThreadId).chatId;
}

/** Resolve the Lark/Feishu domain from the platform id. */
function resolveDomain(platform: string): 'lark' | 'feishu' {
  return platform === 'lark' ? 'lark' : 'feishu';
}

// ---------- Shared runtime operations ----------

function createMessenger(
  config: BotProviderConfig,
  domain: 'lark' | 'feishu',
  platformThreadId: string,
): PlatformMessenger {
  const api = new LarkApiClient(config.applicationId, config.credentials.appSecret, domain);
  const chatId = extractChatId(platformThreadId);
  return {
    createMessage: (content) => api.sendMessage(chatId, content).then(() => {}),
    editMessage: (messageId, content) => api.editMessage(messageId, content).then(() => {}),
    removeReaction: () => Promise.resolve(),
  };
}

/**
 * Resolve attachments on an inbound Feishu/Lark message into
 * `AttachmentSource[]`. Shared by both webhook and websocket clients.
 *
 * Why we re-download instead of trusting the in-message buffer or fetchData:
 * the chat-adapter-feishu used to set `fetchData` (sync `parseMessage` path)
 * or `buffer` (async `parseRawEvent` path) on attachments, but
 * `Message.toJSON` strips both whenever the message is enqueued (debounce
 * always; queue when busy). So whenever a message round-trips through the
 * queue, the in-memory data is gone and we have to re-fetch via the Lark
 * resource API ourselves. After the adapter refactor, attachments are now
 * metadata-only at parse time and `extractFiles` is the sole download path.
 *
 * The original `LarkRawMessage` (with `message_id` + `content` JSON
 * carrying `image_key` / `file_key` / etc.) IS preserved in `message.raw`
 * because `toJSON` keeps it intact. We hand that and a `LarkApiClient` to
 * the package-exported `downloadMediaFromRawMessage` helper.
 */
async function feishuExtractFiles(
  api: LarkApiClient,
  message: Message,
): Promise<AttachmentSource[] | undefined> {
  const raw = (message as any).raw as LarkRawMessage | undefined;
  if (!raw) return undefined;

  log('extractFiles: msgId=%s, message_type=%s', (message as any).id, raw.message_type);

  const attachments = await downloadMediaFromRawMessage(api, raw);
  if (attachments.length === 0) {
    log('extractFiles: no media items resolved for msgId=%s', (message as any).id);
    return undefined;
  }

  log(
    'extractFiles: resolved %d media item(s) for msgId=%s',
    attachments.length,
    (message as any).id,
  );

  return attachments.map((att: any) => ({
    buffer: att.buffer,
    mimeType: att.mimeType,
    name: att.name,
    size: att.size,
  }));
}

// ---------- Webhook Client (existing behavior) ----------

class FeishuWebhookClient implements PlatformClient {
  readonly id: string;
  readonly applicationId: string;

  private config: BotProviderConfig;
  private domain: 'lark' | 'feishu';
  /** Lazy-cached LarkApiClient — keeps the tenant token cache hot across calls. */
  private _api?: LarkApiClient;

  constructor(config: BotProviderConfig, _context: BotPlatformRuntimeContext) {
    this.config = config;
    this.id = config.platform;
    this.applicationId = config.applicationId;
    this.domain = resolveDomain(config.platform);
  }

  private get api(): LarkApiClient {
    if (!this._api) {
      this._api = new LarkApiClient(
        this.config.applicationId,
        this.config.credentials.appSecret,
        this.domain,
      );
    }
    return this._api;
  }

  async start(): Promise<void> {
    log('Starting FeishuClient (webhook) appId=%s domain=%s', this.applicationId, this.domain);
    await updateBotRuntimeStatus({
      applicationId: this.applicationId,
      platform: this.id,
      status: BOT_RUNTIME_STATUSES.starting,
    });

    try {
      const api = new LarkApiClient(
        this.config.applicationId,
        this.config.credentials.appSecret,
        this.domain,
      );
      await api.getTenantAccessToken();

      await updateBotRuntimeStatus({
        applicationId: this.applicationId,
        platform: this.id,
        status: BOT_RUNTIME_STATUSES.connected,
      });

      log('FeishuClient (webhook) appId=%s credentials verified', this.applicationId);
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
    log('Stopping FeishuClient (webhook) appId=%s', this.applicationId);
    await updateBotRuntimeStatus({
      applicationId: this.applicationId,
      platform: this.id,
      status: BOT_RUNTIME_STATUSES.disconnected,
    });
  }

  createAdapter(): Record<string, any> {
    return {
      [this.config.platform]: createLarkAdapter({
        appId: this.config.applicationId,
        appSecret: this.config.credentials.appSecret,
        encryptKey: this.config.credentials.encryptKey,
        platform: this.domain,
        verificationToken: this.config.credentials.verificationToken,
      }),
    };
  }

  getMessenger(platformThreadId: string): PlatformMessenger {
    return createMessenger(this.config, this.domain, platformThreadId);
  }

  async extractFiles(message: Message): Promise<AttachmentSource[] | undefined> {
    return feishuExtractFiles(this.api, message);
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

// ---------- WebSocket Client (persistent, using Lark SDK WSClient) ----------

class FeishuWSClientImpl implements PlatformClient {
  readonly id: string;
  readonly applicationId: string;

  private config: BotProviderConfig;
  private context: BotPlatformRuntimeContext;
  private domain: 'lark' | 'feishu';
  private gateway: FeishuWSConnection | null = null;
  private bot: ChatBot<any> | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  /** Lazy-cached LarkApiClient — keeps the tenant token cache hot across calls. */
  private _api?: LarkApiClient;

  constructor(config: BotProviderConfig, context: BotPlatformRuntimeContext) {
    this.config = config;
    this.context = context;
    this.id = config.platform;
    this.applicationId = config.applicationId;
    this.domain = resolveDomain(config.platform);
  }

  private get api(): LarkApiClient {
    if (!this._api) {
      this._api = new LarkApiClient(
        this.config.applicationId,
        this.config.credentials.appSecret,
        this.domain,
      );
    }
    return this._api;
  }

  async start(options?: GatewayListenerOptions): Promise<void> {
    log('Starting FeishuClient (ws) appId=%s domain=%s', this.applicationId, this.domain);

    this.stopped = false;
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

      const adapter = createLarkAdapter({
        appId: this.config.applicationId,
        appSecret: this.config.credentials.appSecret,
        encryptKey: this.config.credentials.encryptKey,
        platform: this.domain,
        verificationToken: this.config.credentials.verificationToken,
      });

      const { Chat, ConsoleLogger } = await import('chat');

      const chatConfig: any = {
        adapters: { [this.config.platform]: adapter },
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

      const webhookUrl = `${(this.context.appUrl || '').trim()}/api/agent/webhooks/${this.config.platform}/${this.applicationId}`;

      this.gateway = new FeishuWSConnection({
        appId: this.config.applicationId,
        appSecret: this.config.credentials.appSecret,
        domain: this.domain,
        verificationToken: this.config.credentials.verificationToken,
        webhookUrl,
      });

      await this.gateway.start();

      if (!options) {
        this.refreshTimer = setTimeout(() => {
          if (this.stopped) return;

          log(
            'FeishuClient appId=%s duration elapsed (%dh), refreshing...',
            this.applicationId,
            durationMs / 3_600_000,
          );
          this.gateway?.close();
          this.start().catch((err) => {
            log('Failed to refresh FeishuClient appId=%s: %O', this.applicationId, err);
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

      log('FeishuClient (ws) appId=%s started', this.applicationId);
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
    log('Stopping FeishuClient (ws) appId=%s', this.applicationId);
    this.stopped = true;
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
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
      [this.config.platform]: createLarkAdapter({
        appId: this.config.applicationId,
        appSecret: this.config.credentials.appSecret,
        encryptKey: this.config.credentials.encryptKey,
        platform: this.domain,
        verificationToken: this.config.credentials.verificationToken,
      }),
    };
  }

  getMessenger(platformThreadId: string): PlatformMessenger {
    return createMessenger(this.config, this.domain, platformThreadId);
  }

  async extractFiles(message: Message): Promise<AttachmentSource[] | undefined> {
    return feishuExtractFiles(this.api, message);
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

// ---------- Factory ----------

export class FeishuClientFactory extends ClientFactory {
  createClient(config: BotProviderConfig, context: BotPlatformRuntimeContext): PlatformClient {
    // Fall back to 'webhook' to preserve behavior for legacy provider rows
    // that pre-date the connectionMode field. New providers always go through
    // the form which seeds connectionMode from the schema default.
    const mode = (config.settings?.connectionMode as string) || 'webhook';
    if (mode === 'websocket') {
      return new FeishuWSClientImpl(config, context);
    }
    return new FeishuWebhookClient(config, context);
  }

  async validateCredentials(
    credentials: Record<string, string>,
    _settings?: Record<string, unknown>,
    applicationId?: string,
    platform?: string,
  ): Promise<ValidationResult> {
    const errors: Array<{ field: string; message: string }> = [];

    if (!applicationId) errors.push({ field: 'applicationId', message: 'App ID is required' });
    if (!credentials.appSecret)
      errors.push({ field: 'appSecret', message: 'App Secret is required' });

    if (errors.length > 0) return { errors, valid: false };

    try {
      const domain = resolveDomain(platform || 'feishu');
      const api = new LarkApiClient(applicationId!, credentials.appSecret, domain);
      await api.getTenantAccessToken();
      return { valid: true };
    } catch {
      return {
        errors: [{ field: 'credentials', message: 'Failed to authenticate with Feishu API' }],
        valid: false,
      };
    }
  }
}
