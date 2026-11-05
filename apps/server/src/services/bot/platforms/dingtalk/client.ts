import type { DingTalkAdapter, DingTalkRawMessage } from '@lobechat/chat-adapter-dingtalk';
import {
  createDingTalkAdapter,
  DingTalkApiClient,
  DingTalkApiError,
} from '@lobechat/chat-adapter-dingtalk';
import type { Chat as ChatBot, Message } from 'chat';
import debug from 'debug';

import type { AttachmentSource } from '@/server/services/aiAgent/ingestAttachment';
import {
  BOT_RUNTIME_STATUSES,
  getRuntimeStatusErrorMessage,
  updateBotRuntimeStatus,
} from '@/server/services/gateway/runtimeStatus';

import { warnAttachmentFailures } from '../attachmentDelivery';
import {
  type BotCredentialErrorCode,
  type BotPlatformRuntimeContext,
  type BotProviderConfig,
  ClientFactory,
  messengerContentText,
  type PlatformClient,
  type PlatformMessenger,
  type UsageStats,
  type ValidationError,
  type ValidationResult,
} from '../types';
import { formatUsageStats } from '../utils';
import { sendDingTalkText } from './send';
import { sendDingTalkAttachments } from './sendAttachments';
import { withSessionWebhookCapture } from './sessionWebhook';
import { parseDingTalkThreadId } from './threadId';

const log = debug('bot-platform:dingtalk:bot');

const CONNECTED_STATUS_TTL_BUFFER_MS = 60 * 1000;
const DEFAULT_DURATION_MS = 8 * 60 * 60 * 1000; // 8 hours

export interface GatewayListenerOptions {
  durationMs?: number;
  waitUntil?: (task: Promise<any>) => void;
}

// ---------- Credential check ----------

/**
 * Map a failed `POST /v1.0/oauth2/accessToken` to a credential error code.
 *
 * The adapter folds every 4xx from the token endpoint into `kind: 'auth'`, but
 * keeps the HTTP status and DingTalk's error `code`, which is what separates
 * "wrong Client ID / Secret" from "the app is not allowed to do this" and
 * from throttling. Anything that never got an answer from DingTalk (DNS,
 * timeout, connection refused) is `upstream_unavailable`.
 */
export function classifyDingTalkCredentialError(
  error: unknown,
): BotCredentialErrorCode | undefined {
  if (error instanceof DingTalkApiError) {
    const code = error.code ?? '';
    if (error.status === 429 || /throttl|too\.?fast|qpslimit|too\.?many/i.test(code))
      return 'rate_limited';
    if (error.status === 403 || /^forbidden/i.test(code)) return 'permission_denied';
    if (error.status >= 500 || code === 'system.error') return 'upstream_unavailable';
    if (error.kind === 'auth' || (error.status >= 400 && error.status < 500))
      return 'invalid_credentials';
    return undefined;
  }

  const detail = getRuntimeStatusErrorMessage(error) ?? '';
  if (
    /fetch failed|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|timed? ?out|aborted/i.test(
      detail,
    )
  )
    return 'upstream_unavailable';

  return undefined;
}

const CREDENTIAL_ERROR_PREFIX: Partial<Record<BotCredentialErrorCode, string>> = {
  invalid_credentials: 'Invalid DingTalk Client ID or Client Secret',
  permission_denied: 'DingTalk denied access for this app',
  rate_limited: 'DingTalk is rate limiting the access token request',
  upstream_unavailable: 'Could not reach the DingTalk API',
};

/** Resolve the RobotCode the send APIs use: the stored one, else the Client ID. */
const resolveRobotCode = (config: Pick<BotProviderConfig, 'applicationId' | 'credentials'>) =>
  config.credentials.robotCode?.trim() || config.applicationId;

// ---------- Inbound attachments ----------

interface DownloadableItem {
  code: string;
  name?: string;
}

/** The download codes a callback carries, per msgtype (protocol-spec §5.3). */
const collectDownloadCodes = (raw: DingTalkRawMessage): DownloadableItem[] => {
  const content = raw.content;
  switch (raw.msgtype) {
    case 'richText': {
      return (content?.richText ?? [])
        .map((item) => item.downloadCode || item.pictureDownloadCode)
        .filter((code): code is string => !!code)
        .map((code) => ({ code }));
    }
    case 'picture': {
      const code = content?.downloadCode || content?.pictureDownloadCode;
      return code ? [{ code }] : [];
    }
    case 'audio':
    case 'video': {
      return content?.downloadCode ? [{ code: content.downloadCode }] : [];
    }
    case 'file': {
      return content?.downloadCode ? [{ code: content.downloadCode, name: content.fileName }] : [];
    }
    default: {
      return [];
    }
  }
};

/**
 * Resolve the attachments of an inbound DingTalk message.
 *
 * DingTalk ships a `downloadCode`, not a URL, and the adapter's in-memory
 * `fetchData` does not survive the chat SDK's queue serialization — but
 * `message.raw` does. Each code is exchanged for a temporary download URL
 * (`robot/messageFiles/download`); `ingestAttachment` then fetches it and
 * takes the MIME type from the response, which is how images, voice and video
 * get classified (DingTalk sends no MIME type with them).
 */
export async function dingtalkExtractFiles(
  api: DingTalkApiClient,
  message: Message,
): Promise<AttachmentSource[] | undefined> {
  const raw = (message as any).raw as DingTalkRawMessage | undefined;
  if (!raw) return undefined;

  const items = collectDownloadCodes(raw);
  if (items.length === 0) return undefined;

  log('extractFiles: msgId=%s, msgtype=%s, items=%d', raw.msgId, raw.msgtype, items.length);

  const results: AttachmentSource[] = [];
  for (const item of items) {
    try {
      const url = await api.getFileDownloadUrl(item.code);
      if (url) results.push({ name: item.name, url });
    } catch (error) {
      log('extractFiles: failed to resolve downloadCode for msgId=%s: %O', raw.msgId, error);
    }
  }

  return results.length > 0 ? results : undefined;
}

// ---------- Clients ----------

/**
 * Behaviour shared by both connection modes: outbound messaging, inbound
 * attachment resolution and formatting. Only the lifecycle differs.
 */
abstract class DingTalkClientBase implements PlatformClient {
  readonly id = 'dingtalk';
  readonly applicationId: string;

  protected config: BotProviderConfig;
  protected context: BotPlatformRuntimeContext;
  /** Lazy-cached so the access token cache stays hot across sends. */
  private _api?: DingTalkApiClient;

  constructor(config: BotProviderConfig, context: BotPlatformRuntimeContext) {
    this.config = config;
    this.context = context;
    this.applicationId = config.applicationId;
  }

  protected get api(): DingTalkApiClient {
    if (!this._api) {
      this._api = new DingTalkApiClient(
        this.config.applicationId,
        this.config.credentials.clientSecret,
        resolveRobotCode(this.config),
      );
    }
    return this._api;
  }

  abstract start(options?: GatewayListenerOptions): Promise<void>;
  abstract stop(): Promise<void>;

  protected buildAdapter(): DingTalkAdapter {
    return withSessionWebhookCapture(
      createDingTalkAdapter({
        clientId: this.config.applicationId,
        clientSecret: this.config.credentials.clientSecret,
        robotCode: resolveRobotCode(this.config),
      }),
      this.applicationId,
      this.config.credentials.clientSecret,
    );
  }

  createAdapter(): Record<string, any> {
    return { dingtalk: this.buildAdapter() };
  }

  getMessenger(platformThreadId: string): PlatformMessenger {
    const conversation = parseDingTalkThreadId(platformThreadId);
    const send = (text: string) =>
      sendDingTalkText(this.api, this.applicationId, conversation, text).then(() => undefined);

    return {
      createMessage: async (content) => {
        const text = messengerContentText(content);
        const attachments = typeof content === 'string' ? undefined : content.attachments;
        if (attachments?.length) {
          const result = await sendDingTalkAttachments(
            this.api,
            this.applicationId,
            conversation,
            attachments,
            text,
          );
          warnAttachmentFailures('bot-platform:dingtalk:createMessage', result.failures);
          return;
        }
        await send(text);
      },
      // Robot text/markdown messages cannot be edited — send a new message.
      editMessage: (_messageId, content) => send(messengerContentText(content)),
      // DingTalk robots have no reaction or typing API.
      removeReaction: () => Promise.resolve(),
    };
  }

  async extractFiles(message: Message): Promise<AttachmentSource[] | undefined> {
    return dingtalkExtractFiles(this.api, message);
  }

  extractChatId(platformThreadId: string): string {
    return parseDingTalkThreadId(platformThreadId).id;
  }

  /** DingTalk renders markdown natively (`sampleMarkdown`). */
  formatMarkdown(markdown: string): string {
    return markdown;
  }

  formatReply(body: string, stats?: UsageStats): string {
    if (!stats || !this.config.settings?.showUsageStats) return body;
    return `${body}\n\n${formatUsageStats(stats)}`;
  }

  parseMessageId(compositeId: string): string {
    return compositeId;
  }
}

/**
 * Stream mode: holds an outbound WebSocket to DingTalk. Callbacks are ACKed
 * on the socket and forwarded, signed, to `/api/agent/webhooks/dingtalk/:appId`
 * so they run through the same `handleWebhook()` pipeline as HTTP callbacks.
 *
 * Lifecycle mirrors the Feishu / QQ websocket clients: `start()` replaces any
 * previous connection, marks the runtime status, and — when started without
 * gateway-manager options — refreshes itself after `durationMs`; `stop()`
 * aborts the socket and marks the bot disconnected. A credential change goes
 * through the generic stop → start, which opens a fresh connection with the
 * new secret (each reconnect registers a new single-use ticket).
 */
class DingTalkGatewayClient extends DingTalkClientBase {
  private abort = new AbortController();
  private bot: ChatBot<any> | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  async start(options?: GatewayListenerOptions): Promise<void> {
    log('Starting DingTalk bot (stream) appId=%s', this.applicationId);

    this.stopped = false;
    this.abort.abort();
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

      const { Chat, ConsoleLogger } = await import('chat');

      const chatConfig: any = {
        adapters: { dingtalk: this.buildAdapter() },
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

      const adapter = (bot as any).adapters.get('dingtalk') as DingTalkAdapter;
      const waitUntil = options?.waitUntil ?? ((task: Promise<any>) => task.catch(() => {}));
      const webhookUrl = `${(this.context.appUrl || '').trim()}/api/agent/webhooks/dingtalk/${this.applicationId}`;

      await adapter.startGatewayListener({ waitUntil }, durationMs, this.abort.signal, webhookUrl);

      if (!options) {
        this.refreshTimer = setTimeout(() => {
          if (this.abort.signal.aborted || this.stopped) return;

          log(
            'DingTalk bot appId=%s duration elapsed (%dh), refreshing...',
            this.applicationId,
            durationMs / 3_600_000,
          );
          this.start().catch((err) => {
            log('Failed to refresh DingTalk bot appId=%s: %O', this.applicationId, err);
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

      log('DingTalk bot appId=%s started, webhookUrl=%s', this.applicationId, webhookUrl);
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
    log('Stopping DingTalk bot (stream) appId=%s', this.applicationId);
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
}

/**
 * HTTP callback mode: DingTalk POSTs to the webhook URL configured in the
 * developer console. Nothing is held open, so `start()` only proves the
 * credentials work by fetching an access token.
 */
class DingTalkWebhookClient extends DingTalkClientBase {
  async start(): Promise<void> {
    log('Starting DingTalk bot (webhook) appId=%s', this.applicationId);
    await updateBotRuntimeStatus({
      applicationId: this.applicationId,
      platform: this.id,
      status: BOT_RUNTIME_STATUSES.starting,
    });

    try {
      await this.api.getAccessToken();

      await updateBotRuntimeStatus({
        applicationId: this.applicationId,
        platform: this.id,
        status: BOT_RUNTIME_STATUSES.connected,
      });

      log('DingTalk bot (webhook) appId=%s credentials verified', this.applicationId);
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
    log('Stopping DingTalk bot (webhook) appId=%s', this.applicationId);
    await updateBotRuntimeStatus({
      applicationId: this.applicationId,
      platform: this.id,
      status: BOT_RUNTIME_STATUSES.disconnected,
    });
  }
}

// ---------- Factory ----------

export class DingTalkClientFactory extends ClientFactory {
  createClient(config: BotProviderConfig, context: BotPlatformRuntimeContext): PlatformClient {
    // DingTalk shipped with connectionMode in its schema, so every saved row
    // carries one; Stream mode is the default for anything that does not.
    const mode = (config.settings?.connectionMode as string) || 'websocket';
    if (mode === 'webhook') {
      return new DingTalkWebhookClient(config, context);
    }
    return new DingTalkGatewayClient(config, context);
  }

  async validateCredentials(
    credentials: Record<string, string>,
    _settings?: Record<string, unknown>,
    applicationId?: string,
  ): Promise<ValidationResult> {
    const errors: ValidationError[] = [];

    if (!applicationId?.trim())
      errors.push({
        code: 'missing_credentials',
        field: 'applicationId',
        message: 'Client ID is required',
      });
    if (!credentials.clientSecret?.trim())
      errors.push({
        code: 'missing_credentials',
        field: 'clientSecret',
        message: 'Client Secret is required',
      });

    if (errors.length > 0) return { errors, valid: false };

    try {
      const api = new DingTalkApiClient(applicationId!, credentials.clientSecret);
      await api.getAccessToken();
      return { valid: true };
    } catch (error) {
      // Keep DingTalk's own reason next to the readable prefix: the code tells
      // the UI which hint to show, the detail tells the operator what to fix.
      const code = classifyDingTalkCredentialError(error);
      const detail = getRuntimeStatusErrorMessage(error);
      const prefix =
        (code && CREDENTIAL_ERROR_PREFIX[code]) || 'Failed to authenticate with DingTalk API';
      return {
        errors: [
          {
            code,
            field: 'credentials',
            message: detail ? `${prefix}: ${detail}` : prefix,
          },
        ],
        valid: false,
      };
    }
  }
}
