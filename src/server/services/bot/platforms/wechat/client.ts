import type { WechatRawMessage } from '@lobechat/chat-adapter-wechat';
import {
  createWechatAdapter,
  MessageState,
  MessageType,
  WECHAT_RET_CODES,
  WechatApiClient,
} from '@lobechat/chat-adapter-wechat';
import debug from 'debug';

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

const DEFAULT_DURATION_MS = 10 * 60 * 1000; // 10 minutes
const MAX_CONSECUTIVE_ERRORS = 3;
const ERROR_BACKOFF_MS = 30_000; // 30 seconds
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

class WechatGatewayClient implements PlatformClient {
  readonly id = 'wechat';
  readonly applicationId: string;

  private abort = new AbortController();
  private config: BotProviderConfig;
  private context: BotPlatformRuntimeContext;
  private api: WechatApiClient;
  private stopped = false;
  /** Cached context tokens per user ID for replies */
  private contextTokens = new Map<string, string>();
  /** Typing ticket from getconfig */
  private typingTicket?: string;

  constructor(config: BotProviderConfig, context: BotPlatformRuntimeContext) {
    this.config = config;
    this.context = context;
    this.applicationId = config.applicationId || config.credentials.botToken.slice(0, 8);
    this.api = new WechatApiClient(config.credentials.botToken, config.credentials.botId);
  }

  // --- Lifecycle ---

  async start(options?: WechatGatewayOptions): Promise<void> {
    log('Starting WechatBot appId=%s', this.applicationId);

    this.stopped = false;
    this.abort = new AbortController();

    // Fetch typing ticket
    try {
      const configResp = await this.api.getConfig();
      if (configResp.typing_ticket) {
        this.typingTicket = configResp.typing_ticket;
      }
    } catch (err) {
      log('WechatBot appId=%s failed to get config: %O', this.applicationId, err);
    }

    const durationMs = options?.durationMs ?? DEFAULT_DURATION_MS;
    const waitUntil = options?.waitUntil ?? ((task: Promise<any>) => task.catch(() => {}));
    const webhookUrl = `${(this.context.appUrl || '').trim()}/api/agent/webhooks/wechat/${this.applicationId}`;

    // Start the long-polling loop in background
    const pollTask = this.pollLoop(durationMs, webhookUrl);
    waitUntil(pollTask);

    log('WechatBot appId=%s started, webhookUrl=%s', this.applicationId, webhookUrl);
  }

  async stop(): Promise<void> {
    log('Stopping WechatBot appId=%s', this.applicationId);
    this.stopped = true;
    this.abort.abort();
  }

  // --- Long-polling loop ---

  private async pollLoop(durationMs: number, webhookUrl: string): Promise<void> {
    const endTime = Date.now() + durationMs;
    let cursor: string | undefined;
    let consecutiveErrors = 0;

    while (!this.stopped && !this.abort.signal.aborted && Date.now() < endTime) {
      try {
        const response = await this.api.getUpdates(cursor, this.abort.signal);

        if (
          response.ret === WECHAT_RET_CODES.SESSION_EXPIRED ||
          response.errcode === WECHAT_RET_CODES.SESSION_EXPIRED
        ) {
          log(
            'WechatBot appId=%s session expired (ret -14), backing off %dmin',
            this.applicationId,
            SESSION_EXPIRED_BACKOFF_MS / 60_000,
          );
          cursor = undefined;
          await this.sleep(SESSION_EXPIRED_BACKOFF_MS);
          break;
        }

        if (response.ret !== WECHAT_RET_CODES.OK) {
          throw new Error(`getupdates ret=${response.ret}: ${response.errmsg || ''}`);
        }

        consecutiveErrors = 0;

        // Update cursor
        if (response.get_updates_buf) {
          cursor = response.get_updates_buf;
        }

        // Process messages
        if (response.msgs && response.msgs.length > 0) {
          for (const msg of response.msgs) {
            // Skip bot's own messages and non-finished user messages
            if (msg.message_type === MessageType.BOT) continue;
            if (msg.message_state !== undefined && msg.message_state !== MessageState.FINISH)
              continue;

            // Cache context token
            this.contextTokens.set(msg.from_user_id, msg.context_token);

            // Forward to webhook
            await this.forwardToWebhook(webhookUrl, msg);
          }
        }
      } catch (err) {
        if (this.abort.signal.aborted) break;

        consecutiveErrors++;
        log(
          'WechatBot appId=%s poll error (%d/%d): %O',
          this.applicationId,
          consecutiveErrors,
          MAX_CONSECUTIVE_ERRORS,
          err,
        );

        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          log(
            'WechatBot appId=%s max errors reached, backing off %ds',
            this.applicationId,
            ERROR_BACKOFF_MS / 1000,
          );
          await this.sleep(ERROR_BACKOFF_MS);
          consecutiveErrors = 0;
        } else {
          await this.sleep(2000);
        }
      }
    }

    log('WechatBot appId=%s poll loop ended', this.applicationId);
  }

  /**
   * Forward a polled message to the webhook endpoint for Chat SDK processing.
   */
  private async forwardToWebhook(webhookUrl: string, msg: WechatRawMessage): Promise<void> {
    try {
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
    const contextToken = this.contextTokens.get(targetId) || '';
    return {
      createMessage: (content) =>
        this.api.sendMessage(targetId, content, contextToken).then(() => {}),
      editMessage: (_messageId, content) =>
        // WeChat doesn't support editing — send a new message
        this.api.sendMessage(targetId, content, contextToken).then(() => {}),
      removeReaction: () => Promise.resolve(),
      triggerTyping: () => {
        if (this.typingTicket) {
          return this.api.sendTyping(targetId, this.typingTicket, true);
        }
        return Promise.resolve();
      },
    };
  }

  extractChatId(platformThreadId: string): string {
    return extractChatId(platformThreadId);
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
    const errors: Array<{ field: string; message: string }> = [];

    if (!credentials.botToken) {
      errors.push({ field: 'botToken', message: 'Bot Token is required' });
    }

    if (errors.length > 0) return { errors, valid: false };

    try {
      const api = new WechatApiClient(credentials.botToken, credentials.botId);
      const valid = await api.verifyToken();
      if (!valid) throw new Error('Token verification failed');
      return { valid: true };
    } catch {
      return {
        errors: [{ field: 'botToken', message: 'Failed to authenticate with iLink API' }],
        valid: false,
      };
    }
  }
}
