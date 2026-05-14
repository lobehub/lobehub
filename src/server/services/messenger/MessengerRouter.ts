import { createIoRedisState } from '@chat-adapter/state-ioredis';
import { INBOX_SESSION_ID } from '@lobechat/const';
import {
  Chat,
  ConsoleLogger,
  type Message,
  type MessageContext,
  type SlashCommandEvent,
} from 'chat';
import debug from 'debug';
import { and, desc, eq, ne, or } from 'drizzle-orm';

import type { MessengerPlatform } from '@/config/messenger';
import { getServerDB } from '@/database/core/db-adaptor';
import { MessengerAccountLinkModel } from '@/database/models/messengerAccountLink';
import type { MessengerAccountLinkItem } from '@/database/schemas';
import { agents } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';
import { AiAgentService } from '@/server/services/aiAgent';
import { AgentBridgeService } from '@/server/services/bot/AgentBridgeService';
import { buildBotContext } from '@/server/services/bot/buildBotContext';
import type { PlatformClient } from '@/server/services/bot/platforms';
import { renderInlineError } from '@/server/services/bot/replyTemplate';

import { getInstallationStore } from './installations';
import type { InstallationCredentials } from './installations/types';
import { messengerPlatformRegistry } from './platforms';
import type { AgentPickerEntry, InboundCallbackAction, MessengerPlatformBinder } from './types';

const log = debug('lobe-server:messenger:router');

interface RegisteredMessengerBot {
  binder: MessengerPlatformBinder;
  chatBot: Chat<any>;
  client: PlatformClient;
  /** Cached resolved credentials — null for global-bot platforms (Telegram). */
  creds: InstallationCredentials;
}

interface CommandMatch {
  args: string;
  name: string;
}

interface AgentSummary {
  id: string;
  title: string;
}

/**
 * Per-message context passed to every command handler. Mirrors
 * `BotMessageRouter`'s `CommandContext`: handlers stay platform-agnostic and
 * read whatever they need (`thread`, `link`, `binder`, …) off the context
 * rather than threading parameters through every entry point.
 *
 * `source` discriminates the dispatch path: `'text'` carries a chat-sdk
 * `thread` + `message` (commands like `/new` and `/stop` use these to drive
 * the runtime); `'slash'` is a native slash-command event without a thread.
 */
interface MessengerCommandContext {
  args: string;
  authorUserId: string;
  authorUserName?: string;
  binder: MessengerPlatformBinder;
  /** Conversation id for outbound replies. For slash invocations from a
   *  public channel this is the slash-invocation channel; for text it's the
   *  DM thread. */
  chatId: string;
  /** Discord slash command interaction handle. Present only when dispatched
   *  by `handleSlashCommand` on Discord — handlers that emit interactive UI
   *  (e.g. `/agents` picker) must complete the deferred interaction via the
   *  follow-up webhook, otherwise Discord shows "Thinking..." indefinitely
   *  and eventually flips to "The application did not respond". */
  interaction?: { applicationId: string; token: string };
  /** True when the command was invoked from a 1:1 DM. Commands that surface
   *  user-private UI (e.g. `/agents` picker) widen private replies into
   *  ephemerals when this is false so the channel doesn't see them. */
  isDM: boolean;
  link: MessengerAccountLinkItem | undefined;
  message?: Message;
  platform: MessengerPlatform;
  /** Platform-aware reply: ephemeral on Slack slash, DM on Discord slash,
   *  `binder.sendDmText` on text dispatch. */
  reply: (text: string) => Promise<void>;
  serverDB: LobeChatDatabase;
  source: 'text' | 'slash';
  tenantId: string;
  thread?: any;
}

interface MessengerCommand {
  description: string;
  handler: (ctx: MessengerCommandContext) => Promise<void>;
  name: string;
}

const HELP_TEXT = [
  'Commands:',
  '• /start — bind (or rebind) your LobeHub account',
  '• /agents — list your agents and switch the active one',
  '• /new — start a new conversation',
  '• /stop — stop the current execution',
].join('\n');

/**
 * Pull the Discord interaction id + token off a chat-sdk slash event so
 * handlers can complete the deferred interaction via the follow-up webhook.
 *
 * chat-adapter-discord exposes the raw Discord interaction object on
 * `event.raw` (see `chat` SlashCommandEvent: "Platform-specific raw payload"),
 * which carries `application_id` and `token`. Returns undefined for other
 * platforms or when the shape doesn't match (defensive — the patch only
 * fires for Discord today).
 */
const extractDiscordInteractionContext = (
  platform: MessengerPlatform,
  event: SlashCommandEvent,
): { applicationId: string; token: string } | undefined => {
  if (platform !== 'discord') return undefined;
  const raw = event.raw as { application_id?: unknown; token?: unknown } | null | undefined;
  if (!raw || typeof raw !== 'object') return undefined;
  if (typeof raw.application_id !== 'string' || typeof raw.token !== 'string') {
    return undefined;
  }
  return { applicationId: raw.application_id, token: raw.token };
};

/** Parse a leading `/cmd` (with optional args) out of a message. Returns null
 *  when the message isn't a command. Strips a trailing `@BotName` so commands
 *  invoked from group chats also match (Telegram appends the bot username). */
const parseCommand = (text: string | undefined): CommandMatch | null => {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return null;
  const match = trimmed.match(/^\/([a-z][\w-]*)(?:@\S+)?(?:\s(.*))?$/is);
  if (!match) return null;
  return { args: (match[2] ?? '').trim(), name: match[1].toLowerCase() };
};

/**
 * Re-pack a request body that was already drained by `req.text()` so we can
 * pass it on to chat-sdk / the binder. Original headers + URL preserved.
 */
const reconstructRequest = (req: Request, rawBody: string): Request =>
  new Request(req.url, {
    body: rawBody,
    // `Request.duplex` is required when supplying a body to `new Request` in
    // some runtimes; cast to avoid TS narrowing differences across DOM lib
    // versions.
    headers: req.headers,
    method: req.method,
  } as RequestInit);

/**
 * Routes inbound messages from the shared Messenger bots to the right
 * LobeHub user + agent.
 *
 * **Multi-tenant routing (PR2)**: per-tenant platforms (Slack today) keep
 * one Chat SDK instance per `installationKey` (e.g. `slack:T0123`). Global-
 * bot platforms (Telegram, future Discord) collapse to a single bot per
 * platform via the special `telegram:singleton` key.
 *
 * Account model: each `(LobeHub user, platform, tenant_id)` triple has at
 * most one row in `messenger_account_links`, so a single LobeHub user can
 * link into multiple Slack workspaces simultaneously without collisions.
 *
 * **Platform abstraction**: command logic and tap-action handling live in a
 * single platform-agnostic registry. Per-platform differences (private
 * interaction reply mechanism, webhook-time vs chat-sdk-delivered actions)
 * are hidden behind optional `MessengerPlatformBinder` fields
 * (`replyPrivately`, `extractActionFromEvent`, `acknowledgeCallback`).
 * Adding a new platform is a binder-only change — the router does not
 * branch on `platform === 'foo'`.
 */
export class MessengerRouter {
  private bots = new Map<string, RegisteredMessengerBot>();
  private loadingPromises = new Map<string, Promise<RegisteredMessengerBot | null>>();

  /** Static command registry — reused across every install since command
   *  logic is platform-agnostic. Handlers reach platform-specific reply
   *  surfaces through `ctx.reply` and `ctx.binder`. */
  private readonly commands: MessengerCommand[] = this.buildCommands();

  /**
   * Webhook handler for `/api/agent/messenger/webhooks/[platform]`. The flow:
   *
   *   1. Read the raw body (must happen before any parsing — Slack's signature
   *      is over the exact bytes Slack sent)
   *   2. Slack: verify the signing secret, short-circuit `url_verification`
   *      and `app_uninstalled` / `tokens_revoked`
   *   3. Resolve the install via the platform's `MessengerInstallationStore`
   *      (Slack: DB lookup by `team_id` / `enterprise_id`; Telegram: env
   *      singleton)
   *   4. Lazy-load (and cache) a Chat SDK bot for that install
   *   5. Run `binder.extractCallbackAction` to intercept tap-action callbacks
   *      that chat-sdk doesn't surface
   *   6. Otherwise hand the (reconstructed) request to chat-sdk's webhook handler
   */
  getWebhookHandler(platform: string): (req: Request) => Promise<Response> {
    return async (req: Request) => {
      const definition = messengerPlatformRegistry.getPlatform(platform);
      if (!definition) {
        return new Response(`Unknown messenger platform: ${platform}`, { status: 404 });
      }

      const rawBody = await req.text();

      // ----- Per-platform gate (signature verification, setup challenges,
      //       lifecycle events). Returning a Response short-circuits the
      //       shared flow; null means continue.
      if (definition.webhookGate) {
        const early = await definition.webhookGate.preprocess(req, rawBody, {
          invalidateBot: (key) => this.bots.delete(key),
        });
        if (early) return early;
      }

      // ----- Resolve install + lazy-load bot -------------------------------
      const store = getInstallationStore(definition.id);
      if (!store) {
        return new Response(`Messenger ${platform} has no installation store`, { status: 500 });
      }

      const creds = await store.resolveByPayload(reconstructRequest(req, rawBody), rawBody);
      if (!creds) {
        log('webhook: no install resolved for platform=%s', platform);
        return new Response('install not found', { status: 404 });
      }

      const bot = await this.getOrCreateBot(creds);
      if (!bot) {
        return new Response(`Messenger ${platform} bot unavailable`, { status: 503 });
      }

      // ----- Tap-action callbacks (binder peeks raw body) -----------------
      if (bot.binder.extractCallbackAction) {
        try {
          const action = await bot.binder.extractCallbackAction(reconstructRequest(req, rawBody));
          if (action) {
            await this.handleCallbackAction(bot.binder, creds, action);
            return new Response('OK', { status: 200 });
          }
        } catch (error) {
          log('extractCallbackAction failed for %s: %O', platform, error);
        }
      }

      // ----- Normal message → chat-sdk handler ----------------------------
      const handler = (bot.chatBot.webhooks as any)?.[platform];
      if (!handler) {
        return new Response(`Messenger ${platform} webhook unavailable`, { status: 500 });
      }
      return handler(reconstructRequest(req, rawBody));
    };
  }

  // -------------------------------------------------------------------------

  private async getOrCreateBot(
    creds: InstallationCredentials,
  ): Promise<RegisteredMessengerBot | null> {
    const key = creds.installationKey;
    const existing = this.bots.get(key);
    if (existing) return existing;

    const inflight = this.loadingPromises.get(key);
    if (inflight) return inflight;

    const promise = this.loadBot(creds);
    this.loadingPromises.set(key, promise);

    try {
      return await promise;
    } finally {
      this.loadingPromises.delete(key);
    }
  }

  private async loadBot(creds: InstallationCredentials): Promise<RegisteredMessengerBot | null> {
    const binder = messengerPlatformRegistry.createBinder(creds);
    if (!binder) {
      log('loadBot: no binder available for %s', creds.installationKey);
      return null;
    }

    const client = await binder.createClient();
    if (!client) {
      log('loadBot: binder %s returned no client', creds.installationKey);
      return null;
    }

    const adapters = client.createAdapter();
    const chatBot = this.createChatBot(adapters, creds);

    // Apply platform-specific chat-sdk patches (Discord forwarded interaction
    // ack, Discord thread recovery, etc.) so the messenger Chat handles
    // gateway-forwarded events the same way the per-agent BotMessageRouter does.
    client.applyChatPatches?.(chatBot);

    const serverDB = await getServerDB();
    this.registerHandlers(chatBot, serverDB, client, binder, creds);

    await chatBot.initialize();

    if (client.registerBotCommands) {
      client
        .registerBotCommands(
          this.commands.map((cmd) => ({ command: cmd.name, description: cmd.description })),
        )
        .catch((error) =>
          log('registerBotCommands failed for %s: %O', creds.installationKey, error),
        );
    }

    const registered: RegisteredMessengerBot = { binder, chatBot, client, creds };
    this.bots.set(creds.installationKey, registered);

    log('loadBot: registered messenger %s bot', creds.installationKey);
    return registered;
  }

  private createChatBot(adapters: Record<string, any>, creds: InstallationCredentials): Chat<any> {
    const config: any = {
      adapters,
      concurrency: 'queue',
      // Per-install Chat SDK identity so the queue / state / debounce keys
      // never overlap across workspaces.
      userName: `messenger-bot-${creds.installationKey}`,
    };

    const redisClient = getAgentRuntimeRedisClient();
    if (redisClient) {
      config.state = createIoRedisState({
        client: redisClient,
        // Per-install key prefix → Redis state isolation per workspace.
        keyPrefix: `chat-sdk:messenger-${creds.installationKey}`,
        logger: new ConsoleLogger(),
      });
    }

    return new Chat(config);
  }

  private registerHandlers(
    bot: Chat<any>,
    serverDB: LobeChatDatabase,
    client: PlatformClient,
    binder: MessengerPlatformBinder,
    creds: InstallationCredentials,
  ): void {
    const platform = creds.platform;
    const tenantId = creds.tenantId;

    const handle = async (
      thread: any,
      message: Message,
      bridgeMethod: 'handleMention' | 'handleSubscribedMessage',
    ): Promise<void> => {
      if (message.author.isBot === true) return;

      const senderId = message.author.userId;
      if (!senderId) {
        log('handle: missing author.userId, dropping');
        return;
      }

      const chatId = client.extractChatId(thread.id);
      // Channel `@mention` (Slack today) — `thread.isDM` is false. The
      // unlinked path swaps to an ephemeral so the link prompt is visible
      // only to the mentioner; the no-active-agent prompt is also routed
      // ephemerally for the same reason. The chat-sdk thread.id carries
      // the platform's thread anchor (Slack: `slack:<channel>:<threadTs>`)
      // which the binder splits when posting in-thread.
      const isChannelMention = thread.isDM === false;
      const link = await MessengerAccountLinkModel.findByPlatformUser(
        serverDB,
        platform,
        senderId,
        tenantId,
      );

      try {
        const parsed = parseCommand(message.text);
        if (parsed) {
          const command = this.commands.find((c) => c.name === parsed.name);
          if (command) {
            // Text-path command reply: in a DM `chat.postMessage` is fine
            // (the conversation is private already). In a channel `@mention`
            // we must NOT broadcast — `/new`, `/stop`, `/start` etc. all
            // surface user-private state. Route the reply through
            // `replyEphemeral` so only the invoker sees it. Anchor in the
            // mention's thread (Slack `thread_ts`) so the response sits next
            // to the trigger. Platforms without `replyEphemeral` (Telegram)
            // fall back to the regular DM path.
            const channelThreadTs = isChannelMention ? String(thread.id).split(':')[2] : undefined;
            const reply =
              isChannelMention && binder.replyEphemeral
                ? (text: string) =>
                    binder.replyEphemeral!({
                      channelId: chatId,
                      text,
                      threadTs: channelThreadTs,
                      userId: senderId,
                    })
                : (text: string) => binder.sendDmText(chatId, text);
            await command.handler({
              args: parsed.args,
              authorUserId: senderId,
              authorUserName: message.author.userName,
              binder,
              chatId,
              isDM: !isChannelMention,
              link,
              message,
              platform,
              reply,
              serverDB,
              source: 'text',
              tenantId,
              thread,
            });
            return;
          }
          // Unknown slash text — pass through to the agent so legitimate
          // "/foo" prompts the user typed still reach them.
        }

        // Unbound sender → trigger link flow. For a channel mention pass
        // the raw thread.id so the binder can post the prompt as an
        // ephemeral anchored in the mention's thread instead of a public
        // DM-style message.
        if (!link) {
          await binder.handleUnlinkedMessage({
            authorUserId: senderId,
            authorUserName: message.author.userName,
            channelMentionThreadId: isChannelMention ? thread.id : undefined,
            chatId,
            message,
          });
          return;
        }

        // Bound but no active agent → prompt the user to pick one via /agents.
        // In a channel, route the prompt ephemerally so the entire channel
        // doesn't see the system message.
        if (!link.activeAgentId) {
          const noAgentText = 'No active agent selected. Send /agents to pick one.';
          if (isChannelMention && binder.replyEphemeral) {
            const threadTs = String(thread.id).split(':')[2];
            await binder.replyEphemeral({
              channelId: chatId,
              text: noAgentText,
              threadTs,
              userId: senderId,
            });
          } else {
            await binder.sendDmText(chatId, noAgentText);
          }
          return;
        }

        await this.dispatchToAgent(
          thread,
          message,
          client,
          link,
          link.activeAgentId,
          platform,
          bridgeMethod,
        );
      } catch (error) {
        log('handle: handler error: %O', error);
        try {
          await thread.post(renderInlineError('Something went wrong'));
        } catch {
          /* ignore */
        }
      }
    };

    // We intentionally do NOT register `onDirectMessage`. Chat SDK
    // short-circuits the DM dispatch when that handler is registered
    // (`chat` core: `dispatchToHandlers` fires DM handlers and returns
    // before the `isSubscribed` check), which kills the subscription-based
    // routing that lets follow-up messages reuse the cached topicId.
    //
    // Without an `onDirectMessage` handler, chat-sdk forces `isMention =
    // true` for DMs and falls through to the standard subscription dispatch
    // (mirrors `BotMessageRouter`, which doesn't register `onDirectMessage`
    // either):
    //   - First DM → not subscribed yet → `onNewMention` →
    //     `handleMention` opens a topic and subscribes the thread.
    //   - Follow-up DM → subscribed → `onSubscribedMessage` →
    //     `handleSubscribedMessage` reads the cached topicId and continues.
    //
    // For channel threads we don't worry about subscribing hijacking
    // chatter — `onSubscribedMessage` already gates on `thread.isDM ||
    // message.isMention === true` (same pattern as `BotMessageRouter`), so
    // unrelated replies from other users are filtered out before dispatch.
    bot.onSubscribedMessage(async (thread, message, _context?: MessageContext) => {
      log('onSubscribedMessage: install=%s, msgId=%s', creds.installationKey, (message as any).id);
      const isAddressedToBot = thread.isDM || message.isMention === true;
      if (!isAddressedToBot) {
        log(
          'onSubscribedMessage: skip non-mention in subscribed channel thread, install=%s',
          creds.installationKey,
        );
        return;
      }
      // Follow-up on a subscribed thread (DM after the first touch, or a
      // subscribed channel thread). `handleSubscribedMessage` reads the
      // cached topicId from chat-sdk thread state and continues that topic;
      // it falls back to `handleMention` internally if no topicId is cached.
      await handle(thread, message, 'handleSubscribedMessage');
    });

    // First-touch entry point for any non-subscribed conversation:
    //   - DMs (chat-sdk forces `isMention = true` for them — see the
    //     comment above).
    //   - Channel `@mention`s where the parent thread isn't subscribed yet.
    // `handleMention` opens a fresh topic, writes the topicId into chat-sdk
    // thread state, and (for subscribable platforms / threads — see
    // `client.shouldSubscribe`) subscribes the thread so subsequent
    // messages route through `onSubscribedMessage` and continue the topic.
    bot.onNewMention(async (thread, message, _context?: MessageContext) => {
      log(
        'onNewMention: install=%s, msgId=%s, threadId=%s',
        creds.installationKey,
        (message as any).id,
        thread.id,
      );
      await handle(thread, message, 'handleMention');
    });

    // Native slash commands — wired only for platforms that opt in by
    // exposing `replyPrivately` (Slack, Discord). The full set of command
    // names comes from the shared registry so every native-slash platform
    // surfaces the same menu.
    if (binder.replyPrivately) {
      const slashPaths = this.commands.map((cmd) => `/${cmd.name}`);
      bot.onSlashCommand(slashPaths, async (event) => {
        await this.handleSlashCommand({ binder, bot, client, creds, event, serverDB });
      });
    }

    // Tap-action callbacks delivered via chat-sdk (Discord). Slack and
    // Telegram peek at the raw webhook body via `binder.extractCallbackAction`
    // in `getWebhookHandler` instead because their wire formats let us
    // short-circuit to a `200 OK` ack outside chat-sdk's request lifecycle.
    if (binder.extractActionFromEvent) {
      bot.onAction(async (event) => {
        try {
          const action = binder.extractActionFromEvent!(event, client);
          if (!action) return;
          await this.handleCallbackAction(binder, creds, action);
        } catch (error) {
          log('onAction handler error: %O', error);
        }
      });
    }
  }

  // -------------------------------------------------------------------------
  // Command registry
  // -------------------------------------------------------------------------

  /**
   * Build the platform-agnostic command registry. Each entry is a single
   * function that handles every dispatch path (DM text, native slash, future
   * surfaces) — the `MessengerCommandContext` carries enough state for the
   * handler to make platform decisions on its own.
   *
   * To add a new command: append an entry here. It's automatically wired on
   * every platform whose binder declares it in `slashCommands.names` (or via
   * the text path on platforms without native slash support).
   */
  private buildCommands(): MessengerCommand[] {
    return [
      {
        description: 'Bind your account to LobeHub',
        handler: async (ctx) => {
          // Already-linked short-circuit: re-running `/start` while bound
          // would issue a fresh verify-im token and, on completion,
          // overwrite the user's `messenger_account_links` row via
          // `confirmLink` → `upsertForPlatform`. That desyncs the cached
          // chat-sdk thread state (topicId / agent runtime) from the new
          // active agent and the conversation hangs at "typing…" with no
          // reply. Treat `/start` as the unbound-only onboarding command.
          if (ctx.link) {
            await ctx.reply(
              'Your account is already linked to LobeHub. Send /agents to switch the active agent, or /new to start a fresh conversation.',
            );
            return;
          }
          // The verify-im URL is one-shot and account-binding — never post
          // it to a public channel. Anything outside a 1:1 DM (slash from a
          // public channel, or `@LobeHub /start` typed inside a channel
          // thread) routes the link button into the invoker's DM instead.
          // Slack accepts a user id as the `chatId` and auto-opens the IM
          // (requires `im:write`); Discord's binder treats the user id the
          // same way; Telegram uses the user's chat id directly.
          const linkChatId = ctx.isDM ? ctx.chatId : ctx.authorUserId;
          await ctx.binder.handleUnlinkedMessage({
            authorUserId: ctx.authorUserId,
            authorUserName: ctx.authorUserName,
            chatId: linkChatId,
            message: ctx.message,
          });
          if (!ctx.isDM) {
            await ctx.reply('Check your DM with LobeHub for the link button.');
          }
        },
        name: 'start',
      },
      {
        description: 'List agents and switch the active one',
        handler: async (ctx) => {
          await this.runAgentsCommand(ctx);
        },
        name: 'agents',
      },
      {
        description: 'Start a new conversation',
        handler: async (ctx) => {
          if (!ctx.link) {
            await ctx.reply('You need to /start to bind your account first.');
            return;
          }
          if (!ctx.thread) {
            // Slash dispatch has no chat-sdk Thread; setState lives on the
            // thread instance, so direct the user back to the DM where the
            // text path can pick the command up.
            await ctx.reply('Open your direct message with the LobeHub bot and send `/new` there.');
            return;
          }
          // Drop the cached topicId so the next message starts a fresh topic.
          // Mirrors `/new` in the bot router (BotMessageRouter.buildCommands).
          try {
            await ctx.thread.setState({ topicId: undefined }, { replace: true });
          } catch (error) {
            log('command /new: setState failed: %O', error);
          }
          await ctx.reply('Started a new conversation. Your next message begins a fresh topic.');
        },
        name: 'new',
      },
      {
        description: 'Stop the current execution',
        handler: async (ctx) => {
          if (!ctx.link) {
            await ctx.reply('You need to /start to bind your account first.');
            return;
          }
          if (!ctx.thread) {
            await ctx.reply(
              'Open your direct message with the LobeHub bot and send `/stop` there.',
            );
            return;
          }
          const isActive = AgentBridgeService.isThreadActive(ctx.thread.id);
          if (!isActive) {
            await ctx.reply('No active execution to stop.');
            return;
          }
          const operationId = AgentBridgeService.getActiveOperationId(ctx.thread.id);
          if (operationId) {
            try {
              const aiAgentService = new AiAgentService(ctx.serverDB, ctx.link.userId);
              const result = await aiAgentService.interruptTask({ operationId });
              if (!result.success) {
                log('command /stop: runtime interrupt rejected for op=%s', operationId);
                await ctx.reply('Unable to stop the current execution.');
                return;
              }
              AgentBridgeService.clearActiveThread(ctx.thread.id);
              log('command /stop: interrupted op=%s', operationId);
            } catch (error) {
              log('command /stop: interruptTask failed: %O', error);
              await ctx.reply('Unable to stop the current execution.');
              return;
            }
          } else {
            // execAgent hasn't returned an operationId yet — queue the stop so
            // it fires the moment startup completes.
            AgentBridgeService.requestStop(ctx.thread.id);
            log('command /stop: queued deferred stop for thread=%s', ctx.thread.id);
          }
          await ctx.reply('Stop requested.');
        },
        name: 'stop',
      },
      {
        description: 'Show usage',
        handler: async (ctx) => {
          await ctx.reply(HELP_TEXT);
        },
        name: 'help',
      },
    ];
  }

  /**
   * Native slash command dispatcher. Delegates to the shared command registry
   * after wrapping the chat-sdk slash event in a `MessengerCommandContext`.
   * Each binder supplies its own `reply` mechanism (ephemeral on Slack,
   * regular DM message on Discord) so the handler stays platform-agnostic.
   */
  private async handleSlashCommand(params: {
    binder: MessengerPlatformBinder;
    bot: Chat<any>;
    client: PlatformClient;
    creds: InstallationCredentials;
    event: SlashCommandEvent;
    serverDB: LobeChatDatabase;
  }): Promise<void> {
    const { binder, bot, client, creds, event, serverDB } = params;
    const senderId = event.user.userId;
    if (!senderId) {
      log('handleSlashCommand: missing user id, dropping');
      return;
    }

    const replyPrivately = binder.replyPrivately;
    if (!replyPrivately) {
      log('handleSlashCommand: binder for %s has no replyPrivately', creds.platform);
      return;
    }

    // `event.command` is the literal `/foo` the platform sent.
    const cmdName = event.command.replace(/^\//, '').toLowerCase();
    // chat-sdk wraps the raw channel id with the platform prefix
    // (e.g. `slack:<channel>`, `discord:guild:channel:thread`); strip back to
    // the bare id so direct platform API calls see what they expect.
    const chatId = client.extractChatId((event.channel as any).id as string);
    const args = event.text?.trim() ?? '';

    const reply = (text: string) => replyPrivately.call(binder, event.channel, event.user, text);

    const command = this.commands.find((c) => c.name === cmdName);
    if (!command) {
      await reply(`Unknown command: /${cmdName}`);
      return;
    }

    const link = await MessengerAccountLinkModel.findByPlatformUser(
      serverDB,
      creds.platform,
      senderId,
      creds.tenantId,
    );

    // Slash command events have no chat-sdk Thread attached (slash isn't
    // posted into any specific thread). Worse, chat-sdk's
    // `handleSlashCommandEvent` constructs the ChannelImpl WITHOUT an
    // `isDM` flag — it defaults to `false`, so we can't even tell
    // whether the slash was fired from a DM by inspecting the channel.
    //
    // Resolve the user's DM thread on every slash invocation so commands
    // like `/new` and `/stop` always have a target (the user's canonical
    // bot conversation). `bot.openDM(userId)` is idempotent — Slack's
    // `conversations.open` returns the existing IM when one already
    // exists, so this doesn't create new conversations on each call. If
    // resolution fails (rate limit, permission), `thread` stays undefined
    // and handlers fall back to their "open your DM" branch.
    let thread: any | undefined;
    try {
      thread = await bot.openDM(senderId);
    } catch (error) {
      log('handleSlashCommand: openDM(%s) failed: %O', senderId, error);
    }

    // chat-sdk doesn't propagate `isDM` on slash-event Channels (see the
    // openDM block above). Fall back to a Slack channel-id prefix probe:
    // raw Slack ids that start with `D` are 1:1 DMs (`G` / `MPDM` are
    // group DMs, `C` is public). For other platforms (Discord today) the
    // chat-sdk flag is reliable so we keep that path too.
    const isDmChannel =
      event.channel.isDM === true || (creds.platform === 'slack' && chatId.startsWith('D'));

    // Discord slash commands arrive as deferred interactions (the
    // `patchDiscordForwardedInteractions` patch ack's them with type 5
    // before dispatch). The interaction token in `event.raw` is the only
    // way handlers can complete that deferred state via the webhook
    // follow-up endpoint — without it, Discord keeps spinning "Thinking..."
    // and eventually flips to "did not respond". Other platforms have no
    // analogous concept, so the field stays undefined.
    const interaction = extractDiscordInteractionContext(creds.platform, event);

    try {
      await command.handler({
        args,
        authorUserId: senderId,
        authorUserName: event.user.userName,
        binder,
        chatId,
        interaction,
        // `isDM` lets handlers like `/agents` keep the picker public in
        // DMs (so it stays in history) and widen to an ephemeral when
        // the slash was typed from a public channel.
        isDM: isDmChannel,
        link,
        platform: creds.platform,
        reply,
        serverDB,
        source: 'slash',
        tenantId: creds.tenantId,
        thread,
      });
    } catch (error) {
      log('handleSlashCommand: handler error for /%s: %O', cmdName, error);
      try {
        await reply('Something went wrong.');
      } catch {
        /* ignore */
      }
    }
  }

  /**
   * `/agents` is the single command for both listing agents and switching the
   * active one — on platforms that implement `sendAgentPicker` the bot replies
   * with a tap-to-switch keyboard. Platforms without keyboard support fall
   * back to a numbered text list + `/agents <n>` syntax for switching.
   */
  private async runAgentsCommand(ctx: MessengerCommandContext): Promise<void> {
    const { binder, chatId, link, serverDB } = ctx;

    if (!link) {
      await ctx.reply('You need to /start to bind your account first.');
      return;
    }

    const userAgents = await this.fetchUserAgents(serverDB, link.userId);
    if (userAgents.length === 0) {
      await ctx.reply('You have no agents yet. Create one in LobeHub, then come back to /agents.');
      return;
    }

    // Text-fallback path: `/agents 2` switches without needing the keyboard,
    // for platforms (or clients) where tap-buttons aren't available.
    const args = ctx.args.trim();
    if (args && !binder.sendAgentPicker) {
      const index = Number.parseInt(args, 10);
      if (!Number.isInteger(index) || index < 1 || index > userAgents.length) {
        await ctx.reply(`Usage: /agents <n>, where n is between 1 and ${userAgents.length}.`);
        return;
      }
      const target = userAgents[index - 1];
      if (link.activeAgentId === target.id) {
        await ctx.reply(`${target.title} is already the active agent.`);
        return;
      }
      await MessengerAccountLinkModel.setActiveAgentById(serverDB, link.id, target.id);
      await ctx.reply(
        `Switched active agent to: ${target.title}. Your next message will go there.`,
      );
      return;
    }

    if (binder.sendAgentPicker) {
      await binder.sendAgentPicker(chatId, {
        entries: this.toPickerEntries(userAgents, link.activeAgentId),
        // Channel invocation → render ephemeral so only the invoker sees
        // their personal agent list (otherwise `/agents` from a public
        // channel would broadcast everyone's `LobeAI / Claude Code / …`
        // grid). DMs stay non-ephemeral so the picker persists in history.
        ephemeralTo: ctx.isDM ? undefined : ctx.authorUserId,
        // Discord-only: forward the slash interaction so the binder can
        // complete the deferred reply via the follow-up webhook. Without
        // this, Discord keeps "Thinking..." until it times out.
        interaction: ctx.interaction,
        text: 'Tap an agent to make it the active one:',
      });
      return;
    }

    // Final fallback: numbered list + usage hint for `/agents <n>`.
    const lines = userAgents.map((agent, i) => {
      const marker = link.activeAgentId === agent.id ? ' (active)' : '';
      return `${i + 1}. ${agent.title}${marker}`;
    });
    await ctx.reply(
      `Your agents:\n${lines.join('\n')}\n\nReply with /agents <n> to switch the active agent.`,
    );
  }

  private toPickerEntries(
    userAgents: AgentSummary[],
    activeAgentId: string | null | undefined,
  ): AgentPickerEntry[] {
    return userAgents.map((agent) => ({
      id: agent.id,
      isActive: agent.id === activeAgentId,
      title: agent.title,
    }));
  }

  /**
   * Run a tap-action surfaced by either the binder's webhook-time peek
   * (Slack/Telegram) or chat-sdk's `onAction` event (Discord). Both paths
   * normalize to the same `InboundCallbackAction` shape and delegate the
   * outbound ack (toast + picker re-render) to `binder.acknowledgeCallback`.
   * Today only `messenger:switch:<agentId>` is recognized; new actions can
   * be added by extending the dispatch below.
   */
  private async handleCallbackAction(
    binder: MessengerPlatformBinder,
    creds: InstallationCredentials,
    action: InboundCallbackAction,
  ): Promise<void> {
    if (!binder.acknowledgeCallback) return;

    const ack = binder.acknowledgeCallback.bind(binder, action);

    const switchMatch = action.data.match(/^messenger:switch:(.+)$/);
    if (!switchMatch) {
      await ack({ toast: 'Unknown action.' });
      return;
    }

    const targetAgentId = switchMatch[1];
    const serverDB = await getServerDB();
    const link = await MessengerAccountLinkModel.findByPlatformUser(
      serverDB,
      creds.platform,
      action.fromUserId,
      creds.tenantId,
    );
    if (!link) {
      await ack({ toast: 'Not linked. Send /start first.' });
      return;
    }

    const userAgents = await this.fetchUserAgents(serverDB, link.userId);
    const target = userAgents.find((agent) => agent.id === targetAgentId);
    if (!target) {
      await ack({ toast: 'Agent not found.' });
      return;
    }

    if (link.activeAgentId === targetAgentId) {
      await ack({ toast: `${target.title} is already active.` });
      return;
    }

    await MessengerAccountLinkModel.setActiveAgentById(serverDB, link.id, targetAgentId);
    await ack({
      toast: `Switched to ${target.title}.`,
      updatedPicker: {
        entries: this.toPickerEntries(userAgents, targetAgentId),
        text: 'Pick an agent to receive your messages:',
      },
    });
  }

  /**
   * Fetch a user's agents for `/agents`. Mirrors the web
   * verify-im picker (and the home sidebar):
   *  - excludes virtual agents but explicitly keeps the inbox/LobeAI agent
   *  - orders by `updatedAt DESC`
   *  - pins inbox/LobeAI to the top regardless of updatedAt
   *  - applies the LobeAI title fallback (slug='inbox') and a generic
   *    "Custom Agent" fallback for agents without a title
   */
  private async fetchUserAgents(
    serverDB: LobeChatDatabase,
    userId: string,
  ): Promise<AgentSummary[]> {
    const rows = await serverDB
      .select({ id: agents.id, slug: agents.slug, title: agents.title })
      .from(agents)
      .where(
        and(
          eq(agents.userId, userId),
          or(ne(agents.virtual, true), eq(agents.slug, INBOX_SESSION_ID)),
        ),
      )
      .orderBy(desc(agents.updatedAt));

    const mapped = rows
      .filter((row) => row.id)
      .map((row) => ({
        id: row.id,
        slug: row.slug,
        title:
          (row.title && row.title.trim()) ||
          (row.slug === INBOX_SESSION_ID ? 'LobeAI' : 'Custom Agent'),
      }));

    const inboxIdx = mapped.findIndex((row) => row.slug === INBOX_SESSION_ID);
    if (inboxIdx > 0) {
      const [inbox] = mapped.splice(inboxIdx, 1);
      mapped.unshift(inbox);
    }
    return mapped.map(({ slug: _slug, ...rest }) => rest);
  }

  private async dispatchToAgent(
    thread: any,
    message: Message,
    client: PlatformClient,
    link: MessengerAccountLinkItem,
    agentId: string,
    platform: MessengerPlatform,
    bridgeMethod: 'handleMention' | 'handleSubscribedMessage',
  ): Promise<void> {
    log(
      'dispatchToAgent: platform=%s, tenant=%s, sender=%s, agent=%s, user=%s',
      platform,
      link.tenantId,
      link.platformUserId,
      agentId,
      link.userId,
    );

    const serverDB = await getServerDB();
    const bridge = new AgentBridgeService(serverDB, link.userId);

    // Messenger account-link routing already binds platform sender →
    // LobeHub user; the dispatch only fires for the linked sender. So
    // `isOwner` is true iff the inbound message's `author.userId` matches
    // the linked `platformUserId`. `buildBotContext` enforces the
    // fail-closed default (never trust when either side is missing).
    //
    // `bridgeMethod` is chosen by the caller per entry point, mirroring
    // BotMessageRouter:
    // - `handleMention`           — first-touch DMs and channel @mentions;
    //                               opens a fresh topic and writes its id
    //                               to chat-sdk thread state.
    // - `handleSubscribedMessage` — DM follow-ups (after `thread.subscribe()`
    //                               in `onDirectMessage`); reads the cached
    //                               topicId and continues in the same topic.
    //                               Falls back to `handleMention` internally
    //                               if no topicId is cached (defensive).
    const bridgeOpts = {
      agentId,
      botContext: {
        ...buildBotContext({
          // Per-install applicationId so the agent runtime can distinguish
          // workspaces in its own bookkeeping (logs, traces, dedupe).
          applicationId: link.tenantId
            ? `messenger-${platform}-${link.tenantId}`
            : `messenger-${platform}`,
          authorUserId: message.author?.userId,
          operatorUserId: link.platformUserId,
          platform,
          platformThreadId: thread.id,
        }),
        // Explicit, deterministic marker that this run originated from the
        // shared Messenger bot. `BotCallbackService` uses the presence of this
        // field to resolve credentials via the messenger install store instead
        // of `agent_bot_providers` (which has no row for messenger flows).
        // Format matches `MessengerInstallationStore.resolveByKey` keys.
        messengerInstallationKey: link.tenantId
          ? `${platform}:${link.tenantId}`
          : `${platform}:singleton`,
      },
      client,
    };

    await bridge[bridgeMethod](thread, message, bridgeOpts);
  }
}

let singleton: MessengerRouter | undefined;

export const getMessengerRouter = (): MessengerRouter => {
  if (!singleton) singleton = new MessengerRouter();
  return singleton;
};
