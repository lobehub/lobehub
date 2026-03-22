import type { WeixinUpdate } from '@lobechat/chat-adapter-weixin';
import {
  createWeixinAdapter,
  WEIXIN_ERROR_CODES,
  WeixinApiClient,
} from '@lobechat/chat-adapter-weixin';
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

const log = debug('bot-platform:weixin:bot');

const DEFAULT_DURATION_MS = 10 * 60 * 1000; // 10 minutes
const POLL_TIMEOUT_S = 35; // 35 seconds long-poll
const MAX_CONSECUTIVE_ERRORS = 3;
const ERROR_BACKOFF_MS = 30_000; // 30 seconds
const SESSION_EXPIRED_BACKOFF_MS = 60 * 60 * 1000; // 60 minutes

export interface WeixinGatewayOptions {
  durationMs?: number;
  waitUntil?: (task: Promise<any>) => void;
}

function extractChatId(platformThreadId: string): string {
  return platformThreadId.split(':')[2];
}

class WeixinGatewayClient implements PlatformClient {
  readonly id = 'weixin';
  readonly applicationId: string;

  private abort = new AbortController();
  private config: BotProviderConfig;
  private context: BotPlatformRuntimeContext;
  private api: WeixinApiClient;
  private stopped = false;

  constructor(config: BotProviderConfig, context: BotPlatformRuntimeContext) {
    this.config = config;
    this.context = context;
    this.applicationId = config.applicationId || config.credentials.appToken.slice(0, 8);
    this.api = new WeixinApiClient(config.credentials.appToken);
  }

  // --- Lifecycle ---

  async start(options?: WeixinGatewayOptions): Promise<void> {
    log('Starting WeixinBot appId=%s', this.applicationId);

    this.stopped = false;
    this.abort = new AbortController();

    const durationMs = options?.durationMs ?? DEFAULT_DURATION_MS;
    const waitUntil = options?.waitUntil ?? ((task: Promise<any>) => task.catch(() => {}));
    const webhookUrl = `${(this.context.appUrl || '').trim()}/api/agent/webhooks/weixin/${this.applicationId}`;

    // Start the long-polling loop in background
    const pollTask = this.pollLoop(durationMs, webhookUrl);
    waitUntil(pollTask);

    log('WeixinBot appId=%s started, webhookUrl=%s', this.applicationId, webhookUrl);
  }

  async stop(): Promise<void> {
    log('Stopping WeixinBot appId=%s', this.applicationId);
    this.stopped = true;
    this.abort.abort();
  }

  // --- Long-polling loop ---

  private async pollLoop(durationMs: number, webhookUrl: string): Promise<void> {
    const endTime = Date.now() + durationMs;
    let offset: number | undefined;
    let consecutiveErrors = 0;

    while (!this.stopped && !this.abort.signal.aborted && Date.now() < endTime) {
      try {
        const response = await this.api.getUpdates(offset, POLL_TIMEOUT_S, this.abort.signal);

        if (response.errcode === WEIXIN_ERROR_CODES.SESSION_EXPIRED) {
          log(
            'WeixinBot appId=%s session expired (errcode -14), backing off %dmin',
            this.applicationId,
            SESSION_EXPIRED_BACKOFF_MS / 60_000,
          );
          await this.sleep(SESSION_EXPIRED_BACKOFF_MS);
          break;
        }

        if (response.errcode !== WEIXIN_ERROR_CODES.OK) {
          throw new Error(`getUpdates errcode=${response.errcode}: ${response.errmsg}`);
        }

        consecutiveErrors = 0;

        if (response.data?.updates && response.data.updates.length > 0) {
          for (const update of response.data.updates) {
            if (update.message) {
              await this.forwardToWebhook(webhookUrl, update);
            }
          }
          offset = response.data.nextOffset;
        }
      } catch (err) {
        if (this.abort.signal.aborted) break;

        consecutiveErrors++;
        log(
          'WeixinBot appId=%s poll error (%d/%d): %O',
          this.applicationId,
          consecutiveErrors,
          MAX_CONSECUTIVE_ERRORS,
          err,
        );

        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          log(
            'WeixinBot appId=%s max errors reached, backing off %ds',
            this.applicationId,
            ERROR_BACKOFF_MS / 1000,
          );
          await this.sleep(ERROR_BACKOFF_MS);
          consecutiveErrors = 0;
        }
      }
    }

    log('WeixinBot appId=%s poll loop ended', this.applicationId);
  }

  /**
   * Forward a polled update to the webhook endpoint for Chat SDK processing.
   */
  private async forwardToWebhook(webhookUrl: string, update: WeixinUpdate): Promise<void> {
    try {
      const response = await fetch(webhookUrl, {
        body: JSON.stringify(update),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });

      if (!response.ok) {
        log('WeixinBot appId=%s webhook forward failed: %d', this.applicationId, response.status);
      }
    } catch (err) {
      log('WeixinBot appId=%s webhook forward error: %O', this.applicationId, err);
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
      weixin: createWeixinAdapter({
        appToken: this.config.credentials.appToken,
      }),
    };
  }

  getMessenger(platformThreadId: string): PlatformMessenger {
    const targetId = extractChatId(platformThreadId);
    return {
      createMessage: (content) => this.api.sendMessage({ content, to: targetId }).then(() => {}),
      editMessage: (_messageId, content) =>
        // WeChat doesn't support editing — send a new message
        this.api.sendMessage({ content, to: targetId }).then(() => {}),
      removeReaction: () => Promise.resolve(),
      triggerTyping: () => Promise.resolve(),
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

export class WeixinClientFactory extends ClientFactory {
  createClient(config: BotProviderConfig, context: BotPlatformRuntimeContext): PlatformClient {
    return new WeixinGatewayClient(config, context);
  }

  async validateCredentials(credentials: Record<string, string>): Promise<ValidationResult> {
    const errors: Array<{ field: string; message: string }> = [];

    if (!credentials.appToken) {
      errors.push({ field: 'appToken', message: 'App Token is required' });
    }

    if (errors.length > 0) return { errors, valid: false };

    try {
      const api = new WeixinApiClient(credentials.appToken);
      await api.getBotInfo();
      return { valid: true };
    } catch {
      return {
        errors: [{ field: 'appToken', message: 'Failed to authenticate with iLink API' }],
        valid: false,
      };
    }
  }
}
