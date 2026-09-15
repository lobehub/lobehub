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
  messengerContentText,
  type PlatformClient,
  type PlatformMessenger,
  type UsageStats,
  type ValidationResult,
} from '../types';
import { formatUsageStats } from '../utils';
import { TELEGRAM_API_BASE, TelegramApi, TelegramEditUnavailableError } from './api';
import {
  claimTelegramDraftCompletion,
  clearTelegramDraftSession,
  completeTelegramDraftSession,
  markTelegramDraftDelivered,
  releaseTelegramDraftCompletion,
  renewTelegramDraftCompletion,
  saveTelegramDraftSession,
  setTelegramDraftOperation,
  updateActiveTelegramDraftSession,
} from './draftSession';
import { createLobeTelegramAdapter } from './guestAdapter';
import { deliverGuestCreate, deliverGuestEdit } from './guestOutbound';
import { extractBotId, resolveTelegramSecretToken, setTelegramWebhook } from './helpers';
import { sanitizeTelegramRichMarkdown } from './richMessage';
import { sendTelegramRichReply } from './sendRichReply';
import { isGuestTelegramThreadId, parseTelegramThreadId } from './threadId';

const log = debug('bot-platform:telegram:bot');

/**
 * Telegram Bot API getFile limit.
 * Files larger than this cannot be downloaded via the Bot API.
 * @see https://core.telegram.org/bots/api#getfile
 */
const TELEGRAM_MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB

function extractChatId(platformThreadId: string): string {
  return parseTelegramThreadId(platformThreadId).chatId;
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

interface TelegramMediaHint {
  mimeType?: string;
  name?: string;
  size?: number;
  type?: string;
}

/**
 * Recover photo/video/audio/document hints from a raw Telegram Message
 * payload. Used for `reply_to_message`, which Chat SDK does not copy onto
 * `message.attachments`.
 */
const mediaHintsFromTelegramPayload = (
  raw: Record<string, any> | undefined,
): TelegramMediaHint[] => {
  if (!raw) return [];
  const hints: TelegramMediaHint[] = [];

  if (Array.isArray(raw.photo) && raw.photo.length > 0) {
    const largest = raw.photo.at(-1) as { file_size?: number } | undefined;
    hints.push({ size: largest?.file_size, type: 'image' });
  }

  const pushFile = (
    payload: { file_name?: string; file_size?: number; mime_type?: string } | undefined,
    type: string,
  ) => {
    if (!payload) return;
    hints.push({
      mimeType: payload.mime_type,
      name: payload.file_name,
      size: payload.file_size,
      type,
    });
  };

  pushFile(raw.video ?? raw.video_note, 'video');
  pushFile(raw.audio ?? raw.voice, 'audio');
  pushFile(raw.document, 'file');

  return hints;
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
      const webhookUrl = await this.registerWebhook();

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

  /**
   * Re-register the webhook with Telegram using the current credentials.
   *
   * Called by `BotMessageRouter` when an inbound update was rejected as
   * unverified (401): that means Telegram is still delivering to a webhook
   * registered without (or with a stale) `secret_token` — e.g. a bot created
   * before verification became mandatory. Re-running `setWebhook` with the
   * resolved secret makes Telegram's retry of the rejected update carry the
   * right header, so the bot heals without operator action.
   */
  async reconcileWebhook(): Promise<void> {
    const webhookUrl = await this.registerWebhook();
    log('TelegramBot appId=%s webhook re-registered, webhook=%s', this.applicationId, webhookUrl);
  }

  private async registerWebhook(): Promise<string> {
    const baseUrl = (this.config.credentials.webhookProxyUrl || this.context.appUrl || '')
      .trim()
      .replace(/\/$/, '');
    const webhookUrl = `${baseUrl}/api/agent/webhooks/telegram/${this.applicationId}`;
    await setTelegramWebhook(
      this.config.credentials.botToken,
      webhookUrl,
      resolveTelegramSecretToken(this.config.credentials),
    );
    return webhookUrl;
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
      telegram: createLobeTelegramAdapter(
        {
          botToken: this.config.credentials.botToken,
          // Always verified: the operator's secret when set, otherwise the same
          // derived secret `start()` registered with Telegram. We never pass
          // `allowUnverifiedWebhooks` — see `resolveTelegramSecretToken`.
          secretToken: resolveTelegramSecretToken(this.config.credentials),
        },
        this.applicationId,
      ),
    };
  }

  getMessenger(platformThreadId: string): PlatformMessenger {
    const telegram = new TelegramApi(this.config.credentials.botToken);
    if (isGuestTelegramThreadId(platformThreadId)) {
      return {
        addReaction: async () => {},
        createMessage: async (content) => {
          await deliverGuestCreate(telegram, this.applicationId, platformThreadId, content);
        },
        editMessage: async (messageId, content) => {
          await deliverGuestEdit(
            telegram,
            this.applicationId,
            platformThreadId,
            messageId,
            content,
          );
        },
        // No `triggerTyping` here, on purpose. AgentBridgeService treats a
        // present `triggerTyping` as "platform can show typing" and, when the
        // message gateway is enabled, skips the initial placeholder post.
        // Guest summons are one-shot `guest_query_id`s that must be answered
        // quickly - deferring the first `createMessage` to agent completion
        // risks blowing Telegram's guest-query response window. Leaving
        // `triggerTyping` undefined forces the bridge to post the placeholder
        // immediately, which consumes the query via `answerGuestQuery`.
        removeReaction: async () => {},
        replaceReaction: async () => {},
      };
    }

    const parsedThread = parseTelegramThreadId(platformThreadId);
    const chatId = parsedThread.chatId;
    const isPrivateChat = Number(chatId) > 0;
    const messenger: PlatformMessenger = {
      addReaction: (messageId, emoji) =>
        telegram.setMessageReaction(chatId, parseTelegramMessageId(messageId), emoji),
      createMessage: async (content) => {
        const text = messengerContentText(content);
        const attachments = typeof content === 'string' ? undefined : content.attachments;
        await sendTelegramRichReply(telegram, {
          attachments,
          chatId,
          messageThreadId: parsedThread.messageThreadId,
          text,
        });
      },
      // editMessage keeps the text-only contract. Telegram doesn't support
      // converting a text message into a media message — new chunks with
      // attachments flow through createMessage instead.
      editMessage: async (messageId, content) => {
        const text = messengerContentText(content);
        try {
          await telegram.editRichMessageText({
            chatId,
            messageId: parseTelegramMessageId(messageId),
            richMessage: { markdown: sanitizeTelegramRichMarkdown(text) },
          });
        } catch (error) {
          if (!(error instanceof TelegramEditUnavailableError)) throw error;
          await sendTelegramRichReply(telegram, {
            chatId,
            messageThreadId: parsedThread.messageThreadId,
            text,
          });
        }
      },
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
    if (isPrivateChat) {
      const sendDraft = (draftId: number, markdown: string) =>
        telegram.sendRichMessageDraft({
          canStop: true,
          chatId,
          draftId,
          messageThreadId: parsedThread.messageThreadId,
          richMessage: { markdown },
        });

      messenger.claimDraftCompletion = (draftId) =>
        claimTelegramDraftCompletion(this.applicationId, platformThreadId, Number(draftId));
      messenger.renewDraftCompletion = (draftId, owner) =>
        renewTelegramDraftCompletion(this.applicationId, platformThreadId, Number(draftId), owner);
      messenger.createDraft = async (content, context) => {
        const draftId = Math.floor(Math.random() * 2_147_483_646) + 1;
        const richMessage = { markdown: sanitizeTelegramRichMarkdown(content) };
        const saved = await saveTelegramDraftSession(
          {
            applicationId: this.applicationId,
            content: richMessage.markdown,
            draftId,
            platformThreadId,
            userId: context.userId,
            workspaceId: context.workspaceId,
          },
          context.durable,
        );
        if (!saved) throw new Error('Durable Telegram draft storage is unavailable');
        try {
          await sendDraft(draftId, richMessage.markdown);
        } catch (error) {
          await clearTelegramDraftSession(this.applicationId, platformThreadId, draftId);
          throw error;
        }
        return String(draftId);
      };
      messenger.updateDraft = async (draftId, content) => {
        const numericDraftId = Number(draftId);
        const markdown = sanitizeTelegramRichMarkdown(content);
        await updateActiveTelegramDraftSession(
          this.applicationId,
          platformThreadId,
          numericDraftId,
          async () => {
            await sendDraft(numericDraftId, markdown);
            return markdown;
          },
        );
      };
      messenger.renewDraft = async (draftId) => {
        const numericDraftId = Number(draftId);
        await updateActiveTelegramDraftSession(
          this.applicationId,
          platformThreadId,
          numericDraftId,
          async (session) => {
            await sendDraft(numericDraftId, session.content);
          },
        );
      };
      messenger.setDraftOperation = (draftId, operationId) =>
        setTelegramDraftOperation(
          this.applicationId,
          platformThreadId,
          Number(draftId),
          operationId,
        );
      messenger.clearDraft = (draftId, owner) =>
        completeTelegramDraftSession(this.applicationId, platformThreadId, Number(draftId), owner);
      messenger.markDraftDelivered = (draftId, owner) =>
        markTelegramDraftDelivered(this.applicationId, platformThreadId, Number(draftId), owner);
      messenger.releaseDraftCompletion = (draftId, owner) =>
        releaseTelegramDraftCompletion(
          this.applicationId,
          platformThreadId,
          Number(draftId),
          owner,
        );
    }
    return messenger;
  }

  extractChatId(platformThreadId: string): string {
    return extractChatId(platformThreadId);
  }

  /**
   * Telegram exposes the sender's preferred UI language on every inbound
   * message via `from.language_code`. Values are IETF-ish (`en`, `zh-hans`,
   * `pt-br`, …) so the caller normalizes them against the project locale set.
   * Returns `undefined` for service messages or anonymous senders that omit
   * the field.
   */
  extractAuthorLocale(message: Message): string | undefined {
    const raw = (message as any).raw as Record<string, any> | undefined;
    const code = raw?.from?.language_code;
    return typeof code === 'string' && code.length > 0 ? code : undefined;
  }

  async registerBotCommands(
    commands: Array<{
      command: string;
      description: string;
      // Telegram setMyCommands has no options schema (users type free-form
      // text after the command); the field is accepted for interface
      // parity with platforms that need it (Discord) and ignored here.
      options?: Array<{ description: string; name: string; required?: boolean }>;
    }>,
  ): Promise<void> {
    const telegram = new TelegramApi(this.config.credentials.botToken);
    await telegram.setMyCommands(
      commands.map((c) => ({ command: c.command, description: c.description })),
    );
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
   * Quoted media lives on `raw.reply_to_message` (Guest Mode summons and
   * ordinary replies). Chat SDK only lists attachments on the triggering
   * message, so we recover photo/video/audio/document from that nested
   * payload the same way Discord recovers `referenced_message.attachments`.
   *
   * Per-attachment errors are swallowed and logged so a single failed
   * download doesn't drop the rest of the message's attachments.
   */
  async extractFiles(message: Message): Promise<ExtractFilesResult | undefined> {
    const directAttachments = (message as any).attachments as TelegramMediaHint[] | undefined;
    const raw = (message as any).raw as Record<string, any> | undefined;
    const replyRaw = raw?.reply_to_message as Record<string, any> | undefined;
    const referenced = mediaHintsFromTelegramPayload(replyRaw);

    log(
      'extractFiles: msgId=%s, direct=%d, referenced=%d',
      (message as any).id,
      directAttachments?.length ?? 0,
      referenced.length,
    );

    if (!directAttachments?.length && referenced.length === 0) return undefined;

    const telegram = new TelegramApi(this.config.credentials.botToken);
    const results: AttachmentSource[] = [];
    const warnings: string[] = [];

    const download = async (
      att: TelegramMediaHint,
      sourceRaw: Record<string, any> | undefined,
    ): Promise<void> => {
      const fileId = TelegramWebhookClient.resolveTelegramFileId(sourceRaw, att.type);
      if (!fileId) {
        log('extractFiles: no file_id for type=%s in raw payload (skipping)', att.type);
        return;
      }

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
        return;
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
    };

    for (const att of directAttachments ?? []) {
      await download(att, raw);
    }
    for (const att of referenced) {
      await download(att, replyRaw);
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
        return raw.video?.file_id ?? raw.video_note?.file_id;
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

  formatReply(body: string, stats?: UsageStats): string {
    if (!stats || !this.config.settings?.showUsageStats) return body;
    return `${body}\n\n${formatUsageStats(stats)}`;
  }

  parseMessageId(compositeId: string): number {
    return parseTelegramMessageId(compositeId);
  }

  shouldSubscribe(threadId: string): boolean {
    return !isGuestTelegramThreadId(threadId);
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
