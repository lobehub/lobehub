import {
  type BlueBubblesAttachment,
  type BlueBubblesOutboundAttachment,
  createImessageAdapter,
  resolveAttachmentGuid,
  resolveAttachmentName,
} from '@lobechat/chat-adapter-imessage';
import type { Message } from 'chat';
import debug from 'debug';
import pMap from 'p-map';

import type { AttachmentSource } from '@/server/services/aiAgent/ingestAttachment';
import {
  BOT_RUNTIME_STATUSES,
  getRuntimeStatusErrorMessage,
  updateBotRuntimeStatus,
} from '@/server/services/gateway/runtimeStatus';

import { stripMarkdown } from '../stripMarkdown';
import {
  type BotMessageAttachment,
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
import { ImessageDesktopBridgeApi } from './desktopBridge';

const log = debug('bot-platform:imessage:bot');

interface ImessageCredentials {
  desktopDeviceId: string;
  webhookSecret: string;
}

function resolveCredentials(credentials: Record<string, string>): ImessageCredentials {
  const desktopDeviceId = credentials.desktopDeviceId?.trim();
  const webhookSecret = credentials.webhookSecret?.trim();

  if (!desktopDeviceId) throw new Error('Desktop Device ID is required');
  if (!webhookSecret) throw new Error('Webhook Secret is required');

  return { desktopDeviceId, webhookSecret };
}

function decodeThread(platformThreadId: string): string {
  return platformThreadId.startsWith('imessage:')
    ? platformThreadId.slice('imessage:'.length)
    : platformThreadId;
}

function toBlueBubblesAttachment(attachment: BotMessageAttachment): BlueBubblesOutboundAttachment {
  return {
    data: attachment.data,
    fetchUrl: attachment.fetchUrl,
    mimeType: attachment.mimeType,
    name: attachment.name,
  };
}

class ImessageWebhookClient implements PlatformClient {
  readonly id = 'imessage';
  readonly applicationId: string;

  private bridge: ImessageDesktopBridgeApi;
  private config: BotProviderConfig;
  private credentials: ImessageCredentials;

  constructor(config: BotProviderConfig, context: BotPlatformRuntimeContext) {
    this.config = config;
    this.applicationId = config.applicationId;
    this.credentials = resolveCredentials(config.credentials);
    if (!context.userId?.trim()) {
      throw new Error('User ID is required for iMessage Desktop bridge');
    }
    this.bridge = new ImessageDesktopBridgeApi({
      applicationId: this.applicationId,
      deviceId: this.credentials.desktopDeviceId,
      userId: context.userId,
    });
  }

  async start(): Promise<void> {
    log(
      'Starting iMessage Desktop bridge appId=%s deviceId=%s',
      this.applicationId,
      this.credentials.desktopDeviceId,
    );
    await updateBotRuntimeStatus({
      applicationId: this.applicationId,
      platform: this.id,
      status: BOT_RUNTIME_STATUSES.starting,
    });

    try {
      await this.bridge.ping();

      await updateBotRuntimeStatus({
        applicationId: this.applicationId,
        platform: this.id,
        status: BOT_RUNTIME_STATUSES.connected,
      });

      log('iMessage Desktop bridge appId=%s ready', this.applicationId);
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
    log('Stopping iMessage appId=%s', this.applicationId);
    await updateBotRuntimeStatus({
      applicationId: this.applicationId,
      platform: this.id,
      status: BOT_RUNTIME_STATUSES.disconnected,
    });
  }

  createAdapter(): Record<string, any> {
    return {
      imessage: createImessageAdapter({
        botUserId: this.config.settings?.userId as string | undefined,
        transport: {
          getChat: this.bridge.getChat,
          getChatMessages: this.bridge.getChatMessages,
          sendText: this.bridge.sendText,
          startTyping: this.bridge.startTyping,
        },
        webhookSecret: this.credentials.webhookSecret,
      }),
    };
  }

  getMessenger(platformThreadId: string): PlatformMessenger {
    const chatGuid = decodeThread(platformThreadId);
    return {
      createMessage: async (content) => {
        const text = messengerContentText(content);
        const attachments = typeof content === 'string' ? undefined : content.attachments;

        if (text.trim()) {
          await this.bridge.sendText(chatGuid, text);
        }

        for (const attachment of attachments ?? []) {
          await this.bridge.sendAttachment(chatGuid, toBlueBubblesAttachment(attachment));
        }
      },
      editMessage: async (_messageId, content) => {
        await this.getMessenger(platformThreadId).createMessage(content);
      },
      removeReaction: () => Promise.resolve(),
      triggerTyping: async () => {
        try {
          await this.bridge.startTyping(chatGuid);
        } catch (error) {
          log('triggerTyping failed: %O', error);
        }
      },
    };
  }

  async extractFiles(message: Message): Promise<AttachmentSource[] | undefined> {
    const attachments = ((message as any).attachments ?? []) as Array<{
      raw?: BlueBubblesAttachment;
    }>;
    const candidates = attachments
      .map((attachment) => ({
        guid: resolveAttachmentGuid(attachment.raw),
        raw: attachment.raw,
      }))
      .filter((entry): entry is { guid: string; raw: BlueBubblesAttachment } =>
        Boolean(entry.guid && entry.raw),
      );

    if (candidates.length === 0) return undefined;

    const results = await pMap(
      candidates,
      async ({ guid, raw }): Promise<AttachmentSource | undefined> => {
        try {
          const downloaded = await this.bridge.downloadAttachment(guid);
          return {
            buffer: downloaded.buffer,
            mimeType: downloaded.mimeType ?? raw.mimeType ?? 'application/octet-stream',
            name: resolveAttachmentName(raw),
            size: downloaded.buffer.length,
          };
        } catch (error) {
          log('extractFiles: downloadAttachment failed for guid=%s: %O', guid, error);
          return undefined;
        }
      },
      { concurrency: 5 },
    );

    const sources = results.filter((source): source is AttachmentSource => Boolean(source));
    return sources.length > 0 ? sources : undefined;
  }

  extractChatId(platformThreadId: string): string {
    return decodeThread(platformThreadId);
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

export class ImessageClientFactory extends ClientFactory {
  createClient(config: BotProviderConfig, context: BotPlatformRuntimeContext): PlatformClient {
    return new ImessageWebhookClient(config, context);
  }

  async validateCredentials(
    credentials: Record<string, string>,
    _settings?: Record<string, unknown>,
    applicationId?: string,
  ): Promise<ValidationResult> {
    const errors: Array<{ field: string; message: string }> = [];
    if (!credentials.desktopDeviceId?.trim()) {
      errors.push({ field: 'desktopDeviceId', message: 'Desktop Device ID is required' });
    }
    if (!credentials.webhookSecret?.trim()) {
      errors.push({ field: 'webhookSecret', message: 'Webhook Secret is required' });
    }
    if (!applicationId?.trim()) {
      errors.push({ field: 'applicationId', message: 'Application ID is required' });
    }
    if (errors.length > 0) return { errors, valid: false };

    return { valid: true };
  }
}

export const imessageTestInternals = {
  decodeThread,
};
