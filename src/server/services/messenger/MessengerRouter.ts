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

    const handle = async (thread: any, message: Message): Promise<void> => {
      if (message.author.isBot === true) return;

      const senderId = message.author.userId;
      if (!senderId) {
        log('handle: missing author.userId, dropping');
        return;
      }

      const chatId = client.extractChatId(thread.id);
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
            await command.handler({
              args: parsed.args,
              authorUserId: senderId,
              authorUserName: message.author.userName,
              binder,
              chatId,
              link,
              message,
              platform,
              reply: (text) => binder.sendDmText(chatId, text),
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

        // Unbound sender → trigger link flow
        if (!link) {
          await binder.handleUnlinkedMessage({
            authorUserId: senderId,
            authorUserName: message.author.userName,
            chatId,
            message,
          });
          return;
        }

        // Bound but no active agent → prompt the user to pick one via /agents
        if (!link.activeAgentId) {
          await binder.sendDmText(chatId, 'No active agent selected. Send /agents to pick one.');
          return;
        }

        await this.dispatchToAgent(thread, message, client, link, link.activeAgentId, platform);
      } catch (error) {
        log('handle: handler error: %O', error);
        try {
          await thread.post(renderInlineError('Something went wrong'));
        } catch {
          /* ignore */
        }
      }
    };

    // Chat SDK routes 1:1 conversations to `onDirectMessage`. Follow-up messages
    // in a subscribed thread go to `onSubscribedMessage`. Messenger is currently
    // DM-only, so wire the same handler to both — and `thread.subscribe()` on
    // first contact so future messages (which arrive as "subscribed" rather
    // than "direct") still route here. `onNewMessage(/./)` does NOT match DMs;
    // those fall through to `onNewMention` if `onDirectMessage` is unregistered.
    bot.onDirectMessage(async (thread, message, _channel, _context?: MessageContext) => {
      log('onDirectMessage: install=%s, msgId=%s', creds.installationKey, (message as any).id);
      try {
        await thread.subscribe();
      } catch {
        /* idempotent — first contact creates the subscription, later calls no-op */
      }
      await handle(thread, message);
    });

    bot.onSubscribedMessage(async (thread, message, _context?: MessageContext) => {
      log('onSubscribedMessage: install=%s, msgId=%s', creds.installationKey, (message as any).id);
      await handle(thread, message);
    });

    // First-touch @mention in a non-DM context (Slack channel, Discord guild
    // channel). Without this, an unlinked user's first interaction would be
    // dropped — chat-sdk routes channel mentions to `onNewMention`, not the
    // DM/subscribed paths above. We treat the unlinked case as "DM the user
    // a link button"; the runtime is DM-only today (see binder docstrings),
    // so a linked user's channel mention is intentionally a no-op.
    bot.onNewMention(async (thread, message, _context?: MessageContext) => {
      if (message.author.isBot === true) return;
      const senderId = message.author.userId;
      if (!senderId) {
        log('onNewMention: missing author.userId, dropping');
        return;
      }
      log(
        'onNewMention: install=%s, msgId=%s, threadId=%s',
        creds.installationKey,
        (message as any).id,
        thread.id,
      );
      try {
        const link = await MessengerAccountLinkModel.findByPlatformUser(
          serverDB,
          platform,
          senderId,
          tenantId,
        );
        if (link) return;

        // Route the link prompt to the user's DM, never the public channel —
        // the verify-im URL carries a one-shot token. Slack's chat.postMessage
        // auto-opens an IM when the channel argument is a user id; Discord's
        // binder calls openDM(authorUserId) and ignores chatId; Telegram uses
        // the user's chat id directly. So `authorUserId` is the correct
        // private target across platforms.
        await binder.handleUnlinkedMessage({
          authorUserId: senderId,
          authorUserName: message.author.userName,
          chatId: senderId,
          message,
        });
      } catch (error) {
        log('onNewMention: handler error: %O', error);
      }
    });

    // Native slash commands — wired only for platforms that opt in by
    // exposing `replyPrivately` (Slack, Discord). The full set of command
    // names comes from the shared registry so every native-slash platform
    // surfaces the same menu.
    if (binder.replyPrivately) {
      const slashPaths = this.commands.map((cmd) => `/${cmd.name}`);
      bot.onSlashCommand(slashPaths, async (event) => {
        await this.handleSlashCommand({ binder, client, creds, event, serverDB });
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
          // For slash invocations the slash may have come from a public
          // channel — route the link button privately to the user's DM so
          // the one-shot link token isn't leaked. Slack accepts a user id
          // as the `chatId` (`chat.postMessage` auto-opens the IM with
          // `im:write` scope), so we pass `authorUserId`. Text invocations
          // already arrive in a DM thread, so we use the inbound `chatId`.
          const linkChatId = ctx.source === 'slash' ? ctx.authorUserId : ctx.chatId;
          await ctx.binder.handleUnlinkedMessage({
            authorUserId: ctx.authorUserId,
            authorUserName: ctx.authorUserName,
            chatId: linkChatId,
            message: ctx.message,
          });
          if (ctx.source === 'slash') {
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
    client: PlatformClient;
    creds: InstallationCredentials;
    event: SlashCommandEvent;
    serverDB: LobeChatDatabase;
  }): Promise<void> {
    const { binder, client, creds, event, serverDB } = params;
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

    try {
      await command.handler({
        args,
        authorUserId: senderId,
        authorUserName: event.user.userName,
        binder,
        chatId,
        link,
        platform: creds.platform,
        reply,
        serverDB,
        source: 'slash',
        tenantId: creds.tenantId,
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

    await bridge.handleMention(thread, message, {
      agentId,
      botContext: {
        // Per-install applicationId so the agent runtime can distinguish
        // workspaces in its own bookkeeping (logs, traces, dedupe).
        applicationId: link.tenantId
          ? `messenger-${platform}-${link.tenantId}`
          : `messenger-${platform}`,
        // Explicit, deterministic marker that this run originated from the
        // shared Messenger bot. `BotCallbackService` uses the presence of this
        // field to resolve credentials via the messenger install store instead
        // of `agent_bot_providers` (which has no row for messenger flows).
        // Format matches `MessengerInstallationStore.resolveByKey` keys.
        messengerInstallationKey: link.tenantId
          ? `${platform}:${link.tenantId}`
          : `${platform}:singleton`,
        platform,
        platformThreadId: thread.id,
      },
      client,
    });
  }
}

let singleton: MessengerRouter | undefined;

export const getMessengerRouter = (): MessengerRouter => {
  if (!singleton) singleton = new MessengerRouter();
  return singleton;
};
