import { createIoRedisState } from '@chat-adapter/state-ioredis';
import {
  Chat,
  ConsoleLogger,
  type Message,
  type MessageContext,
  type SlashCommandEvent,
} from 'chat';
import debug from 'debug';

import { getBotFeatureAccessState } from '@/business/server/bot/featureAccess';
import type { MessengerPlatform } from '@/config/messenger';
import { getServerDB } from '@/database/core/db-adaptor';
import { AgentModel } from '@/database/models/agent';
import type { SafeMessengerAccountLink } from '@/database/models/messengerAccountLink';
import { MessengerAccountLinkModel } from '@/database/models/messengerAccountLink';
import { WorkspaceModel } from '@/database/models/workspace';
import type { LobeChatDatabase } from '@/database/type';
import { getServerFeatureFlagsStateFromRuntimeConfig } from '@/server/featureFlags';
import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';
import { AiAgentService } from '@/server/services/aiAgent';
import { AgentBridgeService } from '@/server/services/bot/AgentBridgeService';
import { buildBotContext } from '@/server/services/bot/buildBotContext';
import { submitBotFeedback } from '@/server/services/bot/feedbackSubmit';
import type { PlatformClient } from '@/server/services/bot/platforms';
import { getBotReplyLocale } from '@/server/services/bot/platforms/const';
import {
  renderCommandReply,
  renderFeedbackSubmitted,
  renderInlineError,
} from '@/server/services/bot/replyTemplate';

import { getInstallationStore } from './installations';
import type { InstallationCredentials } from './installations/types';
import { messengerPlatformRegistry } from './platforms';
import { getMessengerSystemStrings } from './systemReply';
import type {
  AgentPickerEntry,
  CallbackAcknowledgement,
  InboundCallbackAction,
  MessengerPlatformBinder,
} from './types';

const log = debug('lobe-server:messenger:router');

/**
 * Sentinel scope token for the Personal scope (whose real `workspaceId` is
 * `null`) so it can ride inside a button id (`messenger:scope:personal`),
 * which can't carry a null. Real workspaces use their own id. Workspace ids
 * are generated nanoids, so they never collide with this literal.
 */
const PERSONAL_SCOPE_ID = 'personal';
const WECHAT_UNSUPPORTED_COMMANDS = new Set(['start']);

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
  /** The caller's own private agent inside a workspace scope (always false in
   *  the personal scope, where every agent is implicitly private). */
  isPrivate: boolean;
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
  link: SafeMessengerAccountLink | undefined;
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
  /**
   * Native slash-command argument schema for platforms that require
   * arguments to be declared up-front (Discord, Slack). Without this,
   * Discord registers the command as zero-arg — clicking it from the
   * slash menu fires the handler with no value field shown to the user.
   * Mirrors `BotCommand.options` in `BotMessageRouter` so command authors
   * use the same shape across both routers.
   */
  options?: Array<{
    description: string;
    name: string;
    required?: boolean;
  }>;
}

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
 * Whether `userId` is still a member of `workspaceId`. The link's active scope
 * may point at a workspace the user has since been removed from; dispatch must
 * re-check before running that workspace's agent.
 */
const userIsWorkspaceMember = async (
  db: LobeChatDatabase,
  userId: string,
  workspaceId: string,
): Promise<boolean> => {
  if (!(await isWorkspaceFeatureEnabledForUser(userId))) return false;

  const workspaces = await new WorkspaceModel(db, userId).listUserWorkspaces();
  return workspaces.some((w) => w.id === workspaceId);
};

const isWorkspaceFeatureEnabledForUser = async (userId: string): Promise<boolean> => {
  const featureFlags = await getServerFeatureFlagsStateFromRuntimeConfig(userId);
  return featureFlags.enableWorkspace === true;
};

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

  /** Static command registry. Platform capability filters are applied when
   *  commands are registered and dispatched (WeChat, for example, binds via
   *  web QR and therefore does not expose `/start`). */
  private readonly commands: MessengerCommand[] = this.buildCommands();

  /**
   * Drop the cached Chat SDK bot for an install so the next webhook rebuilds
   * it from freshly resolved credentials. Must be called whenever an install's
   * credential bundle is replaced or removed (e.g. a WeChat rescan rotates the
   * QR-issued bot token / baseUrl) — otherwise this process keeps replying
   * through the stale client until restart.
   */
  invalidateBot(installationKey: string): void {
    this.bots.delete(installationKey);
  }

  private getCommandsForPlatform(platform: MessengerPlatform): MessengerCommand[] {
    if (platform !== 'wechat') return this.commands;
    return this.commands.filter((command) => !WECHAT_UNSUPPORTED_COMMANDS.has(command.name));
  }

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

      // ----- App Home `Messages` tab opener (Slack marketplace welcome) ---
      // Slack requires a welcome message the first time a user opens the
      // Messages tab. chat-sdk's slack adapter drops these events, so peek
      // the raw body here and dispatch via the binder. Dedupe is handled
      // inside `handleAppHomeOpened` so a per-user welcome fires once.
      if (bot.binder.extractAppHomeOpened) {
        try {
          const opener = await bot.binder.extractAppHomeOpened(reconstructRequest(req, rawBody));
          if (opener) {
            await this.handleAppHomeOpened(bot, creds, opener);
            return new Response('OK', { status: 200 });
          }
        } catch (error) {
          log('extractAppHomeOpened failed for %s: %O', platform, error);
        }
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
      const commands = this.getCommandsForPlatform(creds.platform);
      client
        .registerBotCommands(
          commands.map((cmd) => ({
            command: cmd.name,
            description: cmd.description,
            // Forward the option schema so Discord/Slack surface required
            // arguments (e.g. `/feedback message:`) in the slash picker.
            // Without this, the command registers as zero-arg and the
            // user can fire it without providing the required text — the
            // handler then sees empty `args` and falls back to the usage
            // hint. Mirrors `BotMessageRouter.createAndRegisterBot`.
            options: cmd.options,
          })),
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
    const commands = this.getCommandsForPlatform(platform);
    const systemStrings = getMessengerSystemStrings(platform);

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
      const channelThreadTs = isChannelMention ? String(thread.id).split(':')[2] : undefined;
      const replyToSender = (text: string): Promise<void> => {
        if (isChannelMention && binder.replyEphemeral) {
          return binder.replyEphemeral({
            channelId: chatId,
            text,
            threadTs: channelThreadTs,
            userId: senderId,
          });
        }
        return binder.sendDmText(chatId, text);
      };
      const link = await MessengerAccountLinkModel.findByPlatformUser(
        serverDB,
        platform,
        senderId,
        tenantId,
      );

      try {
        const parsed = parseCommand(message.text);
        if (parsed) {
          const command = commands.find((c) => c.name === parsed.name);
          if (command) {
            // Text-path command reply: in a DM `chat.postMessage` is fine
            // (the conversation is private already). In a channel `@mention`
            // we must NOT broadcast — `/new`, `/stop`, `/start` etc. all
            // surface user-private state. Route the reply through
            // `replyEphemeral` so only the invoker sees it. Anchor in the
            // mention's thread (Slack `thread_ts`) so the response sits next
            // to the trigger. Platforms without `replyEphemeral` (Telegram)
            // fall back to the regular DM path.
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
              reply: replyToSender,
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
          await replyToSender(systemStrings.noActiveAgent);
          return;
        }

        // Re-validate the active scope: it may point at a workspace the user
        // has since been removed from. Don't run another workspace's agent for
        // a non-member — prompt them to /switch back to a scope they can use.
        if (
          link.workspaceId &&
          !(await userIsWorkspaceMember(serverDB, link.userId, link.workspaceId))
        ) {
          await replyToSender(systemStrings.staleScope);
          return;
        }

        const featureAccess = await getBotFeatureAccessState({
          action: 'runtime',
          platform,
          userId: link.userId,
          workspaceId: link.workspaceId ?? undefined,
        });
        if (!featureAccess.allowed) {
          await replyToSender(
            featureAccess.blockedMessage ??
              'This messenger connection requires a paid plan. Upgrade in LobeHub Settings to continue.',
          );
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
          await thread.post(
            renderInlineError(systemStrings.genericError, getBotReplyLocale(platform)),
          );
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
    // Track distinct humans who have spoken in a channel thread. A
    // single-user thread is effectively a private 1:1 with the bot (just
    // hosted in a channel), so we relax the @mention requirement and let
    // every follow-up reach the agent. Once a second human joins we revert
    // to mention-only mode and announce the switch once so newcomers
    // understand why follow-ups are suddenly silent.
    //
    // Tracking lives in chat-sdk state so the count survives webhook
    // boundaries (each Slack event delivery is a fresh request). DMs and
    // bot authors are excluded — DMs are already 1:1 and bots can't drive
    // a conversation.
    const PARTICIPANTS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
    const participantsKey = (threadId: string): string => `messenger:thread-humans:${threadId}`;
    const mentionRequiredAnnouncedKey = (threadId: string): string =>
      `messenger:thread-mention-required-announced:${threadId}`;

    const trackThreadParticipant = async (
      thread: any,
      message: Message,
    ): Promise<{ count: number; isNewParticipant: boolean }> => {
      if (thread.isDM) return { count: 0, isNewParticipant: false };
      const senderId = message.author?.userId;
      const isHuman =
        !!senderId &&
        message.author?.isBot !== true &&
        (message.author as { isMe?: boolean })?.isMe !== true;
      if (!isHuman) return { count: 0, isNewParticipant: false };

      const stateAdapter = bot.getState();
      const key = participantsKey(thread.id);
      let participants: string[] = [];
      try {
        participants = (await stateAdapter.getList<string>(key)) ?? [];
      } catch (error) {
        log('trackThreadParticipant: getList failed: %O', error);
      }
      if (participants.includes(senderId)) {
        return { count: participants.length, isNewParticipant: false };
      }
      try {
        await stateAdapter.appendToList(key, senderId, {
          maxLength: 50,
          ttlMs: PARTICIPANTS_TTL_MS,
        });
      } catch (error) {
        log('trackThreadParticipant: appendToList failed: %O', error);
      }
      return { count: participants.length + 1, isNewParticipant: true };
    };

    bot.onSubscribedMessage(async (thread, message, _context?: MessageContext) => {
      log('onSubscribedMessage: install=%s, msgId=%s', creds.installationKey, (message as any).id);

      // DM short-circuit — always 1:1 with the bot, no participant gating.
      if (thread.isDM) {
        await handle(thread, message, 'handleSubscribedMessage');
        return;
      }

      const isMention = message.isMention === true;
      const { count } = await trackThreadParticipant(thread, message);

      // Single-human thread → respond without `@`. Multi-human thread →
      // only @mention triggers a reply, so the bot doesn't insert itself
      // into human-to-human chatter happening inside a thread it once
      // opened. `count === 0` covers tracking failures or bot authors —
      // fall through to `handle()` and let its existing `isBot` filter
      // drop bot messages.
      const shouldHandle = isMention || count <= 1;
      if (!shouldHandle) {
        // First skip in this thread → tell the room why the bot just went
        // quiet so participants know to @mention if they need it. Dedupe
        // by thread id so we never spam more than once.
        try {
          const fresh = await bot
            .getState()
            .setIfNotExists(mentionRequiredAnnouncedKey(thread.id), '1', PARTICIPANTS_TTL_MS);
          if (fresh) {
            await thread.post(
              "Multiple people are talking in this thread now. From here on I'll only respond when you @mention me.",
            );
          }
        } catch (error) {
          log('onSubscribedMessage: mention-mode announcement failed: %O', error);
        }
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
      // Record the original @mentioner so the participant count starts at 1
      // (not 0) when their first follow-up lands in `onSubscribedMessage`.
      // Without this the follow-up looks like a "new participant" instead
      // of the same person continuing.
      await trackThreadParticipant(thread, message);
      await handle(thread, message, 'handleMention');
    });

    // Native slash commands. chat-adapter routes a leading `/command` to the
    // slash-command channel (NOT onNewMention / onSubscribedMessage), so any
    // platform that surfaces slash commands MUST register here or the command
    // is silently dropped. Slack / Discord reply via `replyPrivately`; the
    // Telegram binder does not implement that helper, so register it explicitly
    // and fall back to `sendDmText` in the dispatcher. The full set of command
    // names comes from the shared registry so every platform surfaces the same menu.
    const supportsNativeSlashCommands =
      binder.replyPrivately !== undefined || creds.platform === 'telegram';
    if (supportsNativeSlashCommands) {
      const slashPaths = commands.map((cmd) => `/${cmd.name}`);
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

    // Channel-join welcome (Slack `member_joined_channel`). Counterpart to the
    // App Home `Messages`-tab welcome in `handleAppHomeOpened` — the marketplace
    // listing reviewers also test the `/invite @LobeHub` entry point, so the
    // bot must speak up the first time it lands in a channel. Other events
    // (regular members joining) are filtered out by the `botUserId` check.
    bot.onMemberJoinedChannel(async (event) => {
      const botUserId = (event.adapter as any)?.botUserId as string | undefined;
      if (!botUserId || event.userId !== botUserId) return;
      const channelId = client.extractChatId(event.channelId);
      if (!channelId) return;
      await this.handleChannelJoin(bot, binder, channelId);
    });
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
          const strings = getMessengerSystemStrings(ctx.platform);
          // Already-linked short-circuit: re-running `/start` while bound
          // would issue a fresh verify-im token and, on completion,
          // overwrite the user's `messenger_account_links` row via
          // `confirmLink` → `upsertForPlatform`. That desyncs the cached
          // chat-sdk thread state (topicId / agent runtime) from the new
          // active agent and the conversation hangs at "typing…" with no
          // reply. Treat `/start` as the unbound-only onboarding command.
          if (ctx.link) {
            await ctx.reply(strings.accountAlreadyLinked);
            return;
          }
          // The verify-im URL is one-shot and account-binding; it must reach
          // the invoker privately. Two equally-private surfaces depending on
          // the platform:
          //   • Slack — `chat.postEphemeral` in the channel is invoker-only
          //     and keeps the link flow inline (no DM context switch).
          //   • Discord — no text-channel ephemeral primitive for non-
          //     interaction messages, so we still open a DM.
          // Telegram group `/start` is intercepted by `handleSlashCommand`
          // before this handler and gets a safe prompt to open the bot DM.
          // Detection key: presence of `binder.replyEphemeral`, which is what
          // the @mention path also uses to decide ephemeral-vs-DM.
          const canEphemeralInChannel = !ctx.isDM && !!ctx.binder.replyEphemeral;
          const linkChatId = ctx.isDM || canEphemeralInChannel ? ctx.chatId : ctx.authorUserId;
          // `slack:<channel>:` (empty threadTs) — slash commands fire outside
          // any thread, so the ephemeral floats inline at the channel root,
          // which is what we want.
          const channelMentionThreadId = canEphemeralInChannel
            ? `${ctx.platform}:${ctx.chatId}:`
            : undefined;
          await ctx.binder.handleUnlinkedMessage({
            authorUserId: ctx.authorUserId,
            authorUserName: ctx.authorUserName,
            channelMentionThreadId,
            chatId: linkChatId,
            message: ctx.message,
          });
          // Only nudge the user toward DM when the link actually went there.
          // For the Slack ephemeral path the prompt is already inline, a
          // second "check your DM" would be misleading.
          if (!ctx.isDM && !canEphemeralInChannel) {
            await ctx.reply(strings.checkDirectMessage);
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
        description: 'Switch the active scope (personal or a workspace)',
        // Declared so Discord/Slack surface a `/switch <n>` argument in the
        // slash picker; the no-arg form just lists the scopes.
        options: [
          {
            description: 'Scope number from the /switch list',
            name: 'scope',
            required: false,
          },
        ],
        handler: async (ctx) => {
          await this.runSwitchCommand(ctx);
        },
        name: 'switch',
      },
      {
        description: 'Start a new conversation',
        handler: async (ctx) => {
          const strings = getMessengerSystemStrings(ctx.platform);
          if (!ctx.link) {
            await ctx.reply(strings.needLink);
            return;
          }
          if (!ctx.thread) {
            // Slash dispatch has no chat-sdk Thread; setState lives on the
            // thread instance, so direct the user back to the DM where the
            // text path can pick the command up.
            await ctx.reply(strings.newDirectMessageOnly);
            return;
          }
          // Drop the cached topicId so the next message starts a fresh topic.
          // Mirrors `/new` in the bot router (BotMessageRouter.buildCommands).
          try {
            await ctx.thread.setState({ topicId: undefined }, { replace: true });
          } catch (error) {
            log('command /new: setState failed: %O', error);
          }
          await ctx.reply(strings.newStarted);
        },
        name: 'new',
      },
      {
        description: 'Stop the current execution',
        handler: async (ctx) => {
          const strings = getMessengerSystemStrings(ctx.platform);
          if (!ctx.link) {
            await ctx.reply(strings.needLink);
            return;
          }
          if (!ctx.thread) {
            await ctx.reply(strings.stopDirectMessageOnly);
            return;
          }
          const isActive = AgentBridgeService.isThreadActive(ctx.thread.id);
          if (!isActive) {
            await ctx.reply(strings.stopNotActive);
            return;
          }
          const operationId = AgentBridgeService.getActiveOperationId(ctx.thread.id);
          if (operationId) {
            try {
              const aiAgentService = new AiAgentService(ctx.serverDB, ctx.link.userId, {
                workspaceId: ctx.link.workspaceId ?? undefined,
              });
              const result = await aiAgentService.interruptTask({ operationId });
              if (!result.success) {
                log('command /stop: runtime interrupt rejected for op=%s', operationId);
                await ctx.reply(strings.stopUnable);
                return;
              }
              AgentBridgeService.clearActiveThread(ctx.thread.id);
              log('command /stop: interrupted op=%s', operationId);
            } catch (error) {
              log('command /stop: interruptTask failed: %O', error);
              await ctx.reply(strings.stopUnable);
              return;
            }
          } else {
            // execAgent hasn't returned an operationId yet — queue the stop so
            // it fires the moment startup completes.
            AgentBridgeService.requestStop(ctx.thread.id);
            log('command /stop: queued deferred stop for thread=%s', ctx.thread.id);
          }
          await ctx.reply(strings.stopRequested);
        },
        name: 'stop',
      },
      {
        description: 'Send feedback directly to the LobeHub team (no AI reply)',
        // Declaring the argument so Discord/Slack surface a `/feedback <message>`
        // prompt; without it the slash picker registers the command as zero-arg
        // and the user can't enter feedback text from the picker UI.
        options: [
          {
            description: 'Your feedback message',
            name: 'message',
            required: true,
          },
        ],
        handler: async (ctx) => {
          const replyLocale = getBotReplyLocale(ctx.platform);
          const strings = getMessengerSystemStrings(ctx.platform);
          // Feedback is tied to a LobeHub account so the team can follow up;
          // an unbound user has no email/identity to attach. Mirror the
          // `/new` / `/stop` "you need to /start" guard for consistency.
          if (!ctx.link) {
            await ctx.reply(strings.needLink);
            return;
          }
          const body = ctx.args.trim();
          if (!body) {
            await ctx.reply(renderCommandReply('cmdFeedbackUsage', replyLocale));
            return;
          }
          const result = await submitBotFeedback(ctx.serverDB, {
            body,
            platform: ctx.platform,
            threadId: ctx.thread?.id ?? ctx.chatId,
            userId: ctx.link.userId,
          });
          if (!result.success) {
            await ctx.reply(renderCommandReply('cmdFeedbackError', replyLocale));
            return;
          }
          await ctx.reply(renderFeedbackSubmitted(result.issueUrl, replyLocale));
        },
        name: 'feedback',
      },
      {
        description: 'Show usage',
        handler: async (ctx) => {
          await ctx.reply(getMessengerSystemStrings(ctx.platform).help);
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

    // `event.command` is the literal `/foo` the platform sent.
    const cmdName = event.command.replace(/^\//, '').toLowerCase();
    // chat-sdk wraps the raw channel id with the platform prefix
    // (e.g. `slack:<channel>`, `discord:guild:channel:thread`); strip back to
    // the bare id so direct platform API calls see what they expect.
    const chatId = client.extractChatId((event.channel as any).id as string);
    const args = event.text?.trim() ?? '';
    const isTelegramGroup = creds.platform === 'telegram' && chatId.startsWith('-');
    const replyChatId = isTelegramGroup ? senderId : chatId;

    // Slack / Discord reply privately (ephemeral / DM); Telegram has no
    // `replyPrivately`, so fall back to a direct message in the slash
    // command's chat. Both keep the reply scoped to the invoker.
    const replyPrivately = binder.replyPrivately;
    const reply = replyPrivately
      ? (text: string) => replyPrivately.call(binder, event.channel, event.user, text)
      : (text: string) => binder.sendDmText(replyChatId, text);
    const systemStrings = getMessengerSystemStrings(creds.platform);

    const command = this.getCommandsForPlatform(creds.platform).find((c) => c.name === cmdName);
    if (!command) {
      await reply(systemStrings.unknownCommand(cmdName));
      return;
    }

    const link = await MessengerAccountLinkModel.findByPlatformUser(
      serverDB,
      creds.platform,
      senderId,
      creds.tenantId,
    );

    // Telegram bots cannot initiate a private conversation with a user. A
    // first-time user invoking `/start` from a group therefore cannot receive
    // the account-link button at `senderId`. Keep the one-shot link out of the
    // group and post only a safe instruction back to the originating chat (or
    // forum topic); the user can then open the bot DM and retry `/start`.
    if (isTelegramGroup && cmdName === 'start' && !link) {
      await event.channel.post(systemStrings.startDirectMessageOnly);
      return;
    }

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
      event.channel.isDM === true ||
      (creds.platform === 'slack' && chatId.startsWith('D')) ||
      (creds.platform === 'telegram' && !isTelegramGroup);

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
        chatId: replyChatId,
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
        await reply(systemStrings.genericError);
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
    const strings = getMessengerSystemStrings(ctx.platform);

    if (!link) {
      await ctx.reply(strings.needLink);
      return;
    }

    const userAgents = await this.fetchUserAgents(serverDB, link.userId, link.workspaceId);
    if (userAgents.length === 0) {
      await ctx.reply(strings.agentsEmpty);
      return;
    }

    // Text-fallback path: `/agents 2` switches without needing the keyboard,
    // for platforms (or clients) where tap-buttons aren't available.
    const args = ctx.args.trim();
    if (args && !binder.sendAgentPicker) {
      const index = Number.parseInt(args, 10);
      if (!Number.isInteger(index) || index < 1 || index > userAgents.length) {
        await ctx.reply(strings.agentsUsage(userAgents.length));
        return;
      }
      const target = userAgents[index - 1];
      if (link.activeAgentId === target.id) {
        await ctx.reply(strings.activeAgentAlready(target.title));
        return;
      }
      await MessengerAccountLinkModel.setActiveAgentById(serverDB, link.id, target.id);
      await ctx.reply(strings.activeAgentChanged(target.title));
      return;
    }

    if (binder.sendAgentPicker) {
      await binder.sendAgentPicker(chatId, {
        entries: this.toPickerEntries(userAgents, link.activeAgentId, strings),
        // Channel invocation → render ephemeral so only the invoker sees
        // their personal agent list (otherwise `/agents` from a public
        // channel would broadcast everyone's `LobeAI / Claude Code / …`
        // grid). DMs stay non-ephemeral so the picker persists in history.
        ephemeralTo: ctx.isDM ? undefined : ctx.authorUserId,
        // Discord-only: forward the slash interaction so the binder can
        // complete the deferred reply via the follow-up webhook. Without
        // this, Discord keeps "Thinking..." until it times out.
        interaction: ctx.interaction,
        text: strings.agentsPicker,
      });
      return;
    }

    // Final fallback: numbered list + usage hint for `/agents <n>`.
    await ctx.reply(this.renderAgentsList(userAgents, link.activeAgentId, strings));
  }

  /**
   * Render the numbered `/agents` text list. In a workspace scope where both
   * shared workspace agents and the caller's private agents are present, the
   * list splits into two headed sections (workspace first — matching the
   * `fetchUserAgents` partition) while keeping numbering continuous, so
   * `/agents <n>` still maps 1:1 onto the fetched array.
   */
  private renderAgentsList(
    userAgents: AgentSummary[],
    activeAgentId: string | null | undefined,
    strings: ReturnType<typeof getMessengerSystemStrings>,
  ): string {
    const line = (agent: AgentSummary, i: number) => {
      const marker = activeAgentId === agent.id ? ` (${strings.activeMarker})` : '';
      return `${i + 1}. ${agent.title}${marker}`;
    };

    const privateCount = userAgents.filter((agent) => agent.isPrivate).length;
    const grouped = privateCount > 0 && privateCount < userAgents.length;

    if (!grouped) {
      const lines = userAgents.map((agent, i) => line(agent, i));
      return `${strings.agentsHeading}\n${lines.join('\n')}\n\n${strings.agentsHint}`;
    }

    // `fetchUserAgents` already partitioned workspace-first, so the two
    // sections are contiguous slices and the shared numbering stays in order.
    const workspaceLines: string[] = [];
    const privateLines: string[] = [];
    for (const [i, agent] of userAgents.entries()) {
      (agent.isPrivate ? privateLines : workspaceLines).push(line(agent, i));
    }

    return [
      `${strings.agentsWorkspaceHeading}\n${workspaceLines.join('\n')}`,
      `${strings.agentsPrivateHeading}\n${privateLines.join('\n')}`,
      strings.agentsHint,
    ].join('\n\n');
  }

  /**
   * `/switch` changes the active *scope* of the IM session — personal or one
   * of the workspaces the user belongs to. The bot is a single shared bot, so
   * which LobeHub context a conversation runs in is the active agent's scope;
   * switching scope clears the active agent and the user re-picks via /agents.
   *
   * Mirrors `/agents`: on platforms that implement `sendAgentPicker` the bot
   * replies with a tap-to-switch keyboard (buttons emit `messenger:scope:<id>`
   * so the callback path can tell them apart from agent switches). Platforms
   * without keyboard support fall back to a numbered text list + `/switch <n>`.
   */
  private async runSwitchCommand(ctx: MessengerCommandContext): Promise<void> {
    const { binder, chatId, link, serverDB } = ctx;
    const strings = getMessengerSystemStrings(ctx.platform);
    if (!link) {
      await ctx.reply(strings.needLink);
      return;
    }

    const scopes = await this.fetchUserScopes(serverDB, link.userId, ctx.platform);

    // Text-fallback path: `/switch 2` switches without needing the keyboard,
    // for platforms (or clients) where tap-buttons aren't available.
    const arg = ctx.args.trim();
    if (arg && !binder.sendAgentPicker) {
      const index = Number.parseInt(arg, 10);
      if (!Number.isInteger(index) || index < 1 || index > scopes.length) {
        await ctx.reply(strings.scopesUsage(scopes.length));
        return;
      }
      const target = scopes[index - 1];
      if ((link.workspaceId ?? null) === target.id) {
        await ctx.reply(strings.scopeAlready(target.name));
        return;
      }
      const defaultAgent = await this.applyScopeSwitch(serverDB, link.id, link.userId, target);
      await ctx.reply(strings.scopeSwitched(target.name, defaultAgent?.title));
      return;
    }

    if (binder.sendAgentPicker) {
      await binder.sendAgentPicker(chatId, {
        action: 'scope',
        entries: this.toScopeEntries(scopes, link.workspaceId ?? null),
        // Channel invocation → ephemeral so the user's personal workspace list
        // isn't broadcast (mirrors the `/agents` picker rationale).
        ephemeralTo: ctx.isDM ? undefined : ctx.authorUserId,
        // Discord-only: forward the slash interaction so the binder can
        // complete the deferred reply via the follow-up webhook.
        interaction: ctx.interaction,
        text: strings.scopePicker,
      });
      return;
    }

    // Final fallback: numbered list + usage hint for `/switch <n>`.
    const lines = scopes.map((scope, i) => {
      const marker = (link.workspaceId ?? null) === scope.id ? ` (${strings.currentMarker})` : '';
      return `${i + 1}. ${scope.name}${marker}`;
    });
    await ctx.reply(`${strings.scopesHeading}\n${lines.join('\n')}\n\n${strings.scopesHint}`);
  }

  /**
   * Resolve the user's switchable scopes: Personal (id `null`) followed by
   * each workspace they belong to.
   */
  private async fetchUserScopes(
    serverDB: LobeChatDatabase,
    userId: string,
    platform: MessengerPlatform,
  ): Promise<{ id: string | null; name: string }[]> {
    const personalScope = { id: null, name: getMessengerSystemStrings(platform).personalScope };
    if (!(await isWorkspaceFeatureEnabledForUser(userId))) return [personalScope];

    const workspaces = await new WorkspaceModel(serverDB, userId).listUserWorkspaces();
    return [personalScope, ...workspaces.map((w) => ({ id: w.id, name: w.name }))];
  }

  /**
   * Persist a scope switch and land on the new scope's default agent
   * (inbox/LobeAI is pinned first by `fetchUserAgents`) so switching never
   * leaves the session agent-less. Falls back to `null` only when the target
   * scope has no agents yet.
   */
  private async applyScopeSwitch(
    serverDB: LobeChatDatabase,
    linkId: string,
    userId: string,
    target: { id: string | null; name: string },
  ): Promise<AgentSummary | undefined> {
    const scopeAgents = await this.fetchUserAgents(serverDB, userId, target.id);
    const defaultAgent = scopeAgents[0];
    await MessengerAccountLinkModel.setActiveScope(
      serverDB,
      linkId,
      target.id,
      defaultAgent?.id ?? null,
    );
    return defaultAgent;
  }

  private toScopeEntries(
    scopes: { id: string | null; name: string }[],
    currentScopeId: string | null,
  ): AgentPickerEntry[] {
    return scopes.map((scope) => ({
      id: scope.id ?? PERSONAL_SCOPE_ID,
      isActive: scope.id === currentScopeId,
      title: scope.name,
    }));
  }

  /**
   * Button grids can't render section headings, so the workspace/private
   * distinction rides on the button label instead: private agents get a
   * localized suffix (e.g. `（私人）`). Only applied when the list actually
   * mixes both groups — an all-private or all-workspace list needs no marker.
   */
  private toPickerEntries(
    userAgents: AgentSummary[],
    activeAgentId: string | null | undefined,
    strings: ReturnType<typeof getMessengerSystemStrings>,
  ): AgentPickerEntry[] {
    const privateCount = userAgents.filter((agent) => agent.isPrivate).length;
    const marked = privateCount > 0 && privateCount < userAgents.length;

    return userAgents.map((agent) => ({
      id: agent.id,
      isActive: agent.id === activeAgentId,
      title: marked && agent.isPrivate ? `${agent.title}${strings.privateSuffix}` : agent.title,
    }));
  }

  /**
   * Slack-only welcome on first Messages-tab open. Slack's marketplace
   * listing rule: apps that enable the Messages tab MUST send a welcome
   * the first time any user opens it. The `setIfNotExists` gate makes
   * sure follow-up opens (the same user clicking the tab again, multiple
   * webhook deliveries from Slack's retry policy) stay silent.
   *
   * chat-sdk state is already per-install (Redis keyPrefix in
   * `createChatBot`), so the gate key is implicitly workspace-scoped.
   * Unlinked users get the same Link Account CTA they'd see on a first
   * DM; linked users get a short ready-to-chat note with the active
   * agent name.
   */
  private async handleAppHomeOpened(
    bot: RegisteredMessengerBot,
    creds: InstallationCredentials,
    event: { channelId: string; userId: string },
  ): Promise<void> {
    const stateAdapter = bot.chatBot.getState();
    const gateKey = `app_home_welcomed:${event.userId}`;
    try {
      const fresh = await stateAdapter.setIfNotExists(gateKey, '1');
      if (!fresh) return;
    } catch (error) {
      log('handleAppHomeOpened: dedupe gate failed: %O', error);
      return;
    }

    try {
      const serverDB = await getServerDB();
      const link = await MessengerAccountLinkModel.findByPlatformUser(
        serverDB,
        creds.platform,
        event.userId,
        creds.tenantId,
      );

      if (!link) {
        await bot.binder.handleUnlinkedMessage({
          authorUserId: event.userId,
          chatId: event.channelId,
        });
        return;
      }

      let activeAgentName: string | undefined;
      if (link.activeAgentId) {
        const userAgents = await this.fetchUserAgents(serverDB, link.userId, link.workspaceId);
        activeAgentName = userAgents.find((a) => a.id === link.activeAgentId)?.title;
      }

      const text = activeAgentName
        ? `Welcome to LobeHub! Your active agent is *${activeAgentName}*. Send a message to chat, or use \`/agents\` to switch.`
        : 'Welcome to LobeHub! Send `/agents` to pick an active agent and start chatting.';
      await bot.binder.sendDmText(event.channelId, text);
    } catch (error) {
      log('handleAppHomeOpened: dispatch failed: %O', error);
    }
  }

  /**
   * Slack `member_joined_channel` welcome. Fires the first time the bot
   * itself joins a channel (via `/invite @LobeHub` or being added through the
   * channel settings). Slack retries `member_joined_channel` aggressively on
   * 5xx, and re-adding-then-removing-then-re-adding a bot would fire it again,
   * so `setIfNotExists` keys on the channel id to keep the greeting one-shot.
   *
   * The message lives in the channel (not as an ephemeral) because every
   * member should see what the bot is and how to start. Account linking is
   * intentionally pushed to a DM in the copy — verify-im URLs are personal
   * and must never be broadcast to the channel.
   */
  private async handleChannelJoin(
    chatBot: Chat<any>,
    binder: MessengerPlatformBinder,
    channelId: string,
  ): Promise<void> {
    const stateAdapter = chatBot.getState();
    const gateKey = `channel_welcomed:${channelId}`;
    try {
      const fresh = await stateAdapter.setIfNotExists(gateKey, '1');
      if (!fresh) return;
    } catch (error) {
      log('handleChannelJoin: dedupe gate failed: %O', error);
      return;
    }

    const text = [
      ":wave: Hi, I'm *LobeHub* — your AI agent on Slack.",
      '',
      '• Mention me with `@LobeHub <your question>` to chat in this channel.',
      '• First time? Send me a *direct message* to link your LobeHub account.',
      '• Use `/agents` in DM to switch the active agent.',
    ].join('\n');

    try {
      await binder.sendDmText(channelId, text);
    } catch (error) {
      log('handleChannelJoin: send failed: %O', error);
    }
  }

  /**
   * Run a tap-action surfaced by either the binder's webhook-time peek
   * (Slack/Telegram) or chat-sdk's `onAction` event (Discord). Both paths
   * normalize to the same `InboundCallbackAction` shape and delegate the
   * outbound ack (toast + picker re-render) to `binder.acknowledgeCallback`.
   * Recognizes `messenger:switch:<agentId>` (agent picker) and
   * `messenger:scope:<scopeId>` (scope picker); new actions can be added by
   * extending the dispatch below.
   */
  private async handleCallbackAction(
    binder: MessengerPlatformBinder,
    creds: InstallationCredentials,
    action: InboundCallbackAction,
  ): Promise<void> {
    if (!binder.acknowledgeCallback) return;

    const ack = binder.acknowledgeCallback.bind(binder, action);
    const strings = getMessengerSystemStrings(creds.platform);

    const scopeMatch = action.data.match(/^messenger:scope:(.+)$/);
    if (scopeMatch) {
      await this.handleScopeCallback(creds, action, scopeMatch[1], ack);
      return;
    }

    const switchMatch = action.data.match(/^messenger:switch:(.+)$/);
    if (!switchMatch) {
      await ack({ toast: strings.unknownAction });
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
      await ack({ toast: strings.notLinked });
      return;
    }

    const userAgents = await this.fetchUserAgents(serverDB, link.userId, link.workspaceId);
    const target = userAgents.find((agent) => agent.id === targetAgentId);
    if (!target) {
      await ack({ toast: strings.agentNotFound });
      return;
    }

    if (link.activeAgentId === targetAgentId) {
      await ack({ toast: strings.activeAgentAlreadyToast(target.title) });
      return;
    }

    await MessengerAccountLinkModel.setActiveAgentById(serverDB, link.id, targetAgentId);
    await ack({
      toast: strings.activeAgentChangedToast(target.title),
      updatedPicker: {
        entries: this.toPickerEntries(userAgents, targetAgentId, strings),
        text: strings.receiveMessagesPicker,
      },
    });
  }

  /**
   * Handle a tap on a `/switch` scope button (`messenger:scope:<scopeId>`).
   * `scopeToken` is the workspace id, or `PERSONAL_SCOPE_ID` for Personal.
   * Switches the active scope (landing on the scope's default agent) and
   * re-renders the picker with the new current marker.
   */
  private async handleScopeCallback(
    creds: InstallationCredentials,
    action: InboundCallbackAction,
    scopeToken: string,
    ack: (ack: CallbackAcknowledgement) => Promise<void>,
  ): Promise<void> {
    const strings = getMessengerSystemStrings(creds.platform);
    const serverDB = await getServerDB();
    const link = await MessengerAccountLinkModel.findByPlatformUser(
      serverDB,
      creds.platform,
      action.fromUserId,
      creds.tenantId,
    );
    if (!link) {
      await ack({ toast: strings.notLinked });
      return;
    }

    const targetScopeId = scopeToken === PERSONAL_SCOPE_ID ? null : scopeToken;
    const scopes = await this.fetchUserScopes(serverDB, link.userId, creds.platform);
    const target = scopes.find((scope) => scope.id === targetScopeId);
    if (!target) {
      await ack({ toast: strings.scopeNotFound });
      return;
    }

    if ((link.workspaceId ?? null) === target.id) {
      await ack({ toast: strings.scopeAlready(target.name) });
      return;
    }

    const defaultAgent = await this.applyScopeSwitch(serverDB, link.id, link.userId, target);
    await ack({
      toast: strings.scopeSwitched(target.name, defaultAgent?.title),
      updatedPicker: {
        action: 'scope',
        entries: this.toScopeEntries(scopes, target.id),
        text: strings.scopePicker,
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
    workspaceId?: string | null,
  ): Promise<AgentSummary[]> {
    // The filter, ordering, pinning, and title fallback all live in the model.
    // This text-only channel has no client-side i18n default, so it asks the
    // model to fill blank titles with a generic "Custom Agent" label.
    const rows = await new AgentModel(
      serverDB,
      userId,
      workspaceId ?? undefined,
    ).listMessengerBindableAgents({ fallbackTitle: 'Custom Agent' });

    // `fallbackTitle` guarantees a non-null title for every row.
    const summaries = rows.map((row) => ({
      id: row.id,
      isPrivate: row.isPrivate,
      title: row.title!,
    }));

    // Workspace scope: stable-partition shared workspace agents ahead of the
    // caller's private ones so every surface (text list, pickers, the default
    // agent picked on scope switch) presents the two groups consistently.
    // Personal scope is untouched — `isPrivate` is always false there.
    return [
      ...summaries.filter((agent) => !agent.isPrivate),
      ...summaries.filter((agent) => agent.isPrivate),
    ];
  }

  private async dispatchToAgent(
    thread: any,
    message: Message,
    client: PlatformClient,
    link: SafeMessengerAccountLink,
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
    const bridge = new AgentBridgeService(serverDB, link.userId, link.workspaceId ?? undefined);

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
