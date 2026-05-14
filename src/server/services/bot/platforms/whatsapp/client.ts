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
import { createWhatsAppAdapter, getMediaNameAndType, resolveMediaId } from './adapter';
import { WhatsAppApi } from './api';
import type { WhatsAppMessage } from './types';

const log = debug('bot-platform:whatsapp:bot');

function extractChatId(platformThreadId: string): string {
  const parts = platformThreadId.split(':');
  return parts.length >= 3 && parts[0] === 'whatsapp' ? parts.slice(2).join(':') : platformThreadId;
}

function getGraphApiVersion(settings: Record<string, unknown> | undefined): string | undefined {
  const raw = settings?.graphApiVersion;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;
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
      return 'audio/ogg';
    }
    case 'sticker': {
      return 'image/webp';
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
      return 'audio.ogg';
    }
    case 'sticker': {
      return 'sticker.webp';
    }
    default: {
      return 'file.bin';
    }
  }
}

class WhatsAppWebhookClient implements PlatformClient {
  readonly id = 'whatsapp';
  readonly applicationId: string;

  private api: WhatsAppApi;
  private config: BotProviderConfig;
  private context: BotPlatformRuntimeContext;

  constructor(config: BotProviderConfig, context: BotPlatformRuntimeContext) {
    this.config = config;
    this.context = context;
    this.applicationId = config.applicationId;
    this.api = new WhatsAppApi({
      accessToken: config.credentials.accessToken,
      graphApiVersion: getGraphApiVersion(config.settings),
      phoneNumberId: this.applicationId,
    });
  }

  async start(): Promise<void> {
    log('Starting WhatsAppBot phoneNumberId=%s', this.applicationId);
    await updateBotRuntimeStatus({
      applicationId: this.applicationId,
      platform: this.id,
      status: BOT_RUNTIME_STATUSES.starting,
    });

    try {
      await this.api.getPhoneNumberInfo();
      await updateBotRuntimeStatus({
        applicationId: this.applicationId,
        platform: this.id,
        status: BOT_RUNTIME_STATUSES.connected,
      });
      log('WhatsAppBot phoneNumberId=%s ready', this.applicationId);
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
    log('Stopping WhatsAppBot phoneNumberId=%s', this.applicationId);
    await updateBotRuntimeStatus({
      applicationId: this.applicationId,
      platform: this.id,
      status: BOT_RUNTIME_STATUSES.disconnected,
    });
  }

  createAdapter(): Record<string, any> {
    return {
      whatsapp: createWhatsAppAdapter({
        accessToken: this.config.credentials.accessToken,
        appSecret: this.config.credentials.appSecret,
        graphApiVersion: getGraphApiVersion(this.config.settings),
        phoneNumberId: this.applicationId,
        verifyToken: this.config.credentials.verifyToken,
      }),
    };
  }

  getMessenger(platformThreadId: string): PlatformMessenger {
    const recipient = extractChatId(platformThreadId);
    return {
      createMessage: async (content) => {
        await this.api.sendText(recipient, content);
      },
      editMessage: async (_messageId, content) => {
        await this.api.sendText(recipient, content);
      },
      removeReaction: () => Promise.resolve(),
    };
  }

  async extractFiles(message: Message): Promise<AttachmentSource[] | undefined> {
    const attachments = ((message as any).attachments ?? []) as Array<{ raw?: WhatsAppMessage }>;
    const candidates = attachments
      .map((attachment) => ({
        mediaId: resolveMediaId(attachment.raw),
        raw: attachment.raw,
      }))
      .filter((entry): entry is { mediaId: string; raw: WhatsAppMessage } =>
        Boolean(entry.mediaId && entry.raw),
      );

    if (candidates.length === 0) return undefined;

    const results = await Promise.all(
      candidates.map(async ({ mediaId, raw }): Promise<AttachmentSource | undefined> => {
        try {
          const media = await this.api.downloadMedia(mediaId);
          const metadata = getMediaNameAndType(raw);
          return {
            buffer: media.buffer,
            mimeType: media.mimeType ?? metadata.mimeType ?? defaultMimeForType(metadata.type),
            name: defaultNameForType(metadata.type, metadata.fileName),
            size: media.size ?? media.buffer.length,
          };
        } catch (err) {
          log('extractFiles: downloadMedia failed for mediaId=%s: %O', mediaId, err);
          return undefined;
        }
      }),
    );

    const sources = results.filter((source): source is AttachmentSource => Boolean(source));
    return sources.length > 0 ? sources : undefined;
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

export class WhatsAppClientFactory extends ClientFactory {
  createClient(config: BotProviderConfig, context: BotPlatformRuntimeContext): PlatformClient {
    return new WhatsAppWebhookClient(config, context);
  }

  async validateCredentials(
    credentials: Record<string, string>,
    settings?: Record<string, unknown>,
    applicationId?: string,
  ): Promise<ValidationResult> {
    const errors: Array<{ field: string; message: string }> = [];
    if (!applicationId) {
      errors.push({ field: 'applicationId', message: 'Phone Number ID is required' });
    }
    if (!credentials.accessToken) {
      errors.push({ field: 'accessToken', message: 'Access Token is required' });
    }
    if (!credentials.appSecret) {
      errors.push({ field: 'appSecret', message: 'App Secret is required' });
    }
    if (!credentials.verifyToken) {
      errors.push({ field: 'verifyToken', message: 'Verify Token is required' });
    }
    if (errors.length > 0) return { errors, valid: false };

    try {
      const api = new WhatsAppApi({
        accessToken: credentials.accessToken,
        graphApiVersion: getGraphApiVersion(settings),
        phoneNumberId: applicationId!,
      });
      const info = await api.getPhoneNumberInfo();
      if (info.id && info.id !== applicationId) {
        return {
          errors: [
            {
              field: 'applicationId',
              message: `Access token resolved phone number ${info.id}, not ${applicationId}`,
            },
          ],
          valid: false,
        };
      }
      return { valid: true };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to authenticate with WhatsApp Cloud API';
      return {
        errors: [{ field: 'accessToken', message }],
        valid: false,
      };
    }
  }
}
