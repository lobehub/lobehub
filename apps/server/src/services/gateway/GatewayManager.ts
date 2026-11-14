import debug from 'debug';

import {
  getBotFeatureBlockedMessage,
  isBotFeatureAccessAllowed,
} from '@/business/server/bot/featureAccess';
import { getServerDB } from '@/database/core/db-adaptor';
import type { DecryptedBotProvider } from '@/database/models/agentBotProvider';
import { AgentBotProviderModel } from '@/database/models/agentBotProvider';
import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import {
  type BotPlatformRuntimeContext,
  buildRuntimeKey,
  type PlatformClient,
  type PlatformDefinition,
  resolveBotProviderConfig,
} from '@/server/services/bot/platforms';

import { BOT_RUNTIME_STATUSES, updateBotRuntimeStatus } from './runtimeStatus';

const log = debug('lobe-server:bot-gateway');

export interface GatewayManagerConfig {
  definitions: PlatformDefinition[];
}

export class GatewayManager {
  private clients = new Map<string, PlatformClient>();
  private running = false;
  /**
   * The start in progress, shared by every concurrent `start()` caller so the
   * DB sync — and the connection it opens per bot — runs once.
   */
  private startPromise: Promise<void> | null = null;
  private config: GatewayManagerConfig;

  private definitionByPlatform: Map<string, PlatformDefinition>;

  constructor(config: GatewayManagerConfig) {
    this.config = config;
    this.definitionByPlatform = new Map(this.config.definitions.map((e) => [e.id, e]));
  }

  get isRunning(): boolean {
    return this.running;
  }

  get isStarting(): boolean {
    return this.startPromise !== null;
  }

  // ------------------------------------------------------------------
  // Lifecycle (call once)
  // ------------------------------------------------------------------

  /**
   * Concurrent calls share one in-flight start. Boot reaches this from both
   * instrumentation `register()` and the launcher's `POST /gateway/start`, and
   * a user connect can join them; each running its own sync would open a
   * second connection per bot (QQ rejects it: 4903 create session error).
   */
  start(): Promise<void> {
    if (this.running) {
      log('GatewayManager already running, skipping');
      return Promise.resolve();
    }

    if (this.startPromise) {
      log('GatewayManager start already in progress, joining it');
      return this.startPromise;
    }

    log('Starting GatewayManager');

    this.startPromise = this.runStart().finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  private async runStart(): Promise<void> {
    await this.sync().catch((err) => {
      console.error('[GatewayManager] Initial sync failed:', err);
    });

    this.running = true;
    log('GatewayManager started with %d clients', this.clients.size);
  }

  async stop(): Promise<void> {
    if (!this.running) return;

    log('Stopping GatewayManager');

    for (const [key, client] of this.clients) {
      log('Stopping client %s', key);
      await this.retireClient(key, client);
    }

    this.running = false;
    log('GatewayManager stopped');
  }

  // ------------------------------------------------------------------
  // Client operations (point-to-point)
  // ------------------------------------------------------------------

  async startClient(platform: string, applicationId: string): Promise<void> {
    const key = buildRuntimeKey(platform, applicationId);

    // Stop existing if any
    const existing = this.clients.get(key);
    if (existing) {
      log('Stopping existing client %s before restart', key);
      await this.retireClient(key, existing);
    }

    // Load from DB (system-wide single row — platform + applicationId is globally
    // unique; the caller is already authorized at the router boundary).
    const serverDB = await getServerDB();
    const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
    const provider = await AgentBotProviderModel.findEnabledByPlatformAndAppId(
      serverDB,
      platform,
      applicationId,
      gateKeeper,
    );

    if (!provider) {
      log('No enabled provider found for %s', key);
      return;
    }

    if (
      !(await isBotFeatureAccessAllowed({
        action: 'manage',
        applicationId,
        platform,
        userId: provider.userId,
        workspaceId: provider.workspaceId ?? undefined,
      }))
    ) {
      log('Feature access denied for %s', key);
      return;
    }

    const client = this.createClient(platform, provider);
    if (!client) {
      log('Unsupported platform: %s', platform);
      return;
    }

    await this.startRegisteredClient(key, client);
    log('Started client %s', key);
  }

  async stopClient(platform: string, applicationId: string): Promise<void> {
    const key = buildRuntimeKey(platform, applicationId);
    const client = this.clients.get(key);
    if (!client) return;

    await this.retireClient(key, client);
    log('Stopped client %s', key);
  }

  /**
   * Register `client` before awaiting its start, so anything that checks the
   * map meanwhile sees this bot as taken instead of opening a second
   * connection. QQ's start() only resolves after the gateway handshake
   * (token → bot info → gateway URL → WebSocket → Identify → READY), which
   * otherwise leaves a window of several seconds.
   */
  private async startRegisteredClient(key: string, client: PlatformClient): Promise<void> {
    // A concurrent startClient for the same bot can register its client while
    // this call was still loading the provider. Take the slot and retire that
    // one first, so only one connection survives.
    const concurrent = this.clients.get(key);
    this.clients.set(key, client);
    if (concurrent && concurrent !== client) {
      log('Replacing client %s registered while this one was loading', key);
      await concurrent.stop().catch((err) => {
        log('Failed to stop replaced client %s: %O', key, err);
      });
    }

    try {
      await client.start();
    } catch (error) {
      if (this.clients.get(key) === client) this.clients.delete(key);
      throw error;
    }

    // stopClient, stop or a newer startClient retired this client while it
    // was still connecting. Tear down what start() opened so it does not
    // linger as a connection nothing tracks.
    if (this.clients.get(key) !== client) {
      log('Client %s was retired while starting, stopping it', key);
      await client.stop().catch((err) => {
        log('Failed to stop retired client %s: %O', key, err);
      });
    }
  }

  /**
   * Stop a client and drop its slot — unless a newer client took the slot
   * while this one was stopping.
   */
  private async retireClient(key: string, client: PlatformClient): Promise<void> {
    await client.stop();
    if (this.clients.get(key) === client) this.clients.delete(key);
  }

  // ------------------------------------------------------------------
  // DB sync
  // ------------------------------------------------------------------

  private async sync(): Promise<void> {
    for (const platform of this.definitionByPlatform.keys()) {
      try {
        await this.syncPlatform(platform);
      } catch (error) {
        console.error('[GatewayManager] Sync error for %s:', platform, error);
      }
    }
  }

  private async syncPlatform(platform: string): Promise<void> {
    const serverDB = await getServerDB();
    const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
    const providers = await AgentBotProviderModel.findEnabledByPlatform(
      serverDB,
      platform,
      gateKeeper,
    );

    log('Sync: found %d enabled providers for %s', providers.length, platform);

    const activeKeys = new Set<string>();

    for (const provider of providers) {
      const { applicationId, credentials } = provider;
      const key = buildRuntimeKey(platform, applicationId);
      activeKeys.add(key);

      log('Sync: processing provider %s, hasCredentials=%s', key, !!credentials);

      if (
        !(await isBotFeatureAccessAllowed({
          applicationId,
          platform,
          userId: provider.userId,
          workspaceId: provider.workspaceId ?? undefined,
        }))
      ) {
        const existing = this.clients.get(key);
        if (existing) await this.retireClient(key, existing);
        // Keep the cached runtime snapshot in sync with the stop — otherwise
        // the channel UI keeps reporting a connected bot that was just
        // paid-gated. Mirrors the external-gateway and cron sync paths.
        await updateBotRuntimeStatus({
          applicationId,
          errorMessage: getBotFeatureBlockedMessage(
            platform,
            provider.workspaceId ? 'workspace' : 'personal',
          ),
          platform,
          status: BOT_RUNTIME_STATUSES.failed,
        });
        log('Sync: feature access denied for %s', key);
        continue;
      }

      const existing = this.clients.get(key);
      if (existing) {
        log('Sync: client %s already running, skipping', key);
        continue;
      }

      try {
        const client = this.createClient(platform, provider);
        if (!client) {
          log('Sync: createClient returned null for %s', key);
          continue;
        }

        await this.startRegisteredClient(key, client);
        log('Sync: started client %s', key);
      } catch (err) {
        log('Sync: failed to start client %s: %O', key, err);
      }
    }

    // Stop clients that are no longer in DB
    for (const [key, client] of this.clients) {
      if (!key.startsWith(`${platform}:`)) continue;
      if (activeKeys.has(key)) continue;

      log('Sync: client %s removed from DB, stopping', key);
      await this.retireClient(key, client);
    }
  }

  // ------------------------------------------------------------------
  // Factory
  // ------------------------------------------------------------------

  private createClient(platform: string, provider: DecryptedBotProvider): PlatformClient | null {
    const def = this.definitionByPlatform.get(platform);
    if (!def) {
      log('No definition registered for platform: %s', platform);
      return null;
    }

    const { config } = resolveBotProviderConfig(def, provider);

    const context: BotPlatformRuntimeContext = {
      appUrl: process.env.APP_URL,
      redisClient: getAgentRuntimeRedisClient() as any,
      userId: provider.userId,
    };

    return def.clientFactory.createClient(config, context);
  }
}

// ------------------------------------------------------------------
// Singleton
// ------------------------------------------------------------------

const globalForGateway = globalThis as unknown as { gatewayManager?: GatewayManager };

export function getGatewayManager(): GatewayManager | undefined {
  return globalForGateway.gatewayManager;
}

export function createGatewayManager(config: GatewayManagerConfig): GatewayManager {
  if (!globalForGateway.gatewayManager) {
    globalForGateway.gatewayManager = new GatewayManager(config);
  }
  return globalForGateway.gatewayManager;
}
