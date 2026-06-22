import type { MatrixAdapter, MatrixRoomEvent } from '@lobechat/chat-adapter-matrix';
import {
  createMatrixAdapter,
  markdownToMatrixHtml,
  MatrixApiClient,
} from '@lobechat/chat-adapter-matrix';
import type { Chat as ChatBot, Message } from 'chat';
import debug from 'debug';

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
  messengerContentText,
  type PlatformClient,
  type PlatformMessenger,
  type UsageStats,
  type ValidationResult,
} from '../types';
import { formatUsageStats } from '../utils';

const log = debug('bot-platform:matrix:bot');

const CONNECTED_STATUS_TTL_BUFFER_MS = 60 * 1000;
const DEFAULT_DURATION_MS = 8 * 60 * 60 * 1000; // 8 hours

export interface SyncListenerOptions {
  durationMs?: number;
  waitUntil?: (task: Promise<any>) => void;
}

/** Decode `matrix:<d|g>:<roomId>` → roomId (room IDs themselves contain colons). */
function extractRoomId(platformThreadId: string): string {
  const parts = platformThreadId.split(':');
  if (parts.length < 3 || parts[0] !== 'matrix') return platformThreadId;
  return parts.slice(2).join(':');
}

/**
 * Resolve inbound Matrix media into `AttachmentSource[]` by re-downloading the
 * `mxc://` content. We read the surviving `message.raw` event (functions and
 * buffers don't survive `Message.toJSON` across the Redis debounce queue, but
 * `raw` does) and download via the authenticated media endpoint.
 */
async function matrixExtractFiles(
  api: MatrixApiClient,
  message: Message,
): Promise<AttachmentSource[] | undefined> {
  const raw = (message as any).raw as MatrixRoomEvent | undefined;
  const content = raw?.content;
  const mxc = content?.url;
  if (!mxc || typeof mxc !== 'string' || !mxc.startsWith('mxc://')) return undefined;

  try {
    const buffer = await api.downloadMedia(mxc);
    return [
      {
        buffer,
        mimeType: content?.info?.mimetype,
        name: content?.filename ?? content?.body ?? 'file',
        size: content?.info?.size ?? buffer.length,
      },
    ];
  } catch (error) {
    log('extractFiles: download failed for %s: %O', mxc, error);
    return undefined;
  }
}

class MatrixClient implements PlatformClient {
  readonly id = 'matrix';
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
    // The bot's MXID (`@bot:server.org`) is the application id.
    this.applicationId = config.applicationId;
  }

  private get homeserverUrl(): string {
    return this.config.credentials.homeserverUrl;
  }

  private get accessToken(): string {
    return this.config.credentials.accessToken;
  }

  private newApi(): MatrixApiClient {
    return new MatrixApiClient({
      accessToken: this.accessToken,
      homeserverUrl: this.homeserverUrl,
    });
  }

  private adapterConfig() {
    return {
      accessToken: this.accessToken,
      homeserverUrl: this.homeserverUrl,
      userId: this.applicationId,
    };
  }

  // --- Lifecycle ---

  async start(options?: SyncListenerOptions): Promise<void> {
    log('Starting MatrixBot appId=%s', this.applicationId);

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

      const adapter = createMatrixAdapter(this.adapterConfig());
      const { Chat, ConsoleLogger } = await import('chat');

      const chatConfig: any = {
        adapters: { matrix: adapter },
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

      const matrixAdapter = (bot as any).adapters.get('matrix') as MatrixAdapter;
      const waitUntil = options?.waitUntil ?? ((task: Promise<any>) => task.catch(() => {}));
      const webhookUrl = `${(this.context.appUrl || '').trim()}/api/agent/webhooks/matrix/${this.applicationId}`;

      await matrixAdapter.startSyncListener(
        { waitUntil },
        durationMs,
        this.abort.signal,
        webhookUrl,
      );

      if (!options) {
        this.refreshTimer = setTimeout(() => {
          if (this.abort.signal.aborted || this.stopped) return;
          log(
            'MatrixBot appId=%s duration elapsed (%dh), refreshing...',
            this.applicationId,
            durationMs / 3_600_000,
          );
          this.abort.abort();
          this.start().catch((err) => {
            log('Failed to refresh MatrixBot appId=%s: %O', this.applicationId, err);
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

      log('MatrixBot appId=%s started, webhookUrl=%s', this.applicationId, webhookUrl);
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
    log('Stopping MatrixBot appId=%s', this.applicationId);
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
    return { matrix: createMatrixAdapter(this.adapterConfig()) };
  }

  getMessenger(platformThreadId: string): PlatformMessenger {
    const api = this.newApi();
    const roomId = extractRoomId(platformThreadId);
    return {
      addReaction: (messageId, emoji) => api.sendReaction(roomId, messageId, emoji).then(() => {}),
      createMessage: async (content) => {
        const text = messengerContentText(content);
        if (!text.trim()) return;
        const html = markdownToMatrixHtml(text);
        await api.sendMessage(roomId, {
          body: text,
          format: html ? 'org.matrix.custom.html' : undefined,
          formatted_body: html || undefined,
          msgtype: 'm.notice',
        });
      },
      editMessage: async (messageId, content) => {
        const text = messengerContentText(content);
        const html = markdownToMatrixHtml(text);
        await api.editMessage(roomId, messageId, {
          body: text,
          format: html ? 'org.matrix.custom.html' : undefined,
          formatted_body: html || undefined,
          msgtype: 'm.notice',
        });
      },
      // Removing a Matrix reaction requires redacting the reaction event whose
      // id we don't track here — no-op for v1 (callers guard with optional
      // chaining via replaceReaction being absent).
      removeReaction: () => Promise.resolve(),
      triggerTyping: () => api.sendTyping(roomId, this.applicationId, true).catch(() => {}),
    };
  }

  async extractFiles(message: Message): Promise<AttachmentSource[] | undefined> {
    return matrixExtractFiles(this.newApi(), message);
  }

  extractChatId(platformThreadId: string): string {
    return extractRoomId(platformThreadId);
  }

  formatReply(body: string, stats?: UsageStats): string {
    if (!stats || !this.config.settings?.showUsageStats) return body;
    return `${body}\n\n${formatUsageStats(stats)}`;
  }

  parseMessageId(compositeId: string): string {
    return compositeId;
  }
}

export class MatrixClientFactory extends ClientFactory {
  createClient(config: BotProviderConfig, context: BotPlatformRuntimeContext): PlatformClient {
    return new MatrixClient(config, context);
  }

  async validateCredentials(
    credentials: Record<string, string>,
    _settings?: Record<string, unknown>,
    applicationId?: string,
  ): Promise<ValidationResult> {
    const errors: Array<{ field: string; message: string }> = [];

    if (!credentials.homeserverUrl)
      errors.push({ field: 'homeserverUrl', message: 'Homeserver URL is required' });
    if (!credentials.accessToken)
      errors.push({ field: 'accessToken', message: 'Access Token is required' });
    if (!applicationId)
      errors.push({ field: 'applicationId', message: 'Bot User ID is required' });

    if (errors.length > 0) return { errors, valid: false };

    try {
      const api = new MatrixApiClient({
        accessToken: credentials.accessToken,
        homeserverUrl: credentials.homeserverUrl,
      });
      const who = await api.whoami();
      if (applicationId && who.user_id && who.user_id !== applicationId) {
        return {
          errors: [
            {
              field: 'applicationId',
              message: `Token belongs to ${who.user_id}, not ${applicationId}`,
            },
          ],
          valid: false,
        };
      }
      return { valid: true };
    } catch {
      return {
        errors: [{ field: 'accessToken', message: 'Failed to authenticate with the homeserver' }],
        valid: false,
      };
    }
  }
}
