import { createIoRedisState } from '@chat-adapter/state-ioredis';
import { INBOX_SESSION_ID } from '@lobechat/const';
import { Chat, ConsoleLogger, type Message, type MessageContext } from 'chat';
import debug from 'debug';
import { and, desc, eq, ne, or } from 'drizzle-orm';

import { getEnabledMessengerPlatforms, type MessengerPlatform } from '@/config/messenger';
import { getServerDB } from '@/database/core/db-adaptor';
import { MessengerAccountLinkModel } from '@/database/models/messengerAccountLink';
import type { MessengerAccountLinkItem } from '@/database/schemas';
import { agents } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { appEnv } from '@/envs/app';
import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';
import { AiAgentService } from '@/server/services/aiAgent';
import { AgentBridgeService } from '@/server/services/bot/AgentBridgeService';
import type { PlatformClient } from '@/server/services/bot/platforms';
import { renderInlineError } from '@/server/services/bot/replyTemplate';

import { MessengerSlackBinder } from './platforms/slack';
import { MessengerTelegramBinder } from './platforms/telegram';
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
 * Routes inbound messages from the shared Messenger bots (one per platform,
 * credentials in env) to the right LobeHub user + agent.
 *
 * Account model: each user binds their IM account to LobeHub ONCE per
 * platform (one row in `messenger_account_links`). The `activeAgentId` column
 * tracks which of the user's agents currently receives messages — switchable
 * via `/agents` (tap to switch) or the web UI without re-running verify-im.
 */
export class MessengerRouter {
  private bots = new Map<MessengerPlatform, RegisteredMessengerBot>();
  private loadingPromises = new Map<MessengerPlatform, Promise<RegisteredMessengerBot | null>>();

  /**
   * Webhook handler for `/api/agent/messenger/webhooks/[platform]`. Returns 404
   * if the platform is not enabled (no env credentials configured).
   */
  getWebhookHandler(platform: string): (req: Request) => Promise<Response> {
    return async (req: Request) => {
      if (!isMessengerPlatform(platform)) {
        return new Response(`Unknown messenger platform: ${platform}`, { status: 404 });
      }

      const bot = await this.getOrCreateBot(platform);
      if (!bot) {
        return new Response(`Messenger ${platform} bot not configured`, { status: 404 });
      }

      // Intercept tap-action callbacks before chat-sdk: Telegram's
      // callback_query / Slack's interactive payload aren't surfaced through
      // chat-sdk's onNewMessage / onDirectMessage, so binders peek the raw
      // body and the router orchestrates the response. Each binder owns its
      // own body parsing because the wire formats differ (Telegram = JSON,
      // Slack = form-urlencoded).
      if (bot.binder.extractCallbackAction) {
        try {
          const action = await bot.binder.extractCallbackAction(req.clone());
          if (action) {
            await this.handleCallbackAction(bot, platform, action);
            return new Response('OK', { status: 200 });
          }
        } catch (error) {
          log('extractCallbackAction failed for %s: %O', platform, error);
        }
      }

      const handler = (bot.chatBot.webhooks as any)?.[platform];
      if (!handler) {
        return new Response(`Messenger ${platform} webhook unavailable`, { status: 500 });
      }

      return handler(req);
    };
  }

  /** List platforms with valid env config (used by UI / TRPC `availablePlatforms`). */
  static listEnabledPlatforms(): MessengerPlatform[] {
    return getEnabledMessengerPlatforms();
  }

  /**
   * Connect every enabled messenger platform so inbound messages reach us.
   * Today this means registering a webhook against
   * `${WEBHOOK_PUBLIC_URL}/api/agent/messenger/webhooks/<platform>`; future
   * platforms may use polling or a gateway instead.
   *
   * Idempotent — safe to call on every server start and on every cloud cron
   * tick. Per-platform failures are isolated and logged so a misconfigured
   * platform never blocks the others.
   */
  async ensureConnected(): Promise<void> {
    const url = appEnv.WEBHOOK_PUBLIC_URL;
    if (!url) {
      log('ensureConnected: no WEBHOOK_PUBLIC_URL configured');
      return;
    }
    const trimmedUrl = url.replace(/\/$/, '');
    const platforms = getEnabledMessengerPlatforms();
    if (platforms.length === 0) {
      log('ensureConnected: no enabled messenger platforms');
      return;
    }

    await Promise.all(
      platforms.map(async (platform) => {
        const binder = this.createBinder(platform);
        if (!binder) {
          log('ensureConnected: %s has no binder yet, skipping', platform);
          return;
        }

        const webhookUrl = `${trimmedUrl}/api/agent/messenger/webhooks/${platform}`;
        try {
          await binder.registerWebhook({ webhookUrl });
          log('ensureConnected: %s registered -> %s', platform, webhookUrl);
        } catch (error) {
          log('ensureConnected: %s failed: %O', platform, error);
        }
      }),
    );
  }

  private async getOrCreateBot(
    platform: MessengerPlatform,
  ): Promise<RegisteredMessengerBot | null> {
    const existing = this.bots.get(platform);
    if (existing) return existing;

    const inflight = this.loadingPromises.get(platform);
    if (inflight) return inflight;

    const promise = this.loadBot(platform);
    this.loadingPromises.set(platform, promise);

    try {
      return await promise;
    } finally {
      this.loadingPromises.delete(platform);
    }
  }

  private async loadBot(platform: MessengerPlatform): Promise<RegisteredMessengerBot | null> {
    const binder = this.createBinder(platform);
    if (!binder) {
      log('loadBot: no binder available for %s', platform);
      return null;
    }

    const client = binder.createClient();
    if (!client) {
      log('loadBot: binder %s returned no client (missing env?)', platform);
      return null;
    }

    const adapters = client.createAdapter();
    const chatBot = this.createChatBot(adapters, platform);

    const serverDB = await getServerDB();
    this.registerHandlers(chatBot, serverDB, client, binder, platform);

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
        .catch((error) => log('registerBotCommands failed for %s: %O', platform, error));
    }

    const registered: RegisteredMessengerBot = { binder, chatBot, client };
    this.bots.set(platform, registered);

    log('loadBot: registered messenger %s bot', platform);
    return registered;
  }

  private createBinder(platform: MessengerPlatform): MessengerPlatformBinder | null {
    switch (platform) {
      case 'telegram': {
        return new MessengerTelegramBinder();
      }
      case 'slack': {
        return new MessengerSlackBinder();
      }
      default: {
        return null;
      }
    }
  }

  private createChatBot(adapters: Record<string, any>, platform: MessengerPlatform): Chat<any> {
    const config: any = {
      adapters,
      concurrency: 'queue',
      userName: `messenger-bot-${platform}`,
    };

    const redisClient = getAgentRuntimeRedisClient();
    if (redisClient) {
      config.state = createIoRedisState({
        client: redisClient,
        keyPrefix: `chat-sdk:messenger-${platform}`,
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
    platform: MessengerPlatform,
  ): void {
    const handle = async (thread: any, message: Message): Promise<void> => {
      if (message.author.isBot === true) return;

      const senderId = message.author.userId;
      if (!senderId) {
        log('handle: missing author.userId, dropping');
        return;
      }

      const chatId = client.extractChatId(thread.id);
      const link = await MessengerAccountLinkModel.findByPlatformUser(serverDB, platform, senderId);

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
      log('onDirectMessage: platform=%s, msgId=%s', platform, (message as any).id);
      try {
        await thread.subscribe();
      } catch {
        /* idempotent — first contact creates the subscription, later calls no-op */
      }
      await handle(thread, message);
    });

    bot.onSubscribedMessage(async (thread, message, _context?: MessageContext) => {
      log('onSubscribedMessage: platform=%s, msgId=%s', platform, (message as any).id);
      await handle(thread, message);
    });
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
        await this.handleAgentsCommand({ binder, chatId, command, link, serverDB });
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
      'dispatchToAgent: platform=%s, sender=%s, agent=%s, user=%s',
      platform,
      link.platformUserId,
      agentId,
      link.userId,
    );

    const serverDB = await getServerDB();
    const bridge = new AgentBridgeService(serverDB, link.userId);

    await bridge.handleMention(thread, message, {
      agentId,
      botContext: {
        applicationId: `messenger-${platform}`,
        platform,
        platformThreadId: thread.id,
      },
      client,
    });
  }
}

const isMessengerPlatform = (platform: string): platform is MessengerPlatform =>
  platform === 'telegram' || platform === 'slack';

let singleton: MessengerRouter | undefined;

export const getMessengerRouter = (): MessengerRouter => {
  if (!singleton) singleton = new MessengerRouter();
  return singleton;
};
