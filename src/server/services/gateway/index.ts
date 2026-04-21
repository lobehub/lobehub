import debug from 'debug';

import { getServerDB } from '@/database/core/db-adaptor';
import { AgentBotProviderModel } from '@/database/models/agentBotProvider';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

import {
  type BotRuntimeStatus,
  type BotRuntimeStatusSnapshot,
} from '../../../types/botRuntimeStatus';
import type { ConnectionMode } from '../bot/platforms';
import { getEffectiveConnectionMode, platformRegistry } from '../bot/platforms';
import { BOT_CONNECT_QUEUE_EXPIRE_MS, BotConnectQueue } from './botConnectQueue';
import { createGatewayManager, getGatewayManager } from './GatewayManager';
import {
  getMessageGatewayClient,
  type MessageGatewayConnectionStatus,
} from './MessageGatewayClient';
import { BOT_RUNTIME_STATUSES, getBotRuntimeStatus, updateBotRuntimeStatus } from './runtimeStatus';

function mapGatewayStatusToRuntimeStatus(
  status: MessageGatewayConnectionStatus['state']['status'],
): BotRuntimeStatus {
  switch (status) {
    case 'connected': {
      return BOT_RUNTIME_STATUSES.connected;
    }
    case 'connecting': {
      return BOT_RUNTIME_STATUSES.starting;
    }
    case 'disconnected': {
      return BOT_RUNTIME_STATUSES.disconnected;
    }
    case 'dormant': {
      return BOT_RUNTIME_STATUSES.dormant;
    }
    case 'error': {
      return BOT_RUNTIME_STATUSES.failed;
    }
  }
}

const log = debug('lobe-server:service:gateway');

const isVercel = !!process.env.VERCEL_ENV;

export class GatewayService {
  /**
   * Whether to use the external message-gateway for connection management.
   * Requires MESSAGE_GATEWAY_ENABLED=1 plus URL/TOKEN to be configured.
   * This allows disabling the gateway (for migration) while keeping
   * the client reachable for cleanup.
   */
  get useMessageGateway(): boolean {
    return getMessageGatewayClient().isEnabled;
  }

  async ensureRunning(): Promise<void> {
    if (this.useMessageGateway) {
      await this.syncGatewayConnections();
      return;
    }

    const existing = getGatewayManager();
    if (existing?.isRunning) {
      log('GatewayManager already running');
      return;
    }

    // Start local connections first, then clean up gateway —
    // brief overlap is better than a gap where messages are lost.
    const manager = createGatewayManager({ definitions: platformRegistry.listPlatforms() });
    await manager.start();
    log('GatewayManager started');

    // Clean up leftover gateway connections to prevent duplicates.
    const client = getMessageGatewayClient();
    if (client.isConfigured) {
      try {
        const result = await client.disconnectAll();
        if (result.total > 0) {
          log('Cleaned up %d gateway connections', result.total);
        }
      } catch (err) {
        log('Gateway cleanup skipped (non-critical): %O', err);
      }
    }
  }

  /**
   * Sync all enabled bots to the external message-gateway.
   * Called on startup to recover connections after LobeHub restarts.
   */
  private async syncGatewayConnections(): Promise<void> {
    const { getServerDB } = await import('@/database/core/db-adaptor');
    const { AgentBotProviderModel } = await import('@/database/models/agentBotProvider');
    const { KeyVaultsGateKeeper } = await import('@/server/modules/KeyVaultsEncrypt');

    const client = getMessageGatewayClient();
    const serverDB = await getServerDB();
    const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();

    let totalSynced = 0;
    let totalSkipped = 0;
    let totalFailed = 0;

    // Sync all registered platforms
    for (const definition of platformRegistry.listPlatforms()) {
      const platform = definition.id;
      try {
        const providers = await AgentBotProviderModel.findEnabledByPlatform(
          serverDB,
          platform,
          gateKeeper,
        );

        let synced = 0;
        let skippedWebhook = 0;
        let skippedConnected = 0;
        let failed = 0;

        for (const provider of providers) {
          try {
            const definition = platformRegistry.getPlatform(platform);
            const connectionMode = getEffectiveConnectionMode(definition, provider.settings);

            // Webhook-mode platforms don't need persistent gateway connections.
            // The webhook URL is set once when the user saves the bot config
            // (via startClientViaGateway). No action needed during periodic sync.
            if (connectionMode === 'webhook') {
              skippedWebhook++;
              continue;
            }

            // For persistent connections, check gateway status before reconnecting
            try {
              const status = await client.getStatus(provider.id);
              if (status.state.status === 'connected' || status.state.status === 'connecting') {
                skippedConnected++;
                log('Gateway sync: %s already %s, skipping', provider.id, status.state.status);
                continue;
              }
              // Dormant: gateway is running sparse alarm-driven polling and will
              // self-wake when a message arrives. Reconnecting here would defeat
              // the purpose — only manual reconnect (startClient) should override.
              if (status.state.status === 'dormant') {
                skippedConnected++;
                log('Gateway sync: %s dormant, skipping (DO is sparse-polling)', provider.id);
                continue;
              }
              // "error" means credential/config issue (e.g. session expired, unauthorized).
              // Auto-retry is pointless — only user action (saving new credentials) can fix it.
              if (status.state.status === 'error') {
                skippedConnected++;
                log('Gateway sync: %s in error (%s), skipping', provider.id, status.state.error);
                continue;
              }
            } catch {
              // Status check failed — try to connect
            }

            const webhookPath = `/api/agent/webhooks/${platform}/${provider.applicationId}`;
            const result = await client.connect({
              applicationId: provider.applicationId,
              connectionId: provider.id,
              connectionMode,
              credentials: provider.credentials,
              platform,
              userId: provider.userId,
              webhookPath,
            });

            // Gateway returns "connecting" for async persistent connections
            // (e.g. Discord WebSocket), "connected" for sync webhook-mode.
            const runtimeStatus =
              result.status === 'connected'
                ? BOT_RUNTIME_STATUSES.connected
                : BOT_RUNTIME_STATUSES.starting;

            await updateBotRuntimeStatus({
              applicationId: provider.applicationId,
              platform,
              status: runtimeStatus,
            });

            synced++;
            log('Gateway sync: %s %s:%s', result.status, platform, provider.applicationId);
          } catch (err) {
            failed++;
            log('Gateway sync: failed to connect %s:%s: %O', platform, provider.applicationId, err);
          }
        }

        log(
          'Gateway sync: %s — total=%d synced=%d skippedWebhook=%d skippedConnected=%d failed=%d',
          platform,
          providers.length,
          synced,
          skippedWebhook,
          skippedConnected,
          failed,
        );

        totalSynced += synced;
        totalSkipped += skippedWebhook + skippedConnected;
        totalFailed += failed;
      } catch (err) {
        log('Gateway sync: error syncing platform %s: %O', platform, err);
      }
    }

    log(
      'Gateway sync complete: synced=%d skipped=%d failed=%d',
      totalSynced,
      totalSkipped,
      totalFailed,
    );
  }

  async stop(): Promise<void> {
    const manager = getGatewayManager();
    if (!manager) return;

    await manager.stop();
    log('GatewayManager stopped');
  }

  async startClient(
    platform: string,
    applicationId: string,
    userId: string,
  ): Promise<'started' | 'queued'> {
    if (this.useMessageGateway) {
      return this.startClientViaGateway(platform, applicationId, userId);
    }

    // ─── Legacy: in-process connection management ───
    if (isVercel) {
      // Load the provider so we can resolve per-provider connection mode.
      // The platform default is only a fallback — Slack/Feishu (default websocket)
      // can be configured for webhook mode per provider, and vice versa.
      const definition = platformRegistry.getPlatform(platform);
      const serverDB = await getServerDB();
      const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
      const model = new AgentBotProviderModel(serverDB, userId, gateKeeper);
      const provider = await model.findEnabledByApplicationId(platform, applicationId);

      const connectionMode = getEffectiveConnectionMode(definition, provider?.settings);

      if (connectionMode !== 'webhook') {
        // Persistent platforms (e.g. Discord gateway or WeChat long-polling) cannot run in a
        // serverless function — queue for the long-running cron gateway.
        const queue = new BotConnectQueue();
        await queue.push(platform, applicationId, userId);
        await updateBotRuntimeStatus(
          {
            applicationId,
            platform,
            status: BOT_RUNTIME_STATUSES.queued,
          },
          {
            ttlMs: BOT_CONNECT_QUEUE_EXPIRE_MS,
          },
        );
        log('Queued connect %s:%s', platform, applicationId);
        return 'queued';
      }

      const manager = createGatewayManager({ definitions: platformRegistry.listPlatforms() });
      await manager.startClient(platform, applicationId, userId);
      log('Started client %s:%s (direct)', platform, applicationId);
      return 'started';
    }

    let manager = getGatewayManager();
    if (!manager?.isRunning) {
      log('GatewayManager not running, starting automatically...');
      await this.ensureRunning();
      manager = getGatewayManager();
    }

    await manager!.startClient(platform, applicationId, userId);
    log('Started client %s:%s', platform, applicationId);
    return 'started';
  }

  /**
   * Pull live status from the gateway for every enabled provider under an
   * agent and persist each result to Redis. No-op when the gateway is
   * disabled; webhook-mode providers are skipped (they have no persistent
   * gateway connection to query).
   */
  async refreshBotRuntimeStatusesByAgent(agentId: string, userId: string): Promise<void> {
    if (!this.useMessageGateway) return;

    const serverDB = await getServerDB();
    const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
    const model = new AgentBotProviderModel(serverDB, userId, gateKeeper);
    const providers = await model.findByAgentId(agentId);
    const client = getMessageGatewayClient();

    await Promise.all(
      providers.map(async (provider) => {
        if (!provider.enabled) return;

        const definition = platformRegistry.getPlatform(provider.platform);
        const connectionMode = getEffectiveConnectionMode(definition, provider.settings);
        if (connectionMode === 'webhook') return;

        try {
          const { state } = await client.getStatus(provider.id);
          await updateBotRuntimeStatus({
            applicationId: provider.applicationId,
            errorMessage: state.error,
            platform: provider.platform,
            status: mapGatewayStatusToRuntimeStatus(state.status),
          });
        } catch (err) {
          log(
            'Bulk refresh: gateway status failed %s:%s: %O',
            provider.platform,
            provider.applicationId,
            err,
          );
        }
      }),
    );
  }

  /**
   * Pull the live connection status from the external message-gateway and
   * persist it to the local Redis snapshot. When the gateway is disabled or
   * the provider runs in webhook mode, returns the cached snapshot as-is.
   */
  async refreshBotRuntimeStatus(
    platform: string,
    applicationId: string,
    userId: string,
  ): Promise<BotRuntimeStatusSnapshot> {
    const cached = await getBotRuntimeStatus(platform, applicationId);

    if (!this.useMessageGateway) return cached;

    const serverDB = await getServerDB();
    const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
    const model = new AgentBotProviderModel(serverDB, userId, gateKeeper);
    const provider = await model.findEnabledByApplicationId(platform, applicationId);

    if (!provider) return cached;

    const definition = platformRegistry.getPlatform(platform);
    const connectionMode = getEffectiveConnectionMode(definition, provider.settings);

    // Webhook-mode bots have no persistent gateway connection to query — the
    // gateway only holds the webhook URL registration, so the local snapshot
    // is already the source of truth.
    if (connectionMode === 'webhook') return cached;

    const client = getMessageGatewayClient();
    try {
      const { state } = await client.getStatus(provider.id);
      return await updateBotRuntimeStatus({
        applicationId,
        errorMessage: state.error,
        platform,
        status: mapGatewayStatusToRuntimeStatus(state.status),
      });
    } catch (err) {
      log('Refresh runtime status via gateway failed %s:%s: %O', platform, applicationId, err);
      return cached;
    }
  }

  async stopClient(platform: string, applicationId: string, userId?: string): Promise<void> {
    if (this.useMessageGateway) {
      return this.stopClientViaGateway(platform, applicationId);
    }

    // ─── Legacy: in-process connection management ───
    if (isVercel) {
      // Without a userId we cannot resolve per-provider settings; fall back to the
      // platform default to decide if a queue cleanup is even worth attempting.
      // queue.remove is a no-op for absent keys, so a stale check is harmless.
      let connectionMode: ConnectionMode;
      const definition = platformRegistry.getPlatform(platform);
      if (userId) {
        const serverDB = await getServerDB();
        const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
        const model = new AgentBotProviderModel(serverDB, userId, gateKeeper);
        const provider = await model.findEnabledByApplicationId(platform, applicationId);
        connectionMode = getEffectiveConnectionMode(definition, provider?.settings);
      } else {
        connectionMode = getEffectiveConnectionMode(definition, undefined);
      }

      if (connectionMode !== 'webhook') {
        const queue = new BotConnectQueue();
        await queue.remove(platform, applicationId);
      }
    }

    const manager = getGatewayManager();
    if (manager?.isRunning) {
      await manager.stopClient(platform, applicationId);
      log('Stopped client %s:%s', platform, applicationId);
    }

    await updateBotRuntimeStatus({
      applicationId,
      platform,
      status: BOT_RUNTIME_STATUSES.disconnected,
    });
  }

  // ─── External Message Gateway ───

  private async startClientViaGateway(
    platform: string,
    applicationId: string,
    userId: string,
  ): Promise<'started'> {
    const client = getMessageGatewayClient();

    const { getServerDB } = await import('@/database/core/db-adaptor');
    const { AgentBotProviderModel } = await import('@/database/models/agentBotProvider');
    const { KeyVaultsGateKeeper } = await import('@/server/modules/KeyVaultsEncrypt');

    const serverDB = await getServerDB();
    const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
    const model = new AgentBotProviderModel(serverDB, userId, gateKeeper);
    const provider = await model.findEnabledByApplicationId(platform, applicationId);

    if (!provider) {
      log('No enabled provider found for %s:%s', platform, applicationId);
      throw new Error(`No enabled provider found for ${platform}:${applicationId}`);
    }

    const definition = platformRegistry.getPlatform(platform);
    const connectionMode = getEffectiveConnectionMode(definition, provider.settings);

    // Webhook-mode platforms don't need persistent gateway connections.
    // Run the platform client locally via GatewayManager so each platform can
    // perform its own initialization (e.g. Telegram calls setWebhook).
    if (connectionMode === 'webhook') {
      const manager = createGatewayManager({ definitions: platformRegistry.listPlatforms() });
      await manager.startClient(platform, applicationId, userId);
      log('Started webhook-mode client locally %s:%s', platform, applicationId);
      return 'started';
    }

    const webhookPath = `/api/agent/webhooks/${platform}/${applicationId}`;

    await client.connect({
      applicationId: provider.applicationId,
      connectionId: provider.id,
      connectionMode,
      credentials: provider.credentials,
      platform,
      userId,
      webhookPath,
    });

    await updateBotRuntimeStatus({
      applicationId,
      platform,
      status: BOT_RUNTIME_STATUSES.connected,
    });

    log('Started client via message-gateway %s:%s', platform, applicationId);
    return 'started';
  }

  private async stopClientViaGateway(platform: string, applicationId: string): Promise<void> {
    // Stop locally-managed webhook client if it exists (e.g. Telegram deleteWebhook)
    const manager = getGatewayManager();
    if (manager) {
      await manager.stopClient(platform, applicationId);
    }

    const client = getMessageGatewayClient();

    const { getServerDB } = await import('@/database/core/db-adaptor');
    const { AgentBotProviderModel } = await import('@/database/models/agentBotProvider');

    const serverDB = await getServerDB();
    const provider = await AgentBotProviderModel.findByPlatformAndAppId(
      serverDB,
      platform,
      applicationId,
    );

    if (provider) {
      try {
        await client.disconnect(provider.id);
      } catch (err) {
        log('Disconnect via message-gateway failed: %O', err);
      }
    }

    await updateBotRuntimeStatus({
      applicationId,
      platform,
      status: BOT_RUNTIME_STATUSES.disconnected,
    });

    log('Stopped client via message-gateway %s:%s', platform, applicationId);
  }
}
