import type { WechatRawMessage } from '@lobechat/chat-adapter-wechat';
import {
  createWechatAdapter,
  MessageState,
  MessageType,
  WechatApiClient,
} from '@lobechat/chat-adapter-wechat';
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

const log = debug('bot-platform:wechat:bot');

const CONNECTED_STATUS_TTL_BUFFER_MS = 60 * 1000;
const DEFAULT_DURATION_MS = 10 * 60 * 1000; // 10 minutes
const MAX_RETRY_DELAY_MS = 10_000; // 10 seconds cap (matches reference)
const READY_PROBE_TIMEOUT_MS = 3000; // Allow the first long-poll request to establish
const SESSION_EXPIRED_BACKOFF_MS = 60 * 60 * 1000; // 60 minutes

export interface WechatGatewayOptions {
  durationMs?: number;
  waitUntil?: (task: Promise<any>) => void;
}

function extractChatId(platformThreadId: string): string {
  // Thread ID format: wechat:type:userId (userId may contain colons)
  const parts = platformThreadId.split(':');
  return parts.slice(2).join(':');
}

function getWechatBotToken(credentials: Record<string, string>): string {
  const botToken = credentials.botToken?.trim();

  if (!botToken) {
    throw new Error('Bot Token is required');
  }

  return botToken;
}

function resolveWechatApplicationId(config: BotProviderConfig, botToken: string): string {
  return config.applicationId || config.credentials.botId || botToken.slice(0, 8);
}

class WechatGatewayClient implements PlatformClient {
  readonly id = 'wechat';
  readonly applicationId: string;

  private abort = new AbortController();
  private config: BotProviderConfig;
  private context: BotPlatformRuntimeContext;
  private api: WechatApiClient;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  /** Cached context tokens per user ID for replies */
  private contextTokens = new Map<string, string>();

  constructor(config: BotProviderConfig, context: BotPlatformRuntimeContext) {
    this.config = config;
    this.context = context;
    const botToken = getWechatBotToken(config.credentials);

    this.applicationId = resolveWechatApplicationId(config, botToken);
    this.api = new WechatApiClient(botToken, config.credentials.botId);
  }

  // --- Lifecycle ---

  async start(options?: WechatGatewayOptions): Promise<void> {
    log('Starting WechatBot appId=%s', this.applicationId);

    this.stopped = false;
    this.abort = new AbortController();

    const durationMs = options?.durationMs ?? DEFAULT_DURATION_MS;
    const runtimeStatusTtlMs = durationMs + CONNECTED_STATUS_TTL_BUFFER_MS;
    const waitUntil = options?.waitUntil ?? ((task: Promise<any>) => task.catch(() => {}));
    const webhookUrl = `${(this.context.appUrl || '').trim()}/api/agent/webhooks/wechat/${this.applicationId}`;
    await updateBotRuntimeStatus(
      {
        applicationId: this.applicationId,
        platform: this.id,
        status: BOT_RUNTIME_STATUSES.starting,
      },
      { redisClient: this.context.redisClient as any, ttlMs: runtimeStatusTtlMs },
    );

    try {
      const cursor = await this.primePolling(webhookUrl);

      if (this.abort.signal.aborted || this.stopped) return;

      // Start the long-polling loop in background
      const pollTask = this.pollLoop(durationMs, webhookUrl, cursor);
      waitUntil(pollTask);

      // When called from GatewayManager (no explicit options), schedule auto-refresh
      // so the poller restarts after the duration instead of going silent.
      if (!options) {
        this.refreshTimer = setTimeout(() => {
          if (this.abort.signal.aborted || this.stopped) return;

          log(
            'WechatBot appId=%s duration elapsed (%dmin), refreshing...',
            this.applicationId,
            durationMs / 60_000,
          );
          this.abort.abort();
          this.start().catch((err) => {
            log('Failed to refresh WechatBot appId=%s: %O', this.applicationId, err);
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

      log('WechatBot appId=%s started, webhookUrl=%s', this.applicationId, webhookUrl);
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
    log('Stopping WechatBot appId=%s', this.applicationId);
    this.stopped = true;
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.abort.abort();
    await updateBotRuntimeStatus(
      {
        applicationId: this.applicationId,
        platform: this.id,
        status: BOT_RUNTIME_STATUSES.disconnected,
      },
      { redisClient: this.context.redisClient as any },
    );
  }

  // --- Long-polling loop ---

  private async pollLoop(
    durationMs: number,
    webhookUrl: string,
    initialCursor?: string,
  ): Promise<void> {
    const endTime = Date.now() + durationMs;
    let cursor = initialCursor;
    let retryDelay = 1000; // Start at 1s, exponential up to MAX_RETRY_DELAY_MS

    while (!this.stopped && !this.abort.signal.aborted && Date.now() < endTime) {
      try {
        const response = await this.api.getUpdates(cursor, this.abort.signal);

        // Reset retry delay on success
        retryDelay = 1000;

        // Update cursor
        if (response.get_updates_buf) {
          cursor = response.get_updates_buf;
        }

        await this.processUpdates(response.msgs, webhookUrl);
      } catch (err: any) {
        if (this.abort.signal.aborted) break;

        // Session expired (errcode -14) — clear cursor, long backoff
        if (err?.code === -14) {
          log(
            'WechatBot appId=%s session expired, backing off %dmin',
            this.applicationId,
            SESSION_EXPIRED_BACKOFF_MS / 60_000,
          );
          await this.sleep(SESSION_EXPIRED_BACKOFF_MS);
          break;
        }

        log('WechatBot appId=%s poll error: %s', this.applicationId, err?.message || err);

        // Exponential backoff capped at MAX_RETRY_DELAY_MS (matches reference)
        await this.sleep(retryDelay);
        retryDelay = Math.min(retryDelay * 2, MAX_RETRY_DELAY_MS);
      }
    }

    log('WechatBot appId=%s poll loop ended', this.applicationId);
  }

  /**
   * Start with a short-lived probe request so connection setup doesn't report
   * success before WeChat long-polling has had a chance to come online.
   */
  private async primePolling(webhookUrl: string): Promise<string | undefined> {
    const probeAbort = new AbortController();
    const timer = setTimeout(() => {
      probeAbort.abort();
    }, READY_PROBE_TIMEOUT_MS);

    try {
      const signal = AbortSignal.any([this.abort.signal, probeAbort.signal]);
      const response = await this.api.getUpdates(undefined, signal);

      await this.processUpdates(response.msgs, webhookUrl);
      return response.get_updates_buf || undefined;
    } catch (err) {
      if (this.abort.signal.aborted || probeAbort.signal.aborted) {
        log('WechatBot appId=%s readiness probe timed out, continuing', this.applicationId);
        return undefined;
      }

      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  private async processUpdates(
    msgs: WechatRawMessage[] | undefined,
    webhookUrl: string,
  ): Promise<void> {
    if (!msgs || msgs.length === 0) return;

    for (const msg of msgs) {
      // Skip bot's own messages and non-finished user messages
      if (msg.message_type === MessageType.BOT) continue;
      if (msg.message_state !== undefined && msg.message_state !== MessageState.FINISH) continue;

      // Cache context token in memory and persist to Redis for queue-mode callbacks
      this.contextTokens.set(msg.from_user_id, msg.context_token);
      this.persistContextToken(msg.from_user_id, msg.context_token);

      // Forward to webhook
      await this.forwardToWebhook(webhookUrl, msg);
    }
  }

  /**
   * Forward a polled message to the webhook endpoint for Chat SDK processing.
   */
  private async forwardToWebhook(webhookUrl: string, msg: WechatRawMessage): Promise<void> {
    try {
      log('WechatBot appId=%s forwarding msg from %s', this.applicationId, msg.from_user_id);
      const response = await fetch(webhookUrl, {
        body: JSON.stringify(msg),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });

      if (!response.ok) {
        log('WechatBot appId=%s webhook forward failed: %d', this.applicationId, response.status);
      }
    } catch (err) {
      log('WechatBot appId=%s webhook forward error: %O', this.applicationId, err);
    }
  }

  private contextTokenRedisKey(userId: string): string {
    return `wechat:ctx-token:${this.applicationId}:${userId}`;
  }

  private persistContextToken(userId: string, token: string): void {
    if (!this.context.redisClient) return;
    const key = this.contextTokenRedisKey(userId);
    // 24h TTL — tokens are refreshed on every inbound message.
    // The redisClient is a raw ioredis instance (cast via `as any`), so use
    // positional args instead of the { ex } object form.
    (this.context.redisClient as any).set(key, token, 'EX', 86_400).catch((err: any) => {
      log('WechatBot appId=%s failed to persist context token: %s', this.applicationId, err);
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      this.abort.signal.addEventListener('abort', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  // --- Runtime Operations ---

  createAdapter(): Record<string, any> {
    return {
      wechat: createWechatAdapter({
        botId: this.config.credentials.botId,
        botToken: this.config.credentials.botToken,
      }),
    };
  }

  getMessenger(platformThreadId: string): PlatformMessenger {
    const targetId = extractChatId(platformThreadId);

    // Resolve context token: in-memory cache first, then Redis fallback.
    // This allows queue-mode callbacks (fresh client instances) to recover
    // the token that was persisted by the long-polling instance.
    const resolveToken = async (): Promise<string> => {
      const cached = this.contextTokens.get(targetId);
      if (cached) return cached;

      if (this.context.redisClient) {
        const redisKey = this.contextTokenRedisKey(targetId);
        const token = await this.context.redisClient.get(redisKey);
        if (token) {
          this.contextTokens.set(targetId, token);
          return token;
        }
      }

      return '';
    };

    return {
      createMessage: async (content) => {
        const token = await resolveToken();
        await this.api.sendMessage(targetId, content, token);
      },
      editMessage: async (_messageId, content) => {
        // WeChat doesn't support editing — send a new message
        const token = await resolveToken();
        await this.api.sendMessage(targetId, content, token);
      },
      removeReaction: () => Promise.resolve(),
      triggerTyping: async () => {
        const token = await resolveToken();
        if (!token) {
          log('triggerTyping: no context token for user=%s', targetId);
          return;
        }
        await this.api.startTyping(targetId, token);
      },
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

export class WechatClientFactory extends ClientFactory {
  createClient(config: BotProviderConfig, context: BotPlatformRuntimeContext): PlatformClient {
    return new WechatGatewayClient(config, context);
  }

  async validateCredentials(credentials: Record<string, string>): Promise<ValidationResult> {
    if (!credentials.botToken) {
      return {
        errors: [{ field: 'botToken', message: 'Bot Token is required' }],
        valid: false,
      };
    }

    // WeChat token validity is verified during the long-polling connection.
    // The iLink API doesn't provide a lightweight token check endpoint.
    return { valid: true };
  }
}
