import { createIoRedisState } from '@chat-adapter/state-ioredis';
import { Chat, ConsoleLogger, type Message, type MessageContext } from 'chat';
import debug from 'debug';
import { asc, eq } from 'drizzle-orm';

import { getEnabledMessengerPlatforms, type MessengerPlatform } from '@/config/messenger';
import { getServerDB } from '@/database/core/db-adaptor';
import { MessengerAccountLinkModel } from '@/database/models/messengerAccountLink';
import type { MessengerAccountLinkItem } from '@/database/schemas';
import { agents } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { appEnv } from '@/envs/app';
import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';
import { AgentBridgeService } from '@/server/services/bot/AgentBridgeService';
import type { PlatformClient } from '@/server/services/bot/platforms';
import { renderInlineError } from '@/server/services/bot/replyTemplate';

import { MessengerTelegramBinder } from './platforms/telegram';
import type { MessengerPlatformBinder } from './types';

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
 * via `/switch` or the web UI without re-running verify-im.
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
          { command: 'agents', description: 'List your agents' },
          { command: 'switch', description: 'Switch the active agent (e.g. /switch 2)' },
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

        // Bound but no active agent → tell user to /switch
        if (!link.activeAgentId) {
          await binder.sendDmText(
            chatId,
            'No active agent selected. Use /agents to list your agents and /switch <n> to pick one.',
          );
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
  }): Promise<boolean> {
    const { authorUserId, authorUserName, binder, chatId, command, link, message, serverDB } =
      params;

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
        await this.handleAgentsCommand({ binder, chatId, link, serverDB });
        return true;
      }
      case 'switch': {
        await this.handleSwitchCommand({
          args: command.args,
          binder,
          chatId,
          link,
          serverDB,
        });
        return true;
      }
      case 'help': {
        await binder.sendDmText(
          chatId,
          [
            'Commands:',
            '• /agents — list your agents',
            '• /switch <n> — switch the active agent (e.g. /switch 2)',
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

  private async handleAgentsCommand(params: {
    binder: MessengerPlatformBinder;
    chatId: string;
    link: MessengerAccountLinkItem | undefined;
    serverDB: LobeChatDatabase;
  }): Promise<void> {
    const { binder, chatId, link, serverDB } = params;

    if (!link) {
      await binder.sendDmText(chatId, 'You need to /start to bind your account first.');
      return;
    }

    const userAgents = await this.fetchUserAgents(serverDB, link.userId);
    if (userAgents.length === 0) {
      await binder.sendDmText(
        chatId,
        'You have no agents yet. Create one in LobeHub, then come back and use /switch.',
      );
      return;
    }

    const lines = userAgents.map((agent, i) => {
      const marker = link.activeAgentId === agent.id ? ' (active)' : '';
      return `${i + 1}. ${agent.title}${marker}`;
    });
    await binder.sendDmText(
      chatId,
      `Your agents:\n${lines.join('\n')}\n\nUse /switch <n> to change the active agent.`,
    );
  }

  private async handleSwitchCommand(params: {
    args: string;
    binder: MessengerPlatformBinder;
    chatId: string;
    link: MessengerAccountLinkItem | undefined;
    serverDB: LobeChatDatabase;
  }): Promise<void> {
    const { args, binder, chatId, link, serverDB } = params;

    if (!link) {
      await binder.sendDmText(chatId, 'You need to /start to bind your account first.');
      return;
    }

    const userAgents = await this.fetchUserAgents(serverDB, link.userId);
    if (userAgents.length === 0) {
      await binder.sendDmText(
        chatId,
        'You have no agents yet. Create one in LobeHub, then come back and use /switch.',
      );
      return;
    }

    const index = Number.parseInt(args, 10);
    if (!Number.isInteger(index) || index < 1 || index > userAgents.length) {
      await binder.sendDmText(
        chatId,
        `Usage: /switch <n>, where n is between 1 and ${userAgents.length}. Use /agents to see the list.`,
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
  }

  /** Fetch a user's agents in stable order (asc by accessedAt → oldest first). */
  private async fetchUserAgents(
    serverDB: LobeChatDatabase,
    userId: string,
  ): Promise<AgentSummary[]> {
    const rows = await serverDB
      .select({ id: agents.id, title: agents.title })
      .from(agents)
      .where(eq(agents.userId, userId))
      .orderBy(asc(agents.accessedAt));

    return rows
      .filter((row) => row.id)
      .map((row) => ({
        id: row.id,
        title: row.title ?? `Agent ${row.id.slice(0, 8)}`,
      }));
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
