import { createIoRedisState } from '@chat-adapter/state-ioredis';
import type { Message, WebhookOptions } from 'chat';
import { Chat, ConsoleLogger } from 'chat';
import debug from 'debug';
import pMap from 'p-map';

import { getServerDB } from '@/database/core/db-adaptor';
import type { DecryptedBotProvider } from '@/database/models/agentBotProvider';
import { AgentBotProviderModel } from '@/database/models/agentBotProvider';
import type { LobeChatDatabase } from '@/database/type';
import { appEnv } from '@/envs/app';
import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

import { replayDeferredBotMessages } from '../deferredMessages';
import { buildReplayMessages } from '../mergeMessages';
import { patchSenderBatches } from '../patchSenderBatches';
import {
  type BotPlatformRuntimeContext,
  buildRuntimeKey,
  type DmSettings,
  extractDmSettings,
  extractGuestSettings,
  type GuestSettings,
  type PlatformClient,
  type PlatformDefinition,
  platformRegistry,
  resolveBotConcurrency,
  resolveBotProviderConfig,
} from '../platforms';
import { buildCommands } from './commands';
import { registerHandlers } from './handlers';
import type { RegisteredBot } from './types';
import { dispatchTextCommand } from './utils';

/** Minimum gap between two webhook re-registrations for the same bot. */
const WEBHOOK_RECONCILE_COOLDOWN_MS = 5 * 60 * 1000;
/** Redis key prefix for the fleet-wide reconcile cooldown (SET NX EX). */
const WEBHOOK_RECONCILE_KEY_PREFIX = 'bot:webhook-reconcile';

/** Max deferred messages replayed through the pipeline at the same time. */
const REPLAY_CONCURRENCY = 3;

const log = debug('lobe-server:bot:message-router');

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

  /** In-process fallback for the reconcile cooldown when no Redis is configured. */
  private webhookReconciledAt = new Map<string, number>();

  /** Per-key init promises to avoid duplicate concurrent loading */
  private loadingPromises = new Map<string, Promise<RegisteredBot | null>>();

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------

  /**
   * Get the webhook handler for a given platform + appId.
   * Returns a function compatible with Next.js Route Handler: `(req: Request) => Promise<Response>`
   */
  getWebhookHandler(
    platform: string,
    appId?: string,
  ): (req: Request, options?: WebhookOptions) => Promise<Response> {
    return async (req: Request, options?: WebhookOptions) => {
      const entry = platformRegistry.getPlatform(platform);
      if (!entry) {
        return new Response('No bot configured for this platform', { status: 404 });
      }

      if (!appId) {
        return new Response(`Missing appId for ${platform} webhook`, { status: 400 });
      }

      return this.handleWebhook(req, platform, appId, options);
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

  private async handleWebhook(
    req: Request,
    platform: string,
    appId: string,
    options?: WebhookOptions,
  ): Promise<Response> {
    log('handleWebhook: platform=%s, appId=%s', platform, appId);

    const bot = await this.getOrCreateBot(platform, appId);
    if (!bot) {
      return new Response(`No bot configured for ${platform}`, { status: 404 });
    }

    if (bot.chatBot.webhooks && platform in bot.chatBot.webhooks) {
      const response: Response = await (bot.chatBot.webhooks as any)[platform](req, options);
      if (response.status === 401)
        await this.reconcileWebhookAfterRejection(platform, appId, bot.client);
      return response;
    }

    return new Response(`No bot configured for ${platform}`, { status: 404 });
  }

  /**
   * An adapter answering 401 means the platform delivered an update that fails
   * verification — for webhook registrations we own (Telegram) that is almost
   * always a registration made before verification was mandatory, or with a
   * stale secret. Ask the client to re-register once per cooldown window; the
   * platform's retry of the rejected update then carries the right header.
   *
   * The 401 is still returned so the platform retries. The re-registration is
   * awaited (one bounded API call) rather than fired and forgotten: on a
   * serverless host the invocation may be frozen as soon as the response is
   * sent, which would cancel the call and leave the bot on the stale
   * registration indefinitely.
   *
   * Because anyone can hit the public webhook URL with a bogus header, the
   * cooldown is shared across instances through Redis when available (SET NX
   * EX), so a flood of unauthenticated requests costs at most one setWebhook
   * per bot per window fleet-wide — and re-registering always writes the
   * *current* secret, so an attacker cannot change the registration, only
   * trigger that one idempotent refresh.
   */
  private async reconcileWebhookAfterRejection(
    platform: string,
    appId: string,
    client: PlatformClient,
  ): Promise<void> {
    if (!client.reconcileWebhook) return;
    const key = buildRuntimeKey(platform, appId);
    if (!(await this.acquireWebhookReconcileSlot(key))) return;

    log('handleWebhook: %s rejected an update as unverified, re-registering webhook', key);
    try {
      await client.reconcileWebhook();
    } catch (error) {
      log('reconcileWebhook failed for %s: %O', key, error);
    }
  }

  /**
   * Claim the per-bot reconcile slot for the cooldown window. Shared through
   * Redis when the runtime has one; falls back to a per-process map otherwise
   * (single-instance self-hosted deployments).
   */
  private async acquireWebhookReconcileSlot(key: string): Promise<boolean> {
    const redis = getAgentRuntimeRedisClient();
    if (redis) {
      try {
        const result = await redis.set(
          `${WEBHOOK_RECONCILE_KEY_PREFIX}:${key}`,
          '1',
          'EX',
          Math.ceil(WEBHOOK_RECONCILE_COOLDOWN_MS / 1000),
          'NX',
        );
        return result === 'OK';
      } catch (error) {
        log('webhook reconcile throttle: redis unavailable, using in-memory cooldown: %O', error);
      }
    }

    const now = Date.now();
    const last = this.webhookReconciledAt.get(key);
    if (last !== undefined && now - last < WEBHOOK_RECONCILE_COOLDOWN_MS) return false;
    this.webhookReconciledAt.set(key, now);
    return true;
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
    const { agentId, userId, applicationId, workspaceId } = provider;
    const platform = entry.id;
    const key = buildRuntimeKey(platform, applicationId);

    const { config: providerConfig, settings } = resolveBotProviderConfig(entry, provider);

    // Decrypted provider settings can carry platform credentials: log key names only.
    log(
      'createAndRegisterBot: %s settings merge: userSettingKeys=%j, mergedKeys=%j',
      key,
      Object.keys(provider.settings ?? {}),
      Object.keys(settings ?? {}),
    );

    const runtimeContext: BotPlatformRuntimeContext = {
      appUrl: appEnv.APP_URL,
      redisClient: getAgentRuntimeRedisClient() as any,
      userId,
    };

    const client = entry.clientFactory.createClient(providerConfig, runtimeContext);
    const adapters = client.createAdapter();

    // Access settings + operatorUserId are needed by `/approve` (to enforce
    // the owner-only gate and to know whether pairing is enabled), and by
    // registerHandlers. Extract once, share with commands; registerHandlers
    // re-derives from `settings` to keep its closure self-contained.
    const dmSettings: DmSettings = extractDmSettings(settings);
    const guestSettings: GuestSettings = extractGuestSettings(settings);
    const operatorUserId =
      typeof settings.userId === 'string'
        ? (settings.userId as string).trim() || undefined
        : undefined;

    const commands = buildCommands(serverDB, {
      agentId,
      applicationId,
      client,
      dmSettings,
      getRedisClient: () => getAgentRuntimeRedisClient(),
      guestSettings,
      invalidateBot: (platform, appId) => this.invalidateBot(platform, appId),
      operatorUserId,
      platform,
      providerId: provider.id,
      userId,
      workspaceId: workspaceId ?? undefined,
    });

    // 'queue' stays the fallback for channels that never picked a strategy:
    // it preserves every pending message and merges them via
    // `mergeSkippedMessages`. Platforms that split one logical turn across
    // several messages need the window BEFORE the first dispatch instead —
    // see `resolveBotConcurrency`, which also rescues channels created before
    // 'burst' existed in chat-sdk 4.29.
    const { debounceMs, strategy } = resolveBotConcurrency(platform, settings);
    const chatBot = this.createChatBot(
      adapters,
      `agent-${agentId}`,
      strategy,
      debounceMs,
      (message) => {
        const text = client.sanitizeUserInput?.(message.text ?? '', message) ?? message.text;
        return dispatchTextCommand(text, commands) !== null;
      },
    );
    const { deferMentionThread } = registerHandlers(
      chatBot,
      serverDB,
      client,
      commands,
      {
        agentId,
        applicationId,
        platform,
        settings,
        userId,
        workspaceId: workspaceId ?? undefined,
      },
      () => getAgentRuntimeRedisClient(),
    );
    await chatBot.initialize();
    client.applyChatPatches?.(chatBot, { deferMentionThread });

    // Register platform-specific bot commands (e.g., Telegram setMyCommands menu)
    if (client.registerBotCommands) {
      const commandList = commands.map((c) => ({
        command: c.name,
        description: c.description,
        options: c.options,
      }));
      client.registerBotCommands(commandList).catch((error) => {
        log('registerBotCommands failed for %s: %O', key, error);
      });
    }

    const registered: RegisteredBot = {
      adapters,
      agentInfo: { agentId, userId, workspaceId: workspaceId ?? undefined },
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

  private createChatBot(
    adapters: Record<string, any>,
    label: string,
    concurrencyStrategy: string,
    debounceMs: number,
    isCommand: (message: Message) => boolean,
  ): Chat<any> {
    const config: any = {
      adapters,
      // `burst` and `debounce` both wait `debounceMs` before dispatching; they
      // differ in what happens to the earlier messages in that window. `burst`
      // hands them to the handler as `context.skipped`, which
      // `mergeSkippedMessages` folds into one turn; `debounce` drops them.
      // Anything else keeps the plain queue, which dispatches immediately.
      concurrency:
        concurrencyStrategy === 'burst' || concurrencyStrategy === 'debounce'
          ? { debounceMs, strategy: concurrencyStrategy }
          : 'queue',
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

    const bot = new Chat(config);
    patchSenderBatches(bot, isCommand);
    return bot;
  }

  /**
   * Re-dispatch the messages that `AgentBridgeService` parked while this
   * thread's topic was still running. Called by `BotCallbackService` once the
   * completion callback lands, so the follow-up ("one sentence" after "one
   * image" on WeChat) becomes the next turn instead of a failed start.
   *
   * Each original message goes through `Chat.processMessage`, i.e. the same
   * subscription / mention / command routing as a live webhook delivery.
   */
  async replayDeferredMessages(
    platform: string,
    applicationId: string,
    platformThreadId: string,
  ): Promise<void> {
    await replayDeferredBotMessages(applicationId, platformThreadId, async (entries) => {
      const bot = await this.getOrCreateBot(platform, applicationId);
      const adapter = bot?.adapters[platform];
      if (!bot || !adapter) throw new Error(`Bot adapter unavailable for ${platform}`);
      // Settle every replay (same as `Promise.allSettled`) but cap how many
      // messages go through the full pipeline at once.
      const results = await pMap(
        buildReplayMessages(entries),
        (message): Promise<PromiseSettledResult<unknown>> =>
          bot.chatBot.processMessage(adapter, platformThreadId, message).then(
            (value) => ({ status: 'fulfilled', value }),
            (reason: unknown) => ({ reason, status: 'rejected' }),
          ),
        { concurrency: REPLAY_CONCURRENCY },
      );
      const failure = results.find((result) => result.status === 'rejected');
      if (failure?.status === 'rejected') throw failure.reason;
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
