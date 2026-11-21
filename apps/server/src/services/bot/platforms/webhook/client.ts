import type { Message } from 'chat';
import debug from 'debug';
import pMap from 'p-map';

import type { AttachmentSource } from '@/server/services/aiAgent/ingestAttachment';
import {
  BOT_RUNTIME_STATUSES,
  updateBotRuntimeStatus,
} from '@/server/services/gateway/runtimeStatus';

import { fetchCappedBuffer } from '../loadAttachmentBuffer';
import {
  type BotPlatformRuntimeContext,
  type BotProviderConfig,
  ClientFactory,
  type PlatformClient,
  type PlatformMessenger,
  type UsageStats,
  type ValidationError,
  type ValidationResult,
} from '../types';
import { formatUsageStats } from '../utils';
import { createBotWebhookAdapter } from './adapter';
import {
  BotWebhookCallbackError,
  type BotWebhookCallbackTarget,
  newOutboundMessageId,
  sendBotWebhookEvent,
} from './callback';
import { toOutboundMessage } from './outbound';
import {
  BOT_ID_PATTERN,
  BOT_WEBHOOK_OUTBOUND_EVENTS,
  type BotWebhookInboundAttachment,
  decodeWebhookThreadId,
  MIN_SIGNING_SECRET_LENGTH,
  WEBHOOK_PLATFORM_ID,
} from './protocol';

const log = debug('bot-platform:webhook:client');

/** Inbound attachments are downloaded on demand, each capped at this size. */
const MAX_INBOUND_ATTACHMENT_BYTES = 20 * 1024 * 1024;
/** Inbound attachments downloaded at once for one message. */
const INBOUND_ATTACHMENT_DOWNLOAD_CONCURRENCY = 3;

export const toCallbackTarget = (
  applicationId: string,
  credentials: Record<string, string>,
): BotWebhookCallbackTarget => ({
  botId: applicationId,
  callbackUrl: credentials.callbackUrl,
  signingSecret: credentials.signingSecret,
});

const DEFAULT_MIME: Record<BotWebhookInboundAttachment['type'], string> = {
  audio: 'audio/mpeg',
  file: 'application/octet-stream',
  image: 'image/png',
  video: 'video/mp4',
};

class BotWebhookClient implements PlatformClient {
  readonly id = WEBHOOK_PLATFORM_ID;
  readonly applicationId: string;

  private config: BotProviderConfig;
  private target: BotWebhookCallbackTarget;

  constructor(config: BotProviderConfig, _context: BotPlatformRuntimeContext) {
    this.config = config;
    this.applicationId = config.applicationId;
    this.target = toCallbackTarget(config.applicationId, config.credentials);
  }

  // --- Lifecycle ---

  async start(): Promise<void> {
    // Nothing to register: the developer points their platform at the inbound URL, and
    // "Test connection" is where the callback URL is checked.
    await updateBotRuntimeStatus({
      applicationId: this.applicationId,
      platform: this.id,
      status: BOT_RUNTIME_STATUSES.connected,
    });
  }

  async stop(): Promise<void> {
    await updateBotRuntimeStatus({
      applicationId: this.applicationId,
      platform: this.id,
      status: BOT_RUNTIME_STATUSES.disconnected,
    });
  }

  // --- Runtime Operations ---

  createAdapter(): Record<string, any> {
    return { [WEBHOOK_PLATFORM_ID]: createBotWebhookAdapter(this.target) };
  }

  getMessenger(platformThreadId: string): PlatformMessenger {
    return {
      createMessage: async (content) => {
        const message = toOutboundMessage(platformThreadId, newOutboundMessageId(), content);
        if (!message.text.trim() && message.attachments.length === 0) return;
        await sendBotWebhookEvent(this.target, BOT_WEBHOOK_OUTBOUND_EVENTS.messageCreated, message);
      },
      editMessage: async (messageId, content) => {
        await sendBotWebhookEvent(
          this.target,
          BOT_WEBHOOK_OUTBOUND_EVENTS.messageUpdated,
          toOutboundMessage(platformThreadId, messageId, content),
        );
      },
      removeReaction: () => Promise.resolve(),
    };
  }

  /**
   * Download inbound attachments from the URLs the developer sent. Each one goes through
   * the SSRF-guarded public fetch (private addresses are refused) under a size cap; a
   * failed download drops that attachment rather than the whole message. Downloads run a
   * few at a time, so one message cannot open a burst of outbound requests.
   */
  async extractFiles(message: Message): Promise<AttachmentSource[] | undefined> {
    const attachments = ((message as any).attachments ?? []) as Array<{
      raw?: BotWebhookInboundAttachment;
    }>;
    const sources = await pMap(
      attachments,
      async ({ raw }): Promise<AttachmentSource | undefined> => {
        if (!raw?.url) return undefined;
        const buffer = await fetchCappedBuffer(raw.url, { limit: MAX_INBOUND_ATTACHMENT_BYTES });
        if (!buffer) {
          log('extractFiles: could not download %s attachment', raw.type);
          return undefined;
        }
        return {
          buffer,
          mimeType: raw.mimeType || DEFAULT_MIME[raw.type],
          name: raw.name || `${raw.type}`,
          size: buffer.length,
        };
      },
      { concurrency: INBOUND_ATTACHMENT_DOWNLOAD_CONCURRENCY },
    );
    const files = sources.filter((source): source is AttachmentSource => Boolean(source));
    return files.length > 0 ? files : undefined;
  }

  extractChatId(platformThreadId: string): string {
    return decodeWebhookThreadId(platformThreadId).conversationId;
  }

  formatReply(body: string, stats?: UsageStats): string {
    if (!stats || !this.config.settings?.showUsageStats) return body;
    return `${body}\n\n${formatUsageStats(stats)}`;
  }

  parseMessageId(compositeId: string): string {
    return compositeId;
  }
}

const isHttpUrl = (value: string | undefined) => {
  if (!value) return false;
  try {
    const { protocol } = new URL(value);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
};

export class BotWebhookClientFactory extends ClientFactory {
  createClient(config: BotProviderConfig, context: BotPlatformRuntimeContext): PlatformClient {
    return new BotWebhookClient(config, context);
  }

  /**
   * Format checks, then a signed `bot.ping` to the callback URL: the check passes only
   * when the developer's receiver answers 2xx, which proves both reachability and that
   * they accept LobeHub's signature.
   */
  async validateCredentials(
    credentials: Record<string, string>,
    _settings?: Record<string, unknown>,
    applicationId?: string,
  ): Promise<ValidationResult> {
    const errors: ValidationError[] = [];
    if (!applicationId || !new RegExp(BOT_ID_PATTERN).test(applicationId))
      errors.push({
        code: 'missing_credentials',
        field: 'applicationId',
        message: 'Bot ID must be 3-64 letters, digits, "-" or "_", and not a UUID',
      });
    if (!isHttpUrl(credentials.callbackUrl))
      errors.push({
        code: 'missing_credentials',
        field: 'callbackUrl',
        message: 'Callback URL must be an http(s) URL',
      });
    if ((credentials.signingSecret?.length ?? 0) < MIN_SIGNING_SECRET_LENGTH)
      errors.push({
        code: 'missing_credentials',
        field: 'signingSecret',
        message: `Signing secret must be at least ${MIN_SIGNING_SECRET_LENGTH} characters`,
      });
    if (errors.length > 0) return { errors, valid: false };

    try {
      await sendBotWebhookEvent(
        toCallbackTarget(applicationId!, credentials),
        BOT_WEBHOOK_OUTBOUND_EVENTS.ping,
        { message: 'LobeHub connection test' },
        // An interactive check answers on the first try; retries are for replies.
        { attempts: 1 },
      );
      return { valid: true };
    } catch (error) {
      const message =
        error instanceof BotWebhookCallbackError
          ? error.message
          : `Callback URL check failed: ${(error as Error)?.message ?? 'unknown error'}`;
      return {
        errors: [{ code: 'upstream_unavailable', field: 'callbackUrl', message }],
        valid: false,
      };
    }
  }
}
