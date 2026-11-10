import { createIoRedisState } from '@chat-adapter/state-ioredis';
import type { WebhookOptions } from 'chat';
import { Chat, ConsoleLogger } from 'chat';
import debug from 'debug';
import pMap from 'p-map';

import type { MessengerPlatform } from '@/config/messenger';
import { getServerDB } from '@/database/core/db-adaptor';
import type { LobeChatDatabase } from '@/database/type';
import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';
import {
  MAX_DEFERRED_PER_THREAD,
  replayDeferredBotMessages,
} from '@/server/services/bot/deferredMessages';
import { buildReplayMessages } from '@/server/services/bot/mergeMessages';
import { patchSenderBatches } from '@/server/services/bot/patchSenderBatches';
// Leaf module, not the `./platforms` barrel: the barrel instantiates every
// platform definition (and its ClientFactory) at import time.
import { resolveBotConcurrency } from '@/server/services/bot/platforms/utils';

import { getInstallationStore } from '../installations';
import type { InstallationCredentials } from '../installations/types';
import { type MessengerPlatformDefinition, messengerPlatformRegistry } from '../platforms';
import type {
  CallbackAcknowledgement,
  InboundCallbackAction,
  MessengerPlatformBinder,
} from '../types';
import { fetchUserAgents } from './agents';
import { handleCallbackAction, handleScopeCallback } from './callbacks';
import { buildCommands } from './commands';
import { registerHandlers } from './handlers';
import type {
  AgentSummary,
  MessengerCommand,
  MessengerRouterDeps,
  RegisteredMessengerBot,
} from './types';
import { parseCommand, reconstructRequest } from './utils';
import { handleAppHomeOpened } from './welcome';

const log = debug('lobe-server:messenger:router');

const WECHAT_UNSUPPORTED_COMMANDS = new Set(['start']);

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
  private readonly commands: MessengerCommand[] = buildCommands(this.stageDeps());

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

  // Proactive DMs deliberately do NOT live here — see `messenger/outbound.ts`.
  // Loading a bot through this class runs `registerHandlers`, which needs
  // `AgentBridgeService`; that is correct for inbound traffic but would make
  // every function that can merely reach an outbound send carry the whole
  // agent runtime.

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
  getWebhookHandler(
    platform: string,
  ): (req: Request, options?: WebhookOptions) => Promise<Response> {
    return async (req: Request, options?: WebhookOptions) => {
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

      // The gate may have claimed this delivery (Linq replay dedupe); let it
      // settle that claim once the outcome is known so a failed delivery
      // stays retryable instead of being answered as a duplicate forever.
      let response: Response | undefined;
      try {
        response = await this.dispatchVerifiedWebhook(definition, req, rawBody, options);
        return response;
      } finally {
        if (definition.webhookGate?.settle) {
          await definition.webhookGate.settle(req, response).catch((error: unknown) => {
            log('webhook: gate settle failed for %s: %O', platform, error);
          });
        }
      }
    };
  }

  private async dispatchVerifiedWebhook(
    definition: MessengerPlatformDefinition,
    req: Request,
    rawBody: string,
    options?: WebhookOptions,
  ): Promise<Response> {
    const platform = definition.id;

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
          await handleAppHomeOpened(this.stageDeps(), bot, creds, opener);
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
          await this.handleCallbackAction(bot.binder, creds, action, bot.chatBot);
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
    return handler(reconstructRequest(req, rawBody), options);
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
    registerHandlers(this.stageDeps(), chatBot, serverDB, client, binder, creds);

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

    const registered: RegisteredMessengerBot = { adapters, binder, chatBot, client, creds };
    this.bots.set(creds.installationKey, registered);

    log('loadBot: registered messenger %s bot', creds.installationKey);
    return registered;
  }

  /**
   * Re-dispatch the messages `AgentBridgeService` parked while the thread's
   * topic was still running (see `BotMessageRouter.replayDeferredMessages`).
   * `applicationId` is the synthetic per-install id the bridge used when
   * deferring (`messenger-<platform>[-<tenant>]`).
   */
  async replayDeferredMessages(
    installationKey: string,
    applicationId: string,
    platformThreadId: string,
  ): Promise<void> {
    await replayDeferredBotMessages(applicationId, platformThreadId, async (entries) => {
      const platform = installationKey.split(':')[0] as MessengerPlatform;
      const store = getInstallationStore(platform);
      const creds = await store?.resolveByKey(installationKey);
      const bot = creds ? await this.getOrCreateBot(creds) : null;
      const adapter = bot?.adapters[platform];
      if (!bot || !adapter) throw new Error(`Messenger adapter unavailable for ${platform}`);
      // The cap equals the store's own per-thread cap, so every parked message
      // is still dispatched at once: burst/debounce strategies rely on that to
      // merge the replay into one turn. Settle all before rethrowing the first
      // failure so a single bad entry cannot cut the rest of the replay short.
      const results = await pMap(
        buildReplayMessages(entries),
        (message): Promise<PromiseSettledResult<unknown>> =>
          bot.chatBot.processMessage(adapter, platformThreadId, message).then(
            (value) => ({ status: 'fulfilled', value }),
            (reason: unknown) => ({ reason, status: 'rejected' }),
          ),
        { concurrency: MAX_DEFERRED_PER_THREAD },
      );
      const failure = results.find((result) => result.status === 'rejected');
      if (failure?.status === 'rejected') throw failure.reason;
    });
  }

  private createChatBot(adapters: Record<string, any>, creds: InstallationCredentials): Chat<any> {
    const config: any = {
      adapters,
      // Messenger installs carry no per-channel settings, so this is purely the
      // platform's own answer: WeChat collects a burst window because it splits
      // one turn across several messages, everything else keeps the plain queue.
      // Shared with `BotMessageRouter` so both paths agree on which platforms
      // need collecting.
      concurrency: (() => {
        const { debounceMs, strategy } = resolveBotConcurrency(creds.platform, undefined);
        return strategy === 'queue' ? 'queue' : { debounceMs, strategy };
      })(),
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

    const bot = new Chat(config);
    const commands = this.getCommandsForPlatform(creds.platform);
    patchSenderBatches(bot, (message) => {
      const parsed = parseCommand(message.text);
      return !!parsed && commands.some((command) => command.name === parsed.name);
    });
    return bot;
  }

  /**
   * The instance hooks the extracted stages call back through. Each hook
   * resolves on `this` at call time.
   */
  private stageDeps(): MessengerRouterDeps {
    return {
      fetchUserAgents: (serverDB, userId, workspaceId) =>
        this.fetchUserAgents(serverDB, userId, workspaceId),
      getCommandsForPlatform: (platform) => this.getCommandsForPlatform(platform),
    };
  }

  /** See `handleCallbackAction` in `./callbacks`. */
  private handleCallbackAction(
    binder: MessengerPlatformBinder,
    creds: InstallationCredentials,
    action: InboundCallbackAction,
    chatBot?: Chat<any>,
  ): Promise<void> {
    return handleCallbackAction(this.stageDeps(), binder, creds, action, chatBot);
  }

  /** See `handleScopeCallback` in `./callbacks`. */
  private handleScopeCallback(
    creds: InstallationCredentials,
    action: InboundCallbackAction,
    scopeToken: string,
    ack: (ack: CallbackAcknowledgement) => Promise<void>,
  ): Promise<void> {
    return handleScopeCallback(this.stageDeps(), creds, action, scopeToken, ack);
  }

  /** See `fetchUserAgents` in `./agents`. */
  private fetchUserAgents(
    serverDB: LobeChatDatabase,
    userId: string,
    workspaceId?: string | null,
  ): Promise<AgentSummary[]> {
    return fetchUserAgents(serverDB, userId, workspaceId);
  }
}

let singleton: MessengerRouter | undefined;

export const getMessengerRouter = (): MessengerRouter => {
  if (!singleton) singleton = new MessengerRouter();
  return singleton;
};
