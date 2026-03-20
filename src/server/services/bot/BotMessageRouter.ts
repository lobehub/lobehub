import { createIoRedisState } from '@chat-adapter/state-ioredis';
import { Chat, ConsoleLogger } from 'chat';
import debug from 'debug';

import { getServerDB } from '@/database/core/db-adaptor';
import type { DecryptedBotProvider } from '@/database/models/agentBotProvider';
import { AgentBotProviderModel } from '@/database/models/agentBotProvider';
import type { LobeChatDatabase } from '@/database/type';
import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

import { AgentBridgeService } from './AgentBridgeService';
import {
  type BotPlatformRuntimeContext,
  type BotProviderConfig,
  buildRuntimeKey,
  type PlatformClient,
  type PlatformDefinition,
  platformRegistry,
} from './platforms';

const log = debug('lobe-server:bot:message-router');

interface ResolvedAgentInfo {
  agentId: string;
  userId: string;
}

interface RegisteredBot {
  agentInfo: ResolvedAgentInfo;
  chatBot: Chat<any>;
  client: PlatformClient;
}

/**
 * Routes incoming webhook events to the correct Chat SDK Bot instance
 * and triggers message processing via AgentBridgeService.
 *
 * All platforms require appId in the webhook URL:
 *   POST /api/agent/webhooks/[platform]/[appId]
 *
 * Bots are loaded on-demand: only the bot targeted by the incoming webhook
 * is created, not all bots across all platforms.
 */
export class BotMessageRouter {
  /** "platform:applicationId" → registered bot */
  private bots = new Map<string, RegisteredBot>();

  /** Per-key init promises to avoid duplicate concurrent loading */
  private loadingPromises = new Map<string, Promise<RegisteredBot | null>>();

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------

  /**
   * Get the webhook handler for a given platform + appId.
   * Returns a function compatible with Next.js Route Handler: `(req: Request) => Promise<Response>`
   */
  getWebhookHandler(platform: string, appId?: string): (req: Request) => Promise<Response> {
    return async (req: Request) => {
      const entry = platformRegistry.getPlatform(platform);
      if (!entry) {
        return new Response('No bot configured for this platform', { status: 404 });
      }

      if (!appId) {
        return new Response(`Missing appId for ${platform} webhook`, { status: 400 });
      }

      return this.handleWebhook(req, platform, appId);
    };
  }

  /**
   * Invalidate a cached bot so it gets reloaded with fresh config on next webhook.
   * Call this after settings or credentials are updated.
   */
  async invalidateBot(platform: string, appId: string): Promise<void> {
    const key = buildRuntimeKey(platform, appId);
    const existing = this.bots.get(key);
    if (!existing) return;

    log('invalidateBot: removing cached bot %s', key);
    this.bots.delete(key);
  }

  // ------------------------------------------------------------------
  // Webhook handling
  // ------------------------------------------------------------------

  private async handleWebhook(req: Request, platform: string, appId: string): Promise<Response> {
    log('handleWebhook: platform=%s, appId=%s', platform, appId);

    const bot = await this.getOrCreateBot(platform, appId);
    if (!bot) {
      return new Response(`No bot configured for ${platform}`, { status: 404 });
    }

    if (bot.chatBot.webhooks && platform in bot.chatBot.webhooks) {
      return (bot.chatBot.webhooks as any)[platform](req);
    }

    return new Response(`No bot configured for ${platform}`, { status: 404 });
  }

  // ------------------------------------------------------------------
  // On-demand bot loading
  // ------------------------------------------------------------------

  /**
   * Get an existing bot or create one on-demand from DB.
   * Concurrent calls for the same key are deduplicated.
   */
  private async getOrCreateBot(platform: string, appId: string): Promise<RegisteredBot | null> {
    const key = buildRuntimeKey(platform, appId);

    // Return cached bot
    const existing = this.bots.get(key);
    if (existing) return existing;

    // Deduplicate concurrent loads for the same key
    const inflight = this.loadingPromises.get(key);
    if (inflight) return inflight;

    const promise = this.loadBot(platform, appId);
    this.loadingPromises.set(key, promise);

    try {
      return await promise;
    } finally {
      this.loadingPromises.delete(key);
    }
  }

  private async loadBot(platform: string, appId: string): Promise<RegisteredBot | null> {
    const key = buildRuntimeKey(platform, appId);

    try {
      const entry = platformRegistry.getPlatform(platform);
      if (!entry) {
        log('No definition for platform: %s', platform);
        return null;
      }

      const serverDB = await getServerDB();
      const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();

      // Find the specific provider — search across all users
      const providers = await AgentBotProviderModel.findEnabledByPlatform(
        serverDB,
        platform,
        gateKeeper,
      );
      const provider = providers.find((p) => p.applicationId === appId);

      if (!provider) {
        log('No enabled provider found for %s', key);
        return null;
      }

      const registered = await this.createAndRegisterBot(entry, provider, serverDB);
      log('Created %s bot on-demand for agent=%s, appId=%s', platform, provider.agentId, appId);
      return registered;
    } catch (error) {
      log('Failed to load bot %s: %O', key, error);
      return null;
    }
  }

  private async createAndRegisterBot(
    entry: PlatformDefinition,
    provider: DecryptedBotProvider,
    serverDB: LobeChatDatabase,
  ): Promise<RegisteredBot> {
    const { agentId, userId, applicationId, credentials } = provider;
    const platform = entry.id;
    const key = buildRuntimeKey(platform, applicationId);

    const providerConfig: BotProviderConfig = {
      applicationId,
      credentials,
      platform,
      settings: (provider.settings as Record<string, unknown>) || {},
    };

    const runtimeContext: BotPlatformRuntimeContext = {
      appUrl: process.env.APP_URL,
      redisClient: getAgentRuntimeRedisClient() as any,
    };

    const client = entry.clientFactory.createClient(providerConfig, runtimeContext);
    const adapters = client.createAdapter();

    const chatBot = this.createChatBot(adapters, `agent-${agentId}`);
    this.registerHandlers(chatBot, serverDB, client, {
      agentId,
      applicationId,
      platform,
      settings: provider.settings as Record<string, any> | undefined,
      userId,
    });
    await chatBot.initialize();

    const registered: RegisteredBot = {
      agentInfo: { agentId, userId },
      chatBot,
      client,
    };

    this.bots.set(key, registered);

    return registered;
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  /**
   * A proxy around the shared Redis client that suppresses duplicate `on('error', ...)`
   * registrations. Each `createIoRedisState()` call adds an error listener to the client;
   * with many bot instances sharing one client this would trigger
   * MaxListenersExceededWarning. The proxy lets the first error listener through and
   * silently drops subsequent ones, so it scales to any number of bots.
   */
  private sharedRedisProxy: ReturnType<typeof getAgentRuntimeRedisClient> | undefined;

  private getSharedRedisProxy() {
    if (this.sharedRedisProxy !== undefined) return this.sharedRedisProxy;

    const redisClient = getAgentRuntimeRedisClient();
    if (!redisClient) {
      this.sharedRedisProxy = null;
      return null;
    }

    let errorListenerRegistered = false;
    this.sharedRedisProxy = new Proxy(redisClient, {
      get(target, prop, receiver) {
        if (prop === 'on') {
          return (event: string, listener: (...args: any[]) => void) => {
            if (event === 'error') {
              if (errorListenerRegistered) return target;
              errorListenerRegistered = true;
            }
            return target.on(event, listener);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });

    return this.sharedRedisProxy;
  }

  private createChatBot(adapters: Record<string, any>, label: string): Chat<any> {
    const config: any = {
      adapters,
      userName: `lobehub-bot-${label}`,
    };

    const redisClient = getAgentRuntimeRedisClient();
    if (redisClient) {
      config.state = createIoRedisState({
        client: redisClient,
        keyPrefix: `chat-sdk:${label}`,
        logger: new ConsoleLogger(),
      });
    }

    return new Chat(config);
  }

  private registerHandlers(
    bot: Chat<any>,
    serverDB: LobeChatDatabase,
    client: PlatformClient,
    info: ResolvedAgentInfo & {
      applicationId: string;
      platform: string;
      settings?: Record<string, any>;
    },
  ): void {
    const { agentId, applicationId, platform, userId } = info;
    const bridge = new AgentBridgeService(serverDB, userId);
    const charLimit = (info.settings?.charLimit as number) || undefined;
    const debounceMs = (info.settings?.debounceMs as number) || undefined;

    bot.onNewMention(async (thread, message) => {
      log(
        'onNewMention: agent=%s, platform=%s, author=%s, thread=%s',
        agentId,
        platform,
        message.author.userName,
        thread.id,
      );
      await bridge.handleMention(thread, message, {
        agentId,
        botContext: { applicationId, platform, platformThreadId: thread.id },
        charLimit,
        client,
        debounceMs,
      });
    });

    bot.onSubscribedMessage(async (thread, message) => {
      if (message.author.isBot === true) return;

      log(
        'onSubscribedMessage: agent=%s, platform=%s, author=%s, thread=%s',
        agentId,
        platform,
        message.author.userName,
        thread.id,
      );

      await bridge.handleSubscribedMessage(thread, message, {
        agentId,
        botContext: { applicationId, platform, platformThreadId: thread.id },
        charLimit,
        client,
        debounceMs,
      });
    });

    // Register onNewMessage handler based on platform config
    const dmEnabled = info.settings?.dm?.enabled ?? false;
    if (dmEnabled) {
      bot.onNewMessage(/./, async (thread, message) => {
        if (message.author.isBot === true) return;

        log(
          'onNewMessage (%s catch-all): agent=%s, author=%s, thread=%s, text=%s',
          platform,
          agentId,
          message.author.userName,
          thread.id,
          message.text?.slice(0, 80),
        );

        await bridge.handleMention(thread, message, {
          agentId,
          botContext: { applicationId, platform, platformThreadId: thread.id },
          charLimit,
          client,
          debounceMs,
        });
      });
    }
  }
}

// ------------------------------------------------------------------
// Singleton
// ------------------------------------------------------------------

let instance: BotMessageRouter | null = null;

export function getBotMessageRouter(): BotMessageRouter {
  if (!instance) {
    instance = new BotMessageRouter();
  }
  return instance;
}
