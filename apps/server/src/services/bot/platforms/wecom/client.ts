import type { WeComRawMessage, WeComThreadId } from '@lobechat/chat-adapter-wecom';
import {
  collectWeComMedia,
  createWeComAdapter,
  downloadWeComMedia,
  getWeComConnection,
  registerWeComConnection,
  requireWeComConnection,
  unregisterWeComConnection,
  WeComLongConnection,
} from '@lobechat/chat-adapter-wecom';
import type { Message } from 'chat';
import debug from 'debug';

import { appEnv } from '@/envs/app';
import type { AttachmentSource } from '@/server/services/aiAgent/ingestAttachment';
import {
  BOT_RUNTIME_STATUSES,
  getRuntimeStatusErrorMessage,
  updateBotRuntimeStatus,
} from '@/server/services/gateway/runtimeStatus';

import {
  type BotPlatformRuntimeContext,
  type BotProviderConfig,
  ClientFactory,
  type ExtractFilesResult,
  messengerContentText,
  type PlatformClient,
  type PlatformMessenger,
  type UsageStats,
  type ValidationResult,
} from '../types';
import { formatUsageStats } from '../utils';

const log = debug('bot-platform:wecom:bot');

const CONNECTED_STATUS_TTL_BUFFER_MS = 60 * 1000;
const DEFAULT_DURATION_MS = 8 * 60 * 60 * 1000; // 8 hours
const REFRESH_RETRY_MS = 60 * 1000;

/** Shown as the runtime error when WeCom hands the bot to a newer connection. */
export const WECOM_DISPLACED_MESSAGE =
  'Another connection subscribed with this WeCom BotID and took it over. A WeCom bot can only be connected to one place at a time.';

export interface WeComGatewayListenerOptions {
  durationMs?: number;
  waitUntil?: (task: Promise<any>) => void;
}

/**
 * Base URL the connection forwards inbound frames to — its own server. Server-to-server calls use
 * `INTERNAL_APP_URL` when set (it bypasses the public CDN / proxy, and in Docker the public URL may
 * not resolve from inside the container), else the public `APP_URL`.
 */
export const resolveSelfWebhookBase = (appUrl?: string): string =>
  (appEnv.INTERNAL_APP_URL || appUrl || appEnv.APP_URL || '').trim().replace(/\/+$/, '');

/** `wecom:single:<userid>` / `wecom:group:<chatid>` → `{ type, id }`. */
export const decodeWeComThreadId = (platformThreadId: string): WeComThreadId => {
  const [, type, ...rest] = platformThreadId.split(':');
  return { id: rest.join(':'), type: type === 'group' ? 'group' : 'single' };
};

/**
 * Download inbound media now: WeCom URLs expire five minutes after the message and the files are
 * AES-encrypted, so a URL alone is useless to `ingestAttachment`. Failures become prompt warnings
 * instead of failing the message.
 */
export const wecomExtractFiles = async (
  message: Message,
  fetchImpl: typeof fetch = fetch,
): Promise<ExtractFilesResult | undefined> => {
  const raw = (message as Message<WeComRawMessage>).raw;
  if (!raw?.body) return undefined;

  const refs = collectWeComMedia(raw.body);
  if (refs.length === 0) return undefined;

  const files: AttachmentSource[] = [];
  const warnings: string[] = [];
  for (const ref of refs) {
    try {
      const media = await downloadWeComMedia(ref, fetchImpl);
      files.push({
        buffer: media.buffer,
        mimeType: media.mimeType,
        name: media.name,
        size: media.buffer.length,
      });
    } catch (error) {
      log('extractFiles: %s download failed: %O', ref.kind, error);
      warnings.push(`A ${ref.kind} attached to this WeCom message could not be downloaded.`);
    }
  }
  return {
    files: files.length ? files : undefined,
    warnings: warnings.length ? warnings : undefined,
  };
};

class WeComClient implements PlatformClient {
  readonly id = 'wecom';
  readonly applicationId: string;

  private connection: WeComLongConnection | null = null;
  private generation = 0;
  private pending: WeComLongConnection | null = null;
  private readonly config: BotProviderConfig;
  private readonly context: BotPlatformRuntimeContext;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(config: BotProviderConfig, context: BotPlatformRuntimeContext) {
    this.config = config;
    this.context = context;
    this.applicationId = config.applicationId;
  }

  // --- Lifecycle ---

  async start(options?: WeComGatewayListenerOptions): Promise<void> {
    log('Starting WeCom bot %s', this.applicationId);
    this.stopped = false;
    // A later start() or stop() supersedes this one while its subscribe is still pending.
    const generation = ++this.generation;
    const durationMs = options?.durationMs ?? DEFAULT_DURATION_MS;
    const ttlMs = durationMs + CONNECTED_STATUS_TTL_BUFFER_MS;
    const statusOptions = { redisClient: this.context.redisClient as any, ttlMs };

    await updateBotRuntimeStatus(
      {
        applicationId: this.applicationId,
        platform: this.id,
        status: BOT_RUNTIME_STATUSES.starting,
      },
      statusOptions,
    );

    this.closeConnection();

    const reportFailure = (error: unknown, errorMessage = getRuntimeStatusErrorMessage(error)) =>
      updateBotRuntimeStatus(
        {
          applicationId: this.applicationId,
          errorMessage,
          platform: this.id,
          status: BOT_RUNTIME_STATUSES.failed,
        },
        statusOptions,
      ).catch(() => {});

    const connection = new WeComLongConnection({
      botId: this.applicationId,
      log: (message, ...args) => log(message, ...args),
      // Both end the connection for good: a newer owner holds the bot, or WeCom refuses it. The
      // client stops too, so its periodic refresh cannot take the bot back.
      onDisplaced: () => {
        this.retireConnection(connection);
        void reportFailure(undefined, WECOM_DISPLACED_MESSAGE);
      },
      onFatalError: (error) => {
        this.retireConnection(connection);
        void reportFailure(error);
      },
      secret: this.config.credentials.secret,
      webhookUrl: `${resolveSelfWebhookBase(this.context.appUrl)}/api/agent/webhooks/wecom/${this.applicationId}`,
    });

    this.pending = connection;
    try {
      await connection.start();
    } catch (error) {
      connection.stop();
      if (generation !== this.generation) return;
      this.pending = null;
      await reportFailure(error);
      throw error;
    }
    if (generation !== this.generation) {
      // Stopped (integration disabled / deleted) or restarted while subscribing.
      connection.stop();
      return;
    }
    this.pending = null;

    this.connection = connection;
    registerWeComConnection(connection);

    if (options?.waitUntil) {
      // Serverless cron host: keep the invocation alive for the window, then let it go.
      options.waitUntil(
        new Promise<void>((resolve) => {
          setTimeout(() => {
            if (this.connection === connection) this.closeConnection();
            resolve();
          }, durationMs);
        }),
      );
    } else {
      this.scheduleRefresh(durationMs);
    }

    await updateBotRuntimeStatus(
      {
        applicationId: this.applicationId,
        platform: this.id,
        status: BOT_RUNTIME_STATUSES.connected,
      },
      statusOptions,
    );
    log('WeCom bot %s connected', this.applicationId);
  }

  async stop(): Promise<void> {
    log('Stopping WeCom bot %s', this.applicationId);
    this.stopped = true;
    this.generation++;
    this.pending?.stop();
    this.pending = null;
    this.closeConnection();
    await updateBotRuntimeStatus(
      {
        applicationId: this.applicationId,
        platform: this.id,
        status: BOT_RUNTIME_STATUSES.disconnected,
      },
      { redisClient: this.context.redisClient as any },
    );
  }

  /**
   * Reconnect periodically. The refresh closes the live socket before subscribing again (a second
   * subscribe would kick the first), so a failed refresh would leave the bot offline: retry it.
   */
  private scheduleRefresh(delayMs: number): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      if (this.stopped) return;
      log('WeCom bot %s: refreshing the long connection', this.applicationId);
      this.start().catch((error) => {
        log('WeCom bot %s refresh failed, retrying: %O', this.applicationId, error);
        if (!this.stopped) this.scheduleRefresh(REFRESH_RETRY_MS);
      });
    }, delayMs);
  }

  private retireConnection(connection: WeComLongConnection): void {
    unregisterWeComConnection(connection);
    if (this.connection !== connection) return;
    this.stopped = true;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
    this.connection = null;
  }

  private closeConnection(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
    if (this.connection) {
      unregisterWeComConnection(this.connection);
      this.connection.stop();
      this.connection = null;
    }
  }

  // --- Runtime Operations ---

  createAdapter(): Record<string, any> {
    return {
      wecom: createWeComAdapter({
        botId: this.applicationId,
        secret: this.config.credentials.secret,
      }),
    };
  }

  getMessenger(platformThreadId: string): PlatformMessenger {
    const thread = decodeWeComThreadId(platformThreadId);
    const deliver = async (text: string) => {
      await requireWeComConnection(this.applicationId).deliver(thread, text);
    };
    return {
      // Outbound attachments are not sent yet (v1): the text still goes out.
      createMessage: (content) => deliver(messengerContentText(content)),
      // A sent message cannot be edited; the edit goes out as a new message.
      editMessage: (_messageId, content) => deliver(messengerContentText(content)),
      removeReaction: () => Promise.resolve(),
      triggerTyping: async () => {
        const connection = getWeComConnection(this.applicationId);
        if (connection?.isConnected) await connection.openStream(thread);
      },
    };
  }

  async extractFiles(message: Message): Promise<ExtractFilesResult | undefined> {
    return wecomExtractFiles(message);
  }

  extractChatId(platformThreadId: string): string {
    return decodeWeComThreadId(platformThreadId).id;
  }

  formatReply(body: string, stats?: UsageStats): string {
    if (!stats || !this.config.settings?.showUsageStats) return body;
    return `${body}\n\n${formatUsageStats(stats)}`;
  }

  parseMessageId(compositeId: string): string {
    return compositeId;
  }
}

export class WeComClientFactory extends ClientFactory {
  createClient(config: BotProviderConfig, context: BotPlatformRuntimeContext): PlatformClient {
    return new WeComClient(config, context);
  }

  /**
   * Check BotID + Secret by subscribing. WeCom keeps one connection per bot and a new subscribe
   * kicks the old one, so a bot this process already runs with the same Secret counts as verified
   * instead of being probed (the probe would knock the live bot offline).
   */
  async validateCredentials(
    credentials: Record<string, string>,
    _settings?: Record<string, unknown>,
    applicationId?: string,
  ): Promise<ValidationResult> {
    const errors: ValidationResult['errors'] = [];
    if (!applicationId) {
      errors.push({
        code: 'missing_credentials',
        field: 'applicationId',
        message: 'BotID is required',
      });
    }
    if (!credentials.secret) {
      errors.push({ code: 'missing_credentials', field: 'secret', message: 'Secret is required' });
    }
    if (errors.length > 0) return { errors, valid: false };

    const live = getWeComConnection(applicationId!);
    if (live?.isConnected && live.usesSecret(credentials.secret)) return { valid: true };

    const probe = new WeComLongConnection({
      botId: applicationId!,
      // A probe only authenticates; it must not forward anything into the agent.
      fetchImpl: (async () => new Response(null, { status: 204 })) as unknown as typeof fetch,
      secret: credentials.secret,
      webhookUrl: 'about:blank',
    });
    try {
      await probe.start();
      return { valid: true };
    } catch (error) {
      return {
        errors: [
          {
            code: 'invalid_credentials',
            field: 'credentials',
            message: error instanceof Error ? error.message : 'Failed to authenticate with WeCom',
          },
        ],
        valid: false,
      };
    } finally {
      probe.stop();
    }
  }
}
