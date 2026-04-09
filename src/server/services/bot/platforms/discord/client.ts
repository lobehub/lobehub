import type { DiscordAdapter } from '@chat-adapter/discord';
import { createDiscordAdapter } from '@chat-adapter/discord';
import type { Chat as ChatBot, Message } from 'chat';
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
  type PlatformClient,
  type PlatformMessenger,
  type UsageStats,
  type ValidationResult,
} from '../types';
import { formatUsageStats } from '../utils';
import { DiscordApi } from './api';
import { patchDiscordForwardedInteractions, patchDiscordThreadRecovery } from './patch';

const log = debug('bot-platform:discord:bot');

const CONNECTED_STATUS_TTL_BUFFER_MS = 60 * 1000;
const DEFAULT_DURATION_MS = 8 * 60 * 60 * 1000; // 8 hours

export interface GatewayListenerOptions {
  durationMs?: number;
  waitUntil?: (task: Promise<any>) => void;
}

function extractChannelId(platformThreadId: string): string {
  const parts = platformThreadId.split(':');
  return parts[3] || parts[2];
}

function isSubscribableThread(platformThreadId: string): boolean {
  const [, guildId, , discordThreadId] = platformThreadId.split(':');

  // Keep DM conversations multi-turn, but avoid subscribing to top-level guild channels.
  return guildId === '@me' || !!discordThreadId;
}

class DiscordGatewayClient implements PlatformClient {
  readonly id = 'discord';
  readonly applicationId: string;

  private abort = new AbortController();
  private bot: ChatBot<any> | null = null;
  private config: BotProviderConfig;
  private context: BotPlatformRuntimeContext;
  private discord: DiscordApi;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(config: BotProviderConfig, context: BotPlatformRuntimeContext) {
    this.config = config;
    this.context = context;
    this.applicationId = config.applicationId;
    this.discord = new DiscordApi(config.credentials.botToken);
  }

  // --- Lifecycle ---

  async start(options?: GatewayListenerOptions): Promise<void> {
    log('Starting DiscordBot appId=%s', this.applicationId);

    this.stopped = false;
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

      const adapter = createDiscordAdapter({
        applicationId: this.config.applicationId,
        botToken: this.config.credentials.botToken,
        publicKey: this.config.credentials.publicKey,
      });

      const { Chat, ConsoleLogger } = await import('chat');

      const chatConfig: any = {
        adapters: { discord: adapter },
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

      const discordAdapter = (bot as any).adapters.get('discord') as DiscordAdapter;
      const waitUntil = options?.waitUntil ?? ((task: Promise<any>) => task.catch(() => {}));

      const webhookUrl = `${(this.context.appUrl || '').trim()}/api/agent/webhooks/discord/${this.applicationId}`;

      await discordAdapter.startGatewayListener(
        { waitUntil },
        durationMs,
        this.abort.signal,
        webhookUrl,
      );

      if (!options) {
        this.refreshTimer = setTimeout(() => {
          if (this.abort.signal.aborted || this.stopped) return;

          log(
            'DiscordBot appId=%s duration elapsed (%dh), refreshing...',
            this.applicationId,
            durationMs / 3_600_000,
          );
          this.abort.abort();
          this.start().catch((err) => {
            log('Failed to refresh DiscordBot appId=%s: %O', this.applicationId, err);
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

      log('DiscordBot appId=%s started, webhookUrl=%s', this.applicationId, webhookUrl);
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
    log('Stopping DiscordBot appId=%s', this.applicationId);
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

  // --- Runtime Operations ---

  applyChatPatches(chatBot: ChatBot<any>): void {
    patchDiscordForwardedInteractions(chatBot);
    patchDiscordThreadRecovery(chatBot);
  }

  createAdapter(): Record<string, any> {
    return {
      discord: createDiscordAdapter({
        applicationId: this.config.applicationId,
        botToken: this.config.credentials.botToken,
        publicKey: this.config.credentials.publicKey,
      }),
    };
  }

  getMessenger(platformThreadId: string): PlatformMessenger {
    const channelId = extractChannelId(platformThreadId);
    return {
      createMessage: (content) => this.discord.createMessage(channelId, content).then(() => {}),
      editMessage: (messageId, content) => this.discord.editMessage(channelId, messageId, content),
      removeReaction: (messageId, emoji) =>
        this.discord.removeOwnReaction(channelId, messageId, emoji),
      triggerTyping: () => this.discord.triggerTyping(channelId),
      updateThreadName: (name) => {
        const threadId = platformThreadId.split(':')[3];
        return threadId ? this.discord.updateChannelName(threadId, name) : Promise.resolve();
      },
    };
  }

  /**
   * Resolve attachments on an inbound Discord message into `AttachmentSource[]`.
   *
   * Discord is the easiest case: attachments come with a public CDN URL
   * (`https://cdn.discordapp.com/...`) that requires no auth, and the URL
   * field IS preserved by `Message.toJSON`. So this method just walks the
   * surviving attachment metadata and forwards URLs to `ingestAttachment`,
   * which `fetch()`es them with no special handling.
   *
   * Discord ALSO has the `referenced_message.attachments` quirk: if a user
   * @-mentions the bot while replying to an earlier message that had
   * attachments, the chat-sdk only exposes the current message's
   * attachments. We dig into `message.raw.referenced_message.attachments`
   * to recover the quoted message's files. The Discord webhook payload
   * uses snake_case (`content_type`, `filename`), so we normalize them.
   */
  async extractFiles(message: Message): Promise<AttachmentSource[] | undefined> {
    type DiscordRefAttachment = {
      content_type?: string;
      filename?: string;
      size?: number;
      url?: string;
    };
    type DirectAttachment = {
      mimeType?: string;
      name?: string;
      size?: number;
      type?: string;
      url?: string;
    };

    const directAttachments = (message as any).attachments as DirectAttachment[] | undefined;
    const raw = (message as any).raw as Record<string, any> | undefined;
    const refAttachments = raw?.referenced_message?.attachments as
      | DiscordRefAttachment[]
      | undefined;

    log(
      'extractFiles: msgId=%s, direct=%d, referenced=%d',
      (message as any).id,
      directAttachments?.length ?? 0,
      refAttachments?.length ?? 0,
    );

    const results: AttachmentSource[] = [];

    // 1. Direct attachments on the current message
    for (const att of directAttachments ?? []) {
      if (!att.url) continue;
      results.push({
        mimeType: att.mimeType,
        name: att.name,
        size: att.size,
        url: att.url,
      });
    }

    // 2. Attachments from a quoted (referenced) message
    for (const att of refAttachments ?? []) {
      if (!att.url) continue;
      results.push({
        mimeType: att.content_type,
        name: att.filename,
        size: att.size,
        url: att.url,
      });
    }

    return results.length > 0 ? results : undefined;
  }

  extractChatId(platformThreadId: string): string {
    return extractChannelId(platformThreadId);
  }

  formatReply(body: string, stats?: UsageStats): string {
    if (!stats || !this.config.settings?.showUsageStats) return body;
    return `${body}\n\n-# ${formatUsageStats(stats)}`;
  }

  parseMessageId(compositeId: string): string {
    return compositeId;
  }

  /**
   * Discord thread-starter messages live in the parent channel, not the thread.
   * When the message ID matches the Discord thread segment, route the reaction
   * to the parent channel so the API call targets the correct channel.
   */
  resolveReactionThreadId(threadId: string, messageId: string): string {
    const parts = threadId.split(':');
    // Format: discord:guildId:channelId:discordThreadId
    if (parts.length === 4 && parts[3] === messageId) {
      return parts.slice(0, 3).join(':');
    }
    return threadId;
  }

  sanitizeUserInput(text: string): string {
    return text.replaceAll(new RegExp(`<@!?${this.applicationId}>\\s*`, 'g'), '').trim();
  }

  shouldSubscribe(threadId: string): boolean {
    return isSubscribableThread(threadId);
  }

  async registerBotCommands(
    commands: Array<{ command: string; description: string }>,
  ): Promise<void> {
    await this.discord.registerCommands(this.applicationId, commands);
    log('DiscordBot appId=%s registered %d commands', this.applicationId, commands.length);
  }
}

export class DiscordClientFactory extends ClientFactory {
  createClient(config: BotProviderConfig, context: BotPlatformRuntimeContext): PlatformClient {
    return new DiscordGatewayClient(config, context);
  }

  async validateCredentials(credentials: Record<string, string>): Promise<ValidationResult> {
    const errors: Array<{ field: string; message: string }> = [];

    if (!credentials.botToken) errors.push({ field: 'botToken', message: 'Bot Token is required' });
    if (!credentials.publicKey)
      errors.push({ field: 'publicKey', message: 'Public Key is required' });

    if (errors.length > 0) return { errors, valid: false };

    try {
      const res = await fetch('https://discord.com/api/v10/users/@me', {
        headers: { Authorization: `Bot ${credentials.botToken}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { valid: true };
    } catch {
      return {
        errors: [{ field: 'botToken', message: 'Failed to authenticate with Discord API' }],
        valid: false,
      };
    }
  }
}
