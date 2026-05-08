import {
  createLineAdapter,
  getMediaFileNameAndType,
  LineApiClient,
  type LineMessage,
  resolveMediaMessageId,
} from '@lobechat/chat-adapter-line';
import type { Message } from 'chat';
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

const log = debug('bot-platform:line:bot');

interface DecodedThread {
  id: string;
  type: 'group' | 'room' | 'user';
}

function decodeThread(platformThreadId: string): DecodedThread {
  // line:<type>:<id>
  const parts = platformThreadId.split(':');
  if (parts.length < 3 || parts[0] !== 'line') {
    return { id: platformThreadId, type: 'user' };
  }
  const type = parts[1];
  return {
    id: parts.slice(2).join(':'),
    type: type === 'group' || type === 'room' ? (type as 'group' | 'room') : 'user',
  };
}

function defaultMimeForType(type: string | undefined): string {
  switch (type) {
    case 'image': {
      return 'image/jpeg';
    }
    case 'video': {
      return 'video/mp4';
    }
    case 'audio': {
      return 'audio/m4a';
    }
    default: {
      return 'application/octet-stream';
    }
  }
}

function defaultNameForType(type: string | undefined, fileName?: string): string {
  if (fileName) return fileName;
  switch (type) {
    case 'image': {
      return 'image.jpg';
    }
    case 'video': {
      return 'video.mp4';
    }
    case 'audio': {
      return 'audio.m4a';
    }
    default: {
      return 'file.bin';
    }
  }
}

class LineWebhookClient implements PlatformClient {
  readonly id = 'line';
  readonly applicationId: string;

  private config: BotProviderConfig;
  private context: BotPlatformRuntimeContext;
  private api: LineApiClient;

  constructor(config: BotProviderConfig, context: BotPlatformRuntimeContext) {
    this.config = config;
    this.context = context;
    this.applicationId = config.applicationId;
    this.api = new LineApiClient({ accessToken: config.credentials.channelAccessToken });
  }

  // --- Lifecycle ---

  async start(): Promise<void> {
    log('Starting LineBot appId=%s', this.applicationId);
    await updateBotRuntimeStatus({
      applicationId: this.applicationId,
      platform: this.id,
      status: BOT_RUNTIME_STATUSES.starting,
    });

    try {
      // LINE has no programmatic webhook registration — operators paste the
      // URL into the LINE Developers Console. We can still verify the token
      // and confirm the bot identity matches the configured applicationId
      // (destination userId) so a clearly-wrong provider doesn't reach the
      // connected state silently.
      const info = await this.api.getBotInfo();
      if (info.userId && info.userId !== this.applicationId) {
        throw new Error(
          `Channel access token resolves to bot ${info.userId}, ` +
            `but the configured destination userId is ${this.applicationId}`,
        );
      }

      await updateBotRuntimeStatus({
        applicationId: this.applicationId,
        platform: this.id,
        status: BOT_RUNTIME_STATUSES.connected,
      });

      log(
        'LineBot appId=%s ready (operator must wire webhook in LINE console)',
        this.applicationId,
      );
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
    log('Stopping LineBot appId=%s', this.applicationId);
    await updateBotRuntimeStatus({
      applicationId: this.applicationId,
      platform: this.id,
      status: BOT_RUNTIME_STATUSES.disconnected,
    });
  }

  // --- Runtime Operations ---

  createAdapter(): Record<string, any> {
    return {
      line: createLineAdapter({
        channelAccessToken: this.config.credentials.channelAccessToken,
        channelSecret: this.config.credentials.channelSecret,
        destinationUserId: this.applicationId,
      }),
    };
  }

  getMessenger(platformThreadId: string): PlatformMessenger {
    const { id: recipient, type } = decodeThread(platformThreadId);
    return {
      createMessage: async (content) => {
        await this.api.pushText(recipient, content);
      },
      // LINE does not support editing — `supportsMessageEdit: false` makes the
      // bridge skip the per-step progress edit, but we still implement this
      // path so any unexpected caller falls back to a fresh push.
      editMessage: async (_messageId, content) => {
        await this.api.pushText(recipient, content);
      },
      removeReaction: () => Promise.resolve(),
      triggerTyping: async () => {
        // LINE's loading animation API is only valid for 1:1 user chats.
        if (type !== 'user') return;
        try {
          await this.api.startLoading(recipient);
        } catch (err) {
          log('triggerTyping failed: %O', err);
        }
      },
    };
  }

  /**
   * Resolve attachments on an inbound LINE message. LINE sends only the
   * media `messageId` on the webhook — we have to call the data subdomain's
   * `/v2/bot/message/<id>/content` endpoint with the bearer header to get
   * the bytes. Done on demand to avoid wasted downloads in groups.
   *
   * Reads each attachment's own `raw` rather than `message.raw`: when the
   * bot router merges debounced/queued messages, attachments are concatenated
   * but `message.raw` holds only the latest event (which may now be text).
   */
  async extractFiles(message: Message): Promise<AttachmentSource[] | undefined> {
    const attachments = ((message as any).attachments ?? []) as Array<{ raw?: LineMessage }>;

    const candidates = attachments
      .map((attachment) => ({
        messageId: resolveMediaMessageId(attachment.raw),
        raw: attachment.raw,
      }))
      .filter((entry): entry is { messageId: string; raw: LineMessage } =>
        Boolean(entry.messageId && entry.raw),
      );

    if (candidates.length === 0) return undefined;

    log(
      'extractFiles: msgId=%s lineMsgIds=%o',
      (message as any).id,
      candidates.map((c) => c.messageId),
    );

    const results = await Promise.all(
      candidates.map(async ({ messageId, raw }): Promise<AttachmentSource | undefined> => {
        try {
          const buffer = await this.api.downloadContent(messageId);
          const meta = getMediaFileNameAndType(raw);
          return {
            buffer,
            mimeType: defaultMimeForType(meta.type),
            name: defaultNameForType(meta.type, meta.fileName),
            size: buffer.length,
          };
        } catch (err) {
          log('extractFiles: downloadContent failed for messageId=%s: %O', messageId, err);
          return undefined;
        }
      }),
    );

    const sources = results.filter((source): source is AttachmentSource => Boolean(source));
    return sources.length > 0 ? sources : undefined;
  }

  extractChatId(platformThreadId: string): string {
    return decodeThread(platformThreadId).id;
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

export class LineClientFactory extends ClientFactory {
  createClient(config: BotProviderConfig, context: BotPlatformRuntimeContext): PlatformClient {
    return new LineWebhookClient(config, context);
  }

  async validateCredentials(
    credentials: Record<string, string>,
    _settings?: Record<string, unknown>,
    applicationId?: string,
  ): Promise<ValidationResult> {
    const errors: Array<{ field: string; message: string }> = [];
    if (!credentials.channelAccessToken) {
      errors.push({ field: 'channelAccessToken', message: 'Channel Access Token is required' });
    }
    if (!credentials.channelSecret) {
      errors.push({ field: 'channelSecret', message: 'Channel Secret is required' });
    }
    if (!applicationId) {
      errors.push({ field: 'applicationId', message: 'Destination User ID is required' });
    }
    if (errors.length > 0) {
      return { errors, valid: false };
    }

    try {
      const api = new LineApiClient({ accessToken: credentials.channelAccessToken });
      const info = await api.getBotInfo();
      if (info.userId && info.userId !== applicationId) {
        return {
          errors: [
            {
              field: 'applicationId',
              message: `Channel access token belongs to bot ${info.userId}, not ${applicationId}`,
            },
          ],
          valid: false,
        };
      }
      return { valid: true };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to authenticate with LINE Messaging API';
      return {
        errors: [{ field: 'channelAccessToken', message }],
        valid: false,
      };
    }
  }
}
