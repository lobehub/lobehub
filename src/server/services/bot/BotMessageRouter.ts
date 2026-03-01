import { createDiscordAdapter } from '@chat-adapter/discord';
import { createIoRedisState } from '@chat-adapter/state-ioredis';
import { Chat, ConsoleLogger } from 'chat';
import debug from 'debug';

import { getServerDB } from '@/database/core/db-adaptor';
import { AgentBotProviderModel } from '@/database/models/agentBotProvider';
import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

import { AgentBridgeService } from './AgentBridgeService';

const log = debug('lobe-server:bot:message-router');

interface ResolvedAgentInfo {
  agentId: string;
  userId: string;
}

interface DiscordCredentials {
  applicationId: string;
  botToken: string;
  publicKey: string;
}

/**
 * Routes incoming webhook events to the correct Chat SDK Bot instance
 * and triggers message processing via AgentBridgeService.
 */
export class BotMessageRouter {
  private bridge = new AgentBridgeService();

  /** botToken → Chat instance (for webhook routing via x-discord-gateway-token) */
  private botInstancesByToken = new Map<string, Chat<any>>();

  /** applicationId → { agentId, userId } */
  private discordAgentMap = new Map<string, ResolvedAgentInfo>();

  /** Cached Chat instances keyed by applicationId */
  private botInstances = new Map<string, Chat<any>>();

  /** Store credentials for getDiscordBotConfigs() */
  private credentialsByAppId = new Map<string, DiscordCredentials>();

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------

  /**
   * Get the webhook handler for a given platform.
   * Returns a function compatible with Next.js Route Handler: `(req: Request) => Promise<Response>`
   */
  getWebhookHandler(platform: string): (req: Request) => Promise<Response> {
    return async (req: Request) => {
      await this.ensureInitialized();

      if (platform === 'discord') {
        return this.handleDiscordWebhook(req);
      }

      return new Response('No bot configured for this platform', { status: 404 });
    };
  }

  // ------------------------------------------------------------------
  // Discord webhook routing
  // ------------------------------------------------------------------

  private async handleDiscordWebhook(req: Request): Promise<Response> {
    const bodyBuffer = await req.arrayBuffer();

    log('handleDiscordWebhook: method=%s, content-length=%d', req.method, bodyBuffer.byteLength);

    // Check for forwarded Gateway event (from Gateway worker)
    const gatewayToken = req.headers.get('x-discord-gateway-token');
    if (gatewayToken) {
      log('Gateway forwarded event, token=%s...', gatewayToken.slice(0, 10));
      log(
        'Known tokens: %o',
        [...this.botInstancesByToken.keys()].map((t) => t.slice(0, 10)),
      );

      // Log forwarded event details for debugging
      try {
        const bodyText = new TextDecoder().decode(bodyBuffer);
        const event = JSON.parse(bodyText);

        if (event.type === 'GATEWAY_MESSAGE_CREATE') {
          const d = event.data;
          log(
            'MESSAGE_CREATE: author=%s (id=%s, bot=%s), mentions=%o, content=%s',
            d?.author?.username,
            d?.author?.id,
            d?.author?.bot,
            d?.mentions?.map((m: any) => ({ id: m.id, username: m.username })),
            d?.content?.slice(0, 100),
          );
        }
      } catch {
        // ignore parse errors
      }

      const bot = this.botInstancesByToken.get(gatewayToken);
      if (bot?.webhooks && 'discord' in bot.webhooks) {
        log('Matched bot by token');
        return bot.webhooks.discord(this.cloneRequest(req, bodyBuffer));
      }

      log('No matching bot for gateway token');
      return new Response('No matching bot for gateway token', { status: 404 });
    }

    // HTTP Interactions — route by applicationId in the interaction payload
    try {
      const bodyText = new TextDecoder().decode(bodyBuffer);
      const payload = JSON.parse(bodyText);
      const appId = payload.application_id;

      if (appId) {
        const bot = this.botInstances.get(appId);
        if (bot?.webhooks && 'discord' in bot.webhooks) {
          return bot.webhooks.discord(this.cloneRequest(req, bodyBuffer));
        }
      }
    } catch {
      // Not valid JSON — fall through
    }

    // Fallback: try all registered bots
    for (const bot of this.botInstances.values()) {
      if (bot.webhooks && 'discord' in bot.webhooks) {
        try {
          const resp = await bot.webhooks.discord(this.cloneRequest(req, bodyBuffer));
          if (resp.status !== 401) return resp;
        } catch {
          // signature mismatch — try next
        }
      }
    }

    return new Response('No bot configured for Discord', { status: 404 });
  }

  private cloneRequest(req: Request, body: ArrayBuffer): Request {
    return new Request(req.url, {
      body,
      headers: req.headers,
      method: req.method,
    });
  }

  // ------------------------------------------------------------------
  // Initialisation
  // ------------------------------------------------------------------

  private static REFRESH_INTERVAL_MS = 5 * 60_000;

  private initPromise: Promise<void> | null = null;
  private lastLoadedAt = 0;
  private refreshPromise: Promise<void> | null = null;

  private async ensureInitialized(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.initialize();
    }
    await this.initPromise;

    // Periodically refresh bot mappings in the background so newly added bots are discovered
    if (
      Date.now() - this.lastLoadedAt > BotMessageRouter.REFRESH_INTERVAL_MS &&
      !this.refreshPromise
    ) {
      this.refreshPromise = this.loadAgentBots().finally(() => {
        this.refreshPromise = null;
      });
    }
  }

  async initialize(): Promise<void> {
    log('Initializing BotMessageRouter');

    await this.loadAgentBots();

    log('Initialized: %d agent bots', this.botInstances.size);
  }

  // ------------------------------------------------------------------
  // Per-agent bots from DB
  // ------------------------------------------------------------------

  private async loadAgentBots(): Promise<void> {
    try {
      const serverDB = await getServerDB();
      const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();

      const providers = await AgentBotProviderModel.findEnabledByPlatform(
        serverDB,
        'discord',
        gateKeeper,
      );

      this.lastLoadedAt = Date.now();

      log('Found %d Discord bot providers in DB', providers.length);

      for (const provider of providers) {
        const { agentId, userId, applicationId, credentials } = provider;
        const { botToken, publicKey } = credentials as any;

        if (this.botInstances.has(applicationId)) {
          log('Skipping provider %s: already registered', applicationId);
          continue;
        }

        const adapters: Record<string, any> = {
          discord: createDiscordAdapter({
            applicationId,
            botToken,
            publicKey,
          }),
        };

        const bot = this.createBot(adapters, `agent-${agentId}`);
        this.registerHandlers(bot, { agentId, applicationId, platform: 'discord', userId });
        await bot.initialize();

        this.botInstances.set(applicationId, bot);
        this.botInstancesByToken.set(botToken, bot);
        this.discordAgentMap.set(applicationId, { agentId, userId });
        this.credentialsByAppId.set(applicationId, { applicationId, botToken, publicKey });

        log('Created Discord bot for agent=%s, appId=%s', agentId, applicationId);
      }
    } catch (error) {
      log('Failed to load agent bots: %O', error);
    }
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  private createBot(adapters: Record<string, any>, label: string): Chat<any> {
    const config: any = {
      adapters,
      userName: `lobehub-bot-${label}`,
    };

    const redisClient = getAgentRuntimeRedisClient();
    if (redisClient) {
      config.state = createIoRedisState({ client: redisClient, logger: new ConsoleLogger() });
    }

    return new Chat(config);
  }

  private registerHandlers(
    bot: Chat<any>,
    info: ResolvedAgentInfo & { applicationId: string; platform: string },
  ): void {
    const { agentId, applicationId, platform, userId } = info;

    bot.onNewMention(async (thread, message) => {
      log('onNewMention: agent=%s, author=%s', agentId, message.author.userName);
      await this.bridge.handleMention(thread, message, {
        agentId,
        botContext: { applicationId, platform, platformThreadId: thread.id },
        userId,
      });
    });

    bot.onSubscribedMessage(async (thread, message) => {
      if (message.author.isBot === true) return;

      log('onSubscribedMessage: agent=%s, author=%s', agentId, message.author.userName);

      await this.bridge.handleSubscribedMessage(thread, message, {
        agentId,
        botContext: { applicationId, platform, platformThreadId: thread.id },
        userId,
      });
    });
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
