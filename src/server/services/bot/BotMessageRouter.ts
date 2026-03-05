import { createDiscordAdapter } from '@chat-adapter/discord';
import { createIoRedisState } from '@chat-adapter/state-ioredis';
import { createTelegramAdapter } from '@chat-adapter/telegram';
import { Chat, ConsoleLogger } from 'chat';
import debug from 'debug';

import { getServerDB } from '@/database/core/db-adaptor';
import { AgentBotProviderModel } from '@/database/models/agentBotProvider';
import type { LobeChatDatabase } from '@/database/type';
import { appEnv } from '@/envs/app';
import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

import { AgentBridgeService } from './AgentBridgeService';
import { setTelegramWebhook } from './platforms/telegram';

const log = debug('lobe-server:bot:message-router');

interface ResolvedAgentInfo {
  agentId: string;
  userId: string;
}

interface StoredCredentials {
  [key: string]: string;
}

/**
 * Adapter factory: creates the correct Chat SDK adapter from platform + credentials.
 */
function createAdapterForPlatform(
  platform: string,
  credentials: StoredCredentials,
  applicationId: string,
): Record<string, any> | null {
  switch (platform) {
    case 'discord': {
      return {
        discord: createDiscordAdapter({
          applicationId,
          botToken: credentials.botToken,
          publicKey: credentials.publicKey,
        }),
      };
    }
    case 'telegram': {
      return {
        telegram: createTelegramAdapter({
          botToken: credentials.botToken,
          secretToken: credentials.secretToken,
        }),
      };
    }
    default: {
      return null;
    }
  }
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

      switch (platform) {
        case 'discord': {
          return this.handleDiscordWebhook(req);
        }
        case 'telegram': {
          return this.handleTelegramWebhook(req, appId);
        }
        default: {
          return new Response('No bot configured for this platform', { status: 404 });
        }
      }
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
  // Telegram webhook routing
  // ------------------------------------------------------------------

  private async handleTelegramWebhook(req: Request, appId?: string): Promise<Response> {
    const bodyBuffer = await req.arrayBuffer();

    log(
      'handleTelegramWebhook: method=%s, appId=%s, content-length=%d',
      req.method,
      appId ?? '(none)',
      bodyBuffer.byteLength,
    );

    // Log raw update for debugging
    try {
      const bodyText = new TextDecoder().decode(bodyBuffer);
      const update = JSON.parse(bodyText);
      const msg = update.message;
      if (msg) {
        log(
          'Telegram update: chat_type=%s, from=%s (id=%s), text=%s',
          msg.chat?.type,
          msg.from?.username || msg.from?.first_name,
          msg.from?.id,
          msg.text?.slice(0, 100),
        );
      } else {
        log('Telegram update (non-message): keys=%s', Object.keys(update).join(','));
      }
    } catch {
      // ignore parse errors
    }

    // Direct lookup by applicationId (bot-specific endpoint: /webhooks/telegram/{appId})
    if (appId) {
      const key = `telegram:${appId}`;
      const bot = this.botInstances.get(key);
      if (bot?.webhooks && 'telegram' in bot.webhooks) {
        log('handleTelegramWebhook: direct lookup hit for %s', key);
        return bot.webhooks.telegram(this.cloneRequest(req, bodyBuffer));
      }
      log('handleTelegramWebhook: no bot registered for %s', key);
      return new Response('No bot configured for Telegram', { status: 404 });
    }

    // Fallback: iterate all registered Telegram bots (legacy /webhooks/telegram endpoint).
    // Secret token verification will reject mismatches.
    for (const [key, bot] of this.botInstances) {
      if (!key.startsWith('telegram:')) continue;
      if (bot.webhooks && 'telegram' in bot.webhooks) {
        try {
          log('handleTelegramWebhook: trying bot %s', key);
          const resp = await bot.webhooks.telegram(this.cloneRequest(req, bodyBuffer));
          log('handleTelegramWebhook: bot %s responded with status=%d', key, resp.status);
          if (resp.status !== 401) return resp;
        } catch (error) {
          log('handleTelegramWebhook: bot %s webhook error: %O', key, error);
        }
      }
    }

    log('handleTelegramWebhook: no matching bot found');
    return new Response('No bot configured for Telegram', { status: 404 });
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

      // Load all supported platforms
      for (const platform of ['discord', 'telegram']) {
        const providers = await AgentBotProviderModel.findEnabledByPlatform(
          serverDB,
          platform,
          gateKeeper,
        );

        log('Found %d %s bot providers in DB', providers.length, platform);

        for (const provider of providers) {
          const { agentId, userId, applicationId, credentials } = provider;
          const key = `${platform}:${applicationId}`;

          if (this.botInstances.has(key)) {
            log('Skipping provider %s: already registered', key);
            continue;
          }

          const adapters = createAdapterForPlatform(platform, credentials, applicationId);
          if (!adapters) {
            log('Unsupported platform: %s', platform);
            continue;
          }

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

          // Discord-specific: also index by botToken for gateway forwarding
          if (platform === 'discord' && credentials.botToken) {
            this.botInstancesByToken.set(credentials.botToken, bot);
          }

          // Telegram: call setWebhook to ensure Telegram-side secret_token
          // stays in sync with the adapter config (idempotent, safe on every init)
          if (platform === 'telegram' && credentials.botToken) {
            const baseUrl = (credentials.webhookProxyUrl || appEnv.APP_URL || '').replace(
              /\/$/,
              '',
            );
            const webhookUrl = `${baseUrl}/api/agent/webhooks/telegram/${applicationId}`;
            setTelegramWebhook(credentials.botToken, webhookUrl, credentials.secretToken).catch(
              (err) => {
                log('Failed to set Telegram webhook for appId=%s: %O', applicationId, err);
              },
            );
          }

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

    // Telegram-only: handle messages in unsubscribed threads that aren't @mentions.
    // This covers Telegram private chats where users message the bot directly.
    // Discord relies solely on onNewMention/onSubscribedMessage — registering a
    // catch-all there would cause unsolicited replies in active channels.
    if (platform === 'telegram') {
      bot.onNewMessage(/./, async (thread, message) => {
        if (message.author.isBot === true) return;

        log(
          'onNewMessage (telegram catch-all): agent=%s, author=%s, thread=%s, text=%s',
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
