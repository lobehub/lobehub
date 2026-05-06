import { createIoRedisState } from '@chat-adapter/state-ioredis';
import { INBOX_SESSION_ID } from '@lobechat/const';
import {
  type ActionEvent,
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
import type {
  AgentPickerEntry,
  CallbackAcknowledgement,
  InboundCallbackAction,
  MessengerPlatformBinder,
} from './types';

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
 */
export class MessengerRouter {
  private bots = new Map<string, RegisteredMessengerBot>();
  private loadingPromises = new Map<string, Promise<RegisteredMessengerBot | null>>();

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
            await this.handleCallbackAction(bot, definition.id, creds, action);
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
    const binder = this.createBinder(creds);
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
        .registerBotCommands([
          { command: 'start', description: 'Bind your account to LobeHub' },
          { command: 'agents', description: 'List agents and switch the active one' },
          { command: 'new', description: 'Start a new conversation' },
          { command: 'stop', description: 'Stop the current execution' },
          { command: 'help', description: 'Show usage' },
        ])
        .catch((error) =>
          log('registerBotCommands failed for %s: %O', creds.installationKey, error),
        );
    }

    const registered: RegisteredMessengerBot = { binder, chatBot, client, creds };
    this.bots.set(creds.installationKey, registered);

    log('loadBot: registered messenger %s bot', creds.installationKey);
    return registered;
  }

  private createBinder(creds: InstallationCredentials): MessengerPlatformBinder | null {
    return messengerPlatformRegistry.createBinder(creds);
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
        const command = parseCommand(message.text);
        if (command) {
          const handled = await this.handleCommand({
            authorUserId: senderId,
            authorUserName: message.author.userName,
            binder,
            chatId,
            command,
            link,
            message,
            platform,
            serverDB,
            tenantId,
            thread,
          });
          if (handled) return;
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

    // Slack slash commands — `/agents`, `/new`, `/stop`. Telegram routes
    // commands via message text (parsed by `parseCommand` above), so we only
    // wire this for Slack. `/start` isn't registered: Slack apps bind via
    // OAuth and the per-user link flow auto-fires on first DM, so a manual
    // /start would be redundant. `bot` is a per-install Chat SDK instance, so
    // the registration is scoped correctly.
    if (platform === 'slack') {
      bot.onSlashCommand(['/agents', '/new', '/stop'], async (event) => {
        await this.handleSlackSlashCommand({ binder, client, event, serverDB, tenantId });
      });
    }

    // Discord slash commands — `/agents`, `/new`, `/stop`, `/help`. Discord
    // DMs have no ephemeral concept (the user IS the only other party), so
    // replies are just regular DM posts.
    //
    // `/start` is intentionally NOT wired to the slash path: it's still
    // registered as a Discord global command (so it shows up in autocomplete)
    // but invoking it goes through the unlinked-message text path inside the
    // DM — `handleUnlinkedMessage` needs a real chat-sdk `Message` instance
    // that the slash event doesn't surface, and stub-message workarounds were
    // ugly. Users who type `/start` as plain text in the DM still hit the
    // full link flow via `parseCommand`.
    if (platform === 'discord') {
      bot.onSlashCommand(['/agents', '/new', '/stop', '/help'], async (event) => {
        await this.handleDiscordSlashCommand({ binder, client, event, serverDB, tenantId });
      });

      // Discord interactive picker buttons. Slack/Telegram both peek the raw
      // webhook bytes via `binder.extractCallbackAction` and short-circuit to
      // a `200 OK` ack — that doesn't work for Discord because Discord
      // interactions need a JSON `{type: 6}` ack body. So instead we let
      // `@chat-adapter/discord` handle the inbound interaction (it ack's with
      // `DeferredUpdateMessage` on its own), then drive the actual state
      // update from `bot.onAction`.
      bot.onAction(async (event) => {
        await this.handleDiscordButtonAction({ binder, client, creds, event, serverDB });
      });
    }
  }

  /**
   * One handler for every Slack slash command we register. Replies ephemerally
   * so output is private regardless of where the slash was invoked. `/new` and
   * `/stop` need a live chat-sdk `thread` instance the slash command path
   * doesn't surface, so we ack with a hint to type them inside the bot DM
   * where `parseCommand` still picks them up.
   */
  private async handleSlackSlashCommand(params: {
    binder: MessengerPlatformBinder;
    client: PlatformClient;
    event: SlashCommandEvent;
    serverDB: LobeChatDatabase;
    tenantId: string;
  }): Promise<void> {
    const { binder, client, event, serverDB, tenantId } = params;
    const senderId = event.user.userId;
    if (!senderId) {
      log('handleSlackSlashCommand: missing user id, dropping');
      return;
    }

    // `event.command` is the literal "/foo" Slack sent.
    const cmd = event.command.replace(/^\//, '').toLowerCase();
    // chat-sdk wraps the raw channel id as `slack:<channel>` — strip the
    // prefix so direct Slack API calls (postMessage / postEphemeral) get the
    // bare channel id Slack expects.
    const chatId = client.extractChatId((event.channel as any).id as string);

    const replyEphemeral = async (text: string): Promise<void> => {
      try {
        await event.channel.postEphemeral(event.user, text, { fallbackToDM: true });
      } catch (error) {
        log('handleSlackSlashCommand: postEphemeral failed: %O', error);
      }
    };

    const link = await MessengerAccountLinkModel.findByPlatformUser(
      serverDB,
      'slack',
      senderId,
      tenantId,
    );

    try {
      switch (cmd) {
        case 'agents': {
          await this.handleAgentsCommand({
            binder,
            chatId,
            command: { args: event.text.trim(), name: 'agents' },
            link,
            serverDB,
            tenantId,
          });
          return;
        }
        case 'new':
        case 'stop': {
          await replyEphemeral(
            `Open your direct message with the LobeHub bot and send \`/${cmd}\` there.`,
          );
          return;
        }
        default: {
          await replyEphemeral(`Unknown command: /${cmd}`);
        }
      }
    } catch (error) {
      log('handleSlackSlashCommand: handler error: %O', error);
      await replyEphemeral('Something went wrong.');
    }
  }

  /**
   * Discord slash command dispatcher. Mirrors `handleSlackSlashCommand` but
   * without ephemeral plumbing — Discord DMs are private by definition, so
   * regular `binder.sendDmText` is the right reply mechanism.
   *
   * `/new` and `/stop` need a chat-sdk `thread` instance the slash command
   * path doesn't surface (same constraint as Slack), so we ack with a hint
   * to send them as plain text in the DM where `parseCommand` reaches the
   * full command handler with thread access.
   */
  private async handleDiscordSlashCommand(params: {
    binder: MessengerPlatformBinder;
    client: PlatformClient;
    event: SlashCommandEvent;
    serverDB: LobeChatDatabase;
    tenantId: string;
  }): Promise<void> {
    const { binder, client, event, serverDB, tenantId } = params;
    const senderId = event.user.userId;
    if (!senderId) {
      log('handleDiscordSlashCommand: missing user id, dropping');
      return;
    }

    const cmd = event.command.replace(/^\//, '').toLowerCase();
    // chat-sdk wraps the raw channel id as `discord:guildId:channelId[:threadId]`;
    // strip back to the bare channel id Discord's REST API expects.
    const chatId = client.extractChatId((event.channel as any).id as string);

    const link = await MessengerAccountLinkModel.findByPlatformUser(
      serverDB,
      'discord',
      senderId,
      tenantId,
    );

    try {
      switch (cmd) {
        case 'agents': {
          await this.handleAgentsCommand({
            binder,
            chatId,
            command: { args: event.text.trim(), name: 'agents' },
            link,
            serverDB,
            tenantId,
          });
          return;
        }
        case 'new':
        case 'stop': {
          await binder.sendDmText(chatId, `Send \`/${cmd}\` as a regular message in this DM.`);
          return;
        }
        case 'help': {
          await binder.sendDmText(
            chatId,
            [
              'Commands:',
              '• /agents — list your agents and switch the active one',
              '• /new — start a new conversation',
              '• /stop — stop the current execution',
              '• /start — bind a different LobeHub account',
            ].join('\n'),
          );
          return;
        }
        default: {
          await binder.sendDmText(chatId, `Unknown command: /${cmd}`);
        }
      }
    } catch (error) {
      log('handleDiscordSlashCommand: handler error: %O', error);
      try {
        await binder.sendDmText(chatId, 'Something went wrong.');
      } catch {
        /* ignore */
      }
    }
  }

  /**
   * Discord interactive picker button handler. Fires after `@chat-adapter/discord`
   * has already ack'd the interaction with `DeferredUpdateMessage` (`type: 6`),
   * so we have the full ~15-minute follow-up window to update state and
   * re-render the picker — no 3-second pressure.
   *
   * Mirrors `handleCallbackAction` (the Slack/Telegram path) but goes direct
   * to `binder.updateAgentPicker` + `binder.sendDmText` since Discord's flow
   * doesn't go through `binder.acknowledgeCallback`.
   */
  private async handleDiscordButtonAction(params: {
    binder: MessengerPlatformBinder;
    client: PlatformClient;
    creds: InstallationCredentials;
    event: ActionEvent;
    serverDB: LobeChatDatabase;
  }): Promise<void> {
    const { binder, client, creds, event, serverDB } = params;

    const actionId = event.actionId ?? '';
    const switchMatch = actionId.match(/^messenger:switch:(.+)$/);
    if (!switchMatch) {
      // Not our button — could be a future picker, an unrelated chat-sdk
      // action, etc. Ignore quietly so we don't spam logs.
      return;
    }

    const targetAgentId = switchMatch[1];
    const senderId = event.user?.userId;
    if (!senderId) {
      log('handleDiscordButtonAction: missing user id, dropping');
      return;
    }

    const chatId = client.extractChatId(event.threadId);
    const messageId = event.messageId;

    const link = await MessengerAccountLinkModel.findByPlatformUser(
      serverDB,
      'discord',
      senderId,
      creds.tenantId,
    );
    if (!link) {
      await binder.sendDmText(chatId, 'Not linked. Send /start first.');
      return;
    }

    const userAgents = await this.fetchUserAgents(serverDB, link.userId);
    const target = userAgents.find((agent) => agent.id === targetAgentId);
    if (!target) {
      await binder.sendDmText(chatId, 'Agent not found.');
      return;
    }

    if (link.activeAgentId === targetAgentId) {
      await binder.sendDmText(chatId, `${target.title} is already active.`);
      return;
    }

    await MessengerAccountLinkModel.setActiveAgentById(serverDB, link.id, targetAgentId);

    const updateAgentPicker = (binder as any).updateAgentPicker as
      | ((
          chatId: string,
          messageId: string,
          params: { entries: AgentPickerEntry[]; text: string },
        ) => Promise<void>)
      | undefined;
    if (updateAgentPicker && messageId) {
      await updateAgentPicker.call(binder, chatId, messageId, {
        entries: this.toPickerEntries(userAgents, targetAgentId),
        text: 'Pick an agent to receive your messages:',
      });
    }

    await binder.sendDmText(chatId, `Switched to ${target.title}.`);
  }

  /**
   * Returns true when the inbound message was a recognized messenger command and
   * the router replied (so the caller skips agent dispatch).
   */
  private async handleCommand(params: {
    authorUserId: string;
    authorUserName?: string;
    binder: MessengerPlatformBinder;
    chatId: string;
    command: CommandMatch;
    link: MessengerAccountLinkItem | undefined;
    message: Message;
    platform: MessengerPlatform;
    serverDB: LobeChatDatabase;
    tenantId: string;
    thread: any;
  }): Promise<boolean> {
    const {
      authorUserId,
      authorUserName,
      binder,
      chatId,
      command,
      link,
      message,
      serverDB,
      tenantId,
      thread,
    } = params;

    switch (command.name) {
      case 'start': {
        // /start always offers a fresh link button — covers both first-time
        // bind and "I want to switch the IM account this LobeHub user is
        // bound to".
        await binder.handleUnlinkedMessage({
          authorUserId,
          authorUserName,
          chatId,
          message,
        });
        return true;
      }
      case 'agents': {
        await this.handleAgentsCommand({ binder, chatId, command, link, serverDB, tenantId });
        return true;
      }
      case 'new': {
        if (!link) {
          await binder.sendDmText(chatId, 'You need to /start to bind your account first.');
          return true;
        }
        // Drop the cached topicId so the next message starts a fresh topic.
        // Mirrors `/new` in the bot router (BotMessageRouter.buildCommands).
        try {
          await thread.setState({ topicId: undefined }, { replace: true });
        } catch (error) {
          log('handleCommand[/new]: setState failed: %O', error);
        }
        await binder.sendDmText(
          chatId,
          'Started a new conversation. Your next message begins a fresh topic.',
        );
        return true;
      }
      case 'stop': {
        if (!link) {
          await binder.sendDmText(chatId, 'You need to /start to bind your account first.');
          return true;
        }
        const isActive = AgentBridgeService.isThreadActive(thread.id);
        if (!isActive) {
          await binder.sendDmText(chatId, 'No active execution to stop.');
          return true;
        }
        const operationId = AgentBridgeService.getActiveOperationId(thread.id);
        if (operationId) {
          try {
            const aiAgentService = new AiAgentService(serverDB, link.userId);
            const result = await aiAgentService.interruptTask({ operationId });
            if (!result.success) {
              log('handleCommand[/stop]: runtime interrupt rejected for op=%s', operationId);
              await binder.sendDmText(chatId, 'Unable to stop the current execution.');
              return true;
            }
            AgentBridgeService.clearActiveThread(thread.id);
            log('handleCommand[/stop]: interrupted op=%s', operationId);
          } catch (error) {
            log('handleCommand[/stop]: interruptTask failed: %O', error);
            await binder.sendDmText(chatId, 'Unable to stop the current execution.');
            return true;
          }
        } else {
          // execAgent hasn't returned an operationId yet — queue the stop so it
          // fires the moment startup completes.
          AgentBridgeService.requestStop(thread.id);
          log('handleCommand[/stop]: queued deferred stop for thread=%s', thread.id);
        }
        await binder.sendDmText(chatId, 'Stop requested.');
        return true;
      }
      case 'help': {
        await binder.sendDmText(
          chatId,
          [
            'Commands:',
            '• /agents — list your agents and tap to switch the active one',
            '• /new — start a new conversation',
            '• /stop — stop the current execution',
            '• /start — bind a different LobeHub account',
          ].join('\n'),
        );
        return true;
      }
      default: {
        // Unknown slash commands pass through to the agent so legitimate
        // "/foo" prompts the user typed still reach them.
        return false;
      }
    }
  }

  /**
   * `/agents` is the single command for both listing agents and switching the
   * active one — on Telegram (and any platform that implements
   * `sendAgentPicker`) the bot replies with a tap-to-switch inline keyboard.
   * Platforms without keyboard support fall back to a numbered text list +
   * `/agents <n>` syntax for switching.
   */
  private async handleAgentsCommand(params: {
    binder: MessengerPlatformBinder;
    chatId: string;
    command?: CommandMatch;
    link: MessengerAccountLinkItem | undefined;
    serverDB: LobeChatDatabase;
    tenantId: string;
  }): Promise<void> {
    const { binder, chatId, command, link, serverDB } = params;

    if (!link) {
      await binder.sendDmText(chatId, 'You need to /start to bind your account first.');
      return;
    }

    const userAgents = await this.fetchUserAgents(serverDB, link.userId);
    if (userAgents.length === 0) {
      await binder.sendDmText(
        chatId,
        'You have no agents yet. Create one in LobeHub, then come back to /agents.',
      );
      return;
    }

    // Text-fallback path: `/agents 2` switches without needing the keyboard,
    // for platforms (or clients) where tap-buttons aren't available.
    const args = command?.args?.trim() ?? '';
    if (args && !binder.sendAgentPicker) {
      const index = Number.parseInt(args, 10);
      if (!Number.isInteger(index) || index < 1 || index > userAgents.length) {
        await binder.sendDmText(
          chatId,
          `Usage: /agents <n>, where n is between 1 and ${userAgents.length}.`,
        );
        return;
      }
      const target = userAgents[index - 1];
      if (link.activeAgentId === target.id) {
        await binder.sendDmText(chatId, `${target.title} is already the active agent.`);
        return;
      }
      await MessengerAccountLinkModel.setActiveAgentById(serverDB, link.id, target.id);
      await binder.sendDmText(
        chatId,
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
    await binder.sendDmText(
      chatId,
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
   * Run a tap-action surfaced by `binder.extractCallbackAction`. Today only
   * `messenger:switch:<agentId>` is recognized; new actions can be added by
   * extending the switch.
   */
  private async handleCallbackAction(
    bot: RegisteredMessengerBot,
    platform: MessengerPlatform,
    creds: InstallationCredentials,
    action: InboundCallbackAction,
  ): Promise<void> {
    const { binder } = bot;
    if (!binder.acknowledgeCallback) return;

    const ack = (params: CallbackAcknowledgement) => binder.acknowledgeCallback!(action, params);

    const switchMatch = action.data.match(/^messenger:switch:(.+)$/);
    if (!switchMatch) {
      await ack({ toast: 'Unknown action.' });
      return;
    }

    const targetAgentId = switchMatch[1];
    const serverDB = await getServerDB();
    const link = await MessengerAccountLinkModel.findByPlatformUser(
      serverDB,
      platform,
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
