import { createTelegramAdapter } from '@chat-adapter/telegram';
import type { Message } from 'chat';
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
  type ExtractFilesResult,
  type PlatformClient,
  type PlatformMessenger,
  type UsageStats,
  type ValidationResult,
} from '../types';
import { formatUsageStats } from '../utils';
import { TELEGRAM_API_BASE, TelegramApi } from './api';
import { extractBotId, setTelegramWebhook } from './helpers';
import { markdownToTelegramHTML } from './markdownToHTML';

const log = debug('bot-platform:telegram:bot');

/**
 * Telegram Bot API getFile limit.
 * Files larger than this cannot be downloaded via the Bot API.
 * @see https://core.telegram.org/bots/api#getfile
 */
const TELEGRAM_MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB

function extractChatId(platformThreadId: string): string {
  return platformThreadId.split(':')[1];
}

function parseTelegramMessageId(compositeId: string): number {
  const colonIdx = compositeId.lastIndexOf(':');
  return colonIdx !== -1 ? Number(compositeId.slice(colonIdx + 1)) : Number(compositeId);
}

/**
 * Default mime / name when the chat-adapter didn't fill them in. Telegram's
 * Bot API does not return `mime_type` or `file_name` for `photo` payloads
 * (photos are always JPEG by spec), so we have to backfill from `att.type`.
 * Other media (video / audio / document) usually carry their own mime/name,
 * but we still provide defaults so the LLM gets a recognizable filename.
 */
const defaultMimeForType = (type: string | undefined): string => {
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
    default: {
      return 'application/octet-stream';
    }
  }
};

const defaultNameForType = (type: string | undefined): string => {
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
    default: {
      return 'file.bin';
    }
  }
};

class TelegramWebhookClient implements PlatformClient {
  readonly id = 'telegram';
  readonly applicationId: string;

  private config: BotProviderConfig;
  private context: BotPlatformRuntimeContext;

  constructor(config: BotProviderConfig, context: BotPlatformRuntimeContext) {
    this.config = config;
    this.context = context;
    this.applicationId = extractBotId(config.credentials.botToken);
  }

  // --- Lifecycle ---

  async start(): Promise<void> {
    log('Starting TelegramBot appId=%s', this.applicationId);
    await updateBotRuntimeStatus({
      applicationId: this.applicationId,
      platform: this.id,
      status: BOT_RUNTIME_STATUSES.starting,
    });

    try {
      const baseUrl = (this.config.credentials.webhookProxyUrl || this.context.appUrl || '')
        .trim()
        .replace(/\/$/, '');
      const webhookUrl = `${baseUrl}/api/agent/webhooks/telegram/${this.applicationId}`;
      await setTelegramWebhook(
        this.config.credentials.botToken,
        webhookUrl,
        this.config.credentials.secretToken || undefined,
      );

      await updateBotRuntimeStatus({
        applicationId: this.applicationId,
        platform: this.id,
        status: BOT_RUNTIME_STATUSES.connected,
      });

      log('TelegramBot appId=%s started, webhook=%s', this.applicationId, webhookUrl);
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
    log('Stopping TelegramBot appId=%s', this.applicationId);
    try {
      const response = await fetch(
        `${TELEGRAM_API_BASE}/bot${this.config.credentials.botToken}/deleteWebhook`,
        { method: 'POST' },
      );
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Failed to delete Telegram webhook: ${response.status} ${text}`);
      }
      log('TelegramBot appId=%s webhook deleted', this.applicationId);
    } catch (error) {
      log('Failed to delete webhook for appId=%s: %O', this.applicationId, error);
    } finally {
      await updateBotRuntimeStatus({
        applicationId: this.applicationId,
        platform: this.id,
        status: BOT_RUNTIME_STATUSES.disconnected,
      });
    }
  }

  // --- Runtime Operations ---

  createAdapter(): Record<string, any> {
    return {
      telegram: createTelegramAdapter({
        botToken: this.config.credentials.botToken,
        secretToken: this.config.credentials.secretToken || undefined,
      }),
    };
  }

  getMessenger(platformThreadId: string): PlatformMessenger {
    const telegram = new TelegramApi(this.config.credentials.botToken);
    const chatId = extractChatId(platformThreadId);
    return {
      addReaction: (messageId, emoji) =>
        telegram.setMessageReaction(chatId, parseTelegramMessageId(messageId), emoji),
      createMessage: (content) => telegram.sendMessage(chatId, content).then(() => {}),
      editMessage: (messageId, content) =>
        telegram.editMessageText(chatId, parseTelegramMessageId(messageId), content),
      removeReaction: (messageId) =>
        telegram.removeMessageReaction(chatId, parseTelegramMessageId(messageId)),
      // Telegram replaces the whole reaction list in one call — one API
      // request is both cheaper and flicker-free.
      replaceReaction: async (messageId, _prevEmoji, nextEmoji) => {
        const id = parseTelegramMessageId(messageId);
        if (nextEmoji) await telegram.setMessageReaction(chatId, id, nextEmoji);
        else await telegram.removeMessageReaction(chatId, id);
      },
      triggerTyping: () => telegram.sendChatAction(chatId, 'typing'),
    };
  }

  extractChatId(platformThreadId: string): string {
    return extractChatId(platformThreadId);
  }

  async registerBotCommands(
    commands: Array<{ command: string; description: string }>,
  ): Promise<void> {
    const telegram = new TelegramApi(this.config.credentials.botToken);
    await telegram.setMyCommands(commands);
    log('TelegramBot appId=%s registered %d commands', this.applicationId, commands.length);
  }

  /**
   * Resolve a Chat SDK `Message` into `AttachmentSource[]` by re-downloading
   * each media attachment via the Telegram Bot API.
   *
   * Why we always download from `file_id` instead of trusting the chat-adapter:
   * the chat-adapter sets `fetchData: () => downloadFile(fileId)` as a closure,
   * but `Message.toJSON` strips functions (and buffers) when the message is
   * enqueued into Redis for the debounce strategy. Telegram photos in
   * particular have neither `url` nor `buffer` to fall back on after a
   * round-trip, so we own the download path here.
   *
   * For each attachment we look up the original `file_id` in `message.raw`
   * (which IS preserved by `toJSON`), call `TelegramApi.downloadFile`, and
   * build an `AttachmentSource` with sensible mime/name defaults — Telegram's
   * Bot API does not return `mime_type` / `file_name` for `photo` payloads,
   * so we must provide them.
   *
   * Per-attachment errors are swallowed and logged so a single failed
   * download doesn't drop the rest of the message's attachments.
   */
  async extractFiles(message: Message): Promise<ExtractFilesResult | undefined> {
    const attachments = (message as any).attachments as
      | Array<{
          mimeType?: string;
          name?: string;
          size?: number;
          type?: string;
        }>
      | undefined;
    if (!attachments?.length) return undefined;

    const raw = (message as any).raw as Record<string, any> | undefined;
    log('extractFiles: msgId=%s, attachments=%d', (message as any).id, attachments.length);

    const telegram = new TelegramApi(this.config.credentials.botToken);
    const results: AttachmentSource[] = [];
    const warnings: string[] = [];

    for (const att of attachments) {
      const fileId = TelegramWebhookClient.resolveTelegramFileId(raw, att.type);
      if (!fileId) {
        log('extractFiles: no file_id for type=%s in raw payload (skipping)', att.type);
        continue;
      }

      // Check file size before attempting download (Telegram Bot API limit)
      if (att.size && att.size > TELEGRAM_MAX_FILE_SIZE) {
        const fileName = att.name ?? defaultNameForType(att.type);
        const sizeMB = (att.size / (1024 * 1024)).toFixed(1);
        log(
          'extractFiles: file too large for Telegram Bot API (%s MB > 20 MB), type=%s, fileId=%s',
          sizeMB,
          att.type,
          fileId,
        );
        warnings.push(
          `File "${fileName}" (${sizeMB} MB) exceeds Telegram's 20 MB download limit and could not be processed.`,
        );
        continue;
      }

      try {
        const buffer = await telegram.downloadFile(fileId);
        results.push({
          buffer,
          mimeType: att.mimeType ?? defaultMimeForType(att.type),
          name: att.name ?? defaultNameForType(att.type),
          size: att.size ?? buffer.length,
        });
        log(
          'extractFiles: downloaded type=%s fileId=%s, %d bytes',
          att.type,
          fileId,
          buffer.length,
        );
      } catch (error) {
        log('extractFiles: downloadFile failed for type=%s fileId=%s: %O', att.type, fileId, error);
      }
    }

    if (results.length === 0 && warnings.length === 0) return undefined;

    return {
      files: results.length > 0 ? results : undefined,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  static resolveTelegramFileId(
    raw: Record<string, any> | undefined,
    type: string | undefined,
  ): string | undefined {
    if (!raw) return undefined;
    switch (type) {
      case 'image': {
        // Telegram returns photos as an array of size variants — pick the largest.
        const photos = raw.photo;
        if (Array.isArray(photos) && photos.length > 0) {
          return photos.at(-1)?.file_id;
        }
        return undefined;
      }
      case 'video': {
        return raw.video?.file_id;
      }
      case 'audio': {
        return raw.audio?.file_id ?? raw.voice?.file_id;
      }
      case 'file': {
        return raw.document?.file_id;
      }
      default: {
        return undefined;
      }
    }
  }

  formatMarkdown(markdown: string): string {
    return markdownToTelegramHTML(markdown);
  }

  formatReply(body: string, stats?: UsageStats): string {
    if (!stats || !this.config.settings?.showUsageStats) return body;
    return `${body}\n\n${formatUsageStats(stats)}`;
  }

  parseMessageId(compositeId: string): number {
    return parseTelegramMessageId(compositeId);
  }
}

export class TelegramClientFactory extends ClientFactory {
  createClient(config: BotProviderConfig, context: BotPlatformRuntimeContext): PlatformClient {
    return new TelegramWebhookClient(config, context);
  }

  async validateCredentials(credentials: Record<string, string>): Promise<ValidationResult> {
    if (!credentials.botToken) {
      return { errors: [{ field: 'botToken', message: 'Bot Token is required' }], valid: false };
    }

    try {
      const res = await fetch(`${TELEGRAM_API_BASE}/bot${credentials.botToken}/getMe`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { valid: true };
    } catch {
      return {
        errors: [{ field: 'botToken', message: 'Failed to authenticate with Telegram API' }],
        valid: false,
      };
    }
  }
}
