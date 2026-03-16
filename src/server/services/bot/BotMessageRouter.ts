import { createIoRedisState } from '@chat-adapter/state-ioredis';
import { Chat, ConsoleLogger } from 'chat';
import debug from 'debug';

import { getServerDB } from '@/database/core/db-adaptor';
import { AgentBotProviderModel } from '@/database/models/agentBotProvider';
import type { LobeChatDatabase } from '@/database/type';
import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

import { AgentBridgeService } from './AgentBridgeService';
import { getPlatformDescriptor, platformDescriptors } from './platforms';

const log = debug('lobe-server:bot:message-router');

interface ResolvedAgentInfo {
  agentId: string;
  userId: string;
}

interface StoredCredentials {
  [key: string]: string;
}

/**
 * Routes incoming webhook events to the correct Chat SDK Bot instance
 * and triggers message processing via AgentBridgeService.
 */
export class BotMessageRouter {
  /** botToken → Chat instance (for Discord webhook routing via x-discord-gateway-token) */
  private botInstancesByToken = new Map<string, Chat<any>>();

  /** "platform:applicationId" → { agentId, userId } */
  private agentMap = new Map<string, ResolvedAgentInfo>();

  /** "platform:applicationId" → Chat instance */
  private botInstances = new Map<string, Chat<any>>();

  /** "platform:applicationId" → credentials */
  private credentialsByKey = new Map<string, StoredCredentials>();

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------

  /**
   * Get the webhook handler for a given platform.
   * Returns a function compatible with Next.js Route Handler: `(req: Request) => Promise<Response>`
   *
   * @param appId  Optional application ID for direct bot lookup (e.g. Telegram bot-specific endpoints).
   */
  getWebhookHandler(platform: string, appId?: string): (req: Request) => Promise<Response> {
    return async (req: Request) => {
      await this.ensureInitialized();

      const descriptor = getPlatformDescriptor(platform);
      if (!descriptor) {
        return new Response('No bot configured for this platform', { status: 404 });
      }

      // Discord has special routing via gateway token header and interaction payloads
      if (platform === 'discord') {
        return this.handleDiscordWebhook(req);
      }

      // All other platforms use direct lookup by appId with fallback iteration
      return this.handleGenericWebhook(req, platform, appId);
    };
  }

  // ------------------------------------------------------------------
  // Discord webhook routing (special: gateway token + interaction payload)
  // ------------------------------------------------------------------

  private async handleDiscordWebhook(req: Request): Promise<Response> {
    const bodyBuffer = await req.arrayBuffer();

    log('handleDiscordWebhook: method=%s, content-length=%d', req.method, bodyBuffer.byteLength);

    // Check for forwarded Gateway event (from Gateway worker)
    const gatewayToken = req.headers.get('x-discord-gateway-token');
    if (gatewayToken) {
      // Log forwarded event details
      try {
        const bodyText = new TextDecoder().decode(bodyBuffer);
        const event = JSON.parse(bodyText);

        if (event.type === 'GATEWAY_MESSAGE_CREATE') {
          const d = event.data;
          const mentions = d?.mentions?.map((m: any) => m.username).join(', ');
          log(
            'Gateway MESSAGE_CREATE: author=%s (bot=%s), mentions=[%s], content=%s',
            d?.author?.username,
            d?.author?.bot,
            mentions || '',
            d?.content?.slice(0, 100),
          );
        }
      } catch {
        // ignore parse errors
      }

      const bot = this.botInstancesByToken.get(gatewayToken);
      if (bot?.webhooks && 'discord' in bot.webhooks) {
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
        const bot = this.botInstances.get(`discord:${appId}`);
        if (bot?.webhooks && 'discord' in bot.webhooks) {
          return bot.webhooks.discord(this.cloneRequest(req, bodyBuffer));
        }
      }
    } catch {
      // Not valid JSON — fall through
    }

    // Fallback: try all registered Discord bots
    for (const [key, bot] of this.botInstances) {
      if (!key.startsWith('discord:')) continue;
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

  // ------------------------------------------------------------------
  // Generic webhook routing (Telegram, Lark, Feishu, and future platforms)
  // ------------------------------------------------------------------

  private async handleGenericWebhook(
    req: Request,
    platform: string,
    appId?: string,
  ): Promise<Response> {
    log('handleGenericWebhook: platform=%s, appId=%s', platform, appId);

    const bodyBuffer = await req.arrayBuffer();

    // Direct lookup by applicationId
    if (appId) {
      const key = `${platform}:${appId}`;
      const bot = this.botInstances.get(key);
      if (bot?.webhooks && platform in bot.webhooks) {
        return (bot.webhooks as any)[platform](this.cloneRequest(req, bodyBuffer));
      }
      log('handleGenericWebhook: no bot registered for %s', key);
      return new Response(`No bot configured for ${platform}`, { status: 404 });
    }

    // Fallback: try all registered bots for this platform
    for (const [key, bot] of this.botInstances) {
      if (!key.startsWith(`${platform}:`)) continue;
      if (bot.webhooks && platform in bot.webhooks) {
        try {
          const resp = await (bot.webhooks as any)[platform](this.cloneRequest(req, bodyBuffer));
          if (resp.status !== 401) return resp;
        } catch {
          // try next
        }
      }
    }

    return new Response(`No bot configured for ${platform}`, { status: 404 });
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

      // Load all supported platforms from the descriptor registry
      for (const platform of Object.keys(platformDescriptors)) {
        const providers = await AgentBotProviderModel.findEnabledByPlatform(
          serverDB,
          platform,
          gateKeeper,
        );

        log('Found %d %s bot providers in DB', providers.length, platform);

        for (const provider of providers) {
          const { agentId, userId, applicationId, credentials } = provider;
          const key = `${platform}:${applicationId}`;

          if (this.agentMap.has(key)) {
            log('Skipping provider %s: already registered', key);
            continue;
          }

          const descriptor = getPlatformDescriptor(platform);
          if (!descriptor) {
            log('Unsupported platform: %s', platform);
            continue;
          }

          const adapters = descriptor.createAdapter(credentials, applicationId);

          const bot = this.createBot(adapters, `agent-${agentId}`);
          this.registerHandlers(bot, serverDB, {
            agentId,
            applicationId,
            platform,
            userId,
          });
          await bot.initialize();

          this.botInstances.set(key, bot);
          this.agentMap.set(key, { agentId, userId });
          this.credentialsByKey.set(key, credentials);

          // Platform-specific post-registration hook
          await descriptor.onBotRegistered?.({
            applicationId,
            credentials,
            registerByToken: (token: string) => this.botInstancesByToken.set(token, bot),
          });

          log('Created %s bot for agent=%s, appId=%s', platform, agentId, applicationId);
        }
      }

      this.lastLoadedAt = Date.now();
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
    info: ResolvedAgentInfo & { applicationId: string; platform: string },
  ): void {
    const { agentId, applicationId, platform, userId } = info;
    const bridge = new AgentBridgeService(serverDB, userId);

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
      });
    });

    // Register onNewMessage handler based on platform descriptor
    const descriptor = getPlatformDescriptor(platform);
    if (descriptor?.handleDirectMessages) {
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
