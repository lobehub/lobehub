import debug from 'debug';

import { getServerDB } from '@/database/core/db-adaptor';
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

const log = debug('lobe-server:bot-gateway');

export interface GatewayManagerConfig {
  definitions: PlatformDefinition[];
}

export class GatewayManager {
  private clients = new Map<string, PlatformClient>();
  private running = false;
  private config: GatewayManagerConfig;

  private definitionByPlatform: Map<string, PlatformDefinition>;

  constructor(config: GatewayManagerConfig) {
    this.config = config;
    this.definitionByPlatform = new Map(this.config.definitions.map((e) => [e.id, e]));
  }

  get isRunning(): boolean {
    return this.running;
  }

  // ------------------------------------------------------------------
  // Lifecycle (call once)
  // ------------------------------------------------------------------

  async start(): Promise<void> {
    if (this.running) {
      log('GatewayManager already running, skipping');
      return;
    }

    log('Starting GatewayManager');

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
      await client.stop();
    }
    this.clients.clear();

    this.running = false;
    log('GatewayManager stopped');
  }

  // ------------------------------------------------------------------
  // Client operations (point-to-point)
  // ------------------------------------------------------------------

  async startClient(platform: string, applicationId: string, userId: string): Promise<void> {
    const key = buildRuntimeKey(platform, applicationId);

    // Stop existing if any
    const existing = this.clients.get(key);
    if (existing) {
      log('Stopping existing client %s before restart', key);
      await existing.stop();
      this.clients.delete(key);
    }

    // Load from DB (user-scoped, single row)
    const serverDB = await getServerDB();
    const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
    const model = new AgentBotProviderModel(serverDB, userId, gateKeeper);
    const provider = await model.findEnabledByApplicationId(platform, applicationId);

    if (!provider) {
      log('No enabled provider found for %s', key);
      return;
    }

    const client = this.createClient(platform, provider);
    if (!client) {
      log('Unsupported platform: %s', platform);
      return;
    }

    await client.start();
    this.clients.set(key, client);
    log('Started client %s', key);
  }

  async stopClient(platform: string, applicationId: string): Promise<void> {
    const key = buildRuntimeKey(platform, applicationId);
    const client = this.clients.get(key);
    if (!client) return;

    await client.stop();
    this.clients.delete(key);
    log('Stopped client %s', key);
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

        await client.start();
        this.clients.set(key, client);
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
      await client.stop();
      this.clients.delete(key);
    }
  }

  // ------------------------------------------------------------------
  // Factory
  // ------------------------------------------------------------------

  private createClient(
    platform: string,
    provider: {
      applicationId: string;
      credentials: Record<string, string>;
      settings?: Record<string, unknown> | null;
    },
  ): PlatformClient | null {
    const def = this.definitionByPlatform.get(platform);
    if (!def) {
      log('No definition registered for platform: %s', platform);
      return null;
    }

    const { config } = resolveBotProviderConfig(def, provider);

    const context: BotPlatformRuntimeContext = {
      appUrl: process.env.APP_URL,
      redisClient: getAgentRuntimeRedisClient() as any,
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
