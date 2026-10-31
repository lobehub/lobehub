import debug from 'debug';

import { assertBotFeatureAccess } from '@/business/server/bot/featureAccess';
import { getServerDB } from '@/database/core/db-adaptor';
import { AgentBotProviderModel } from '@/database/models/agentBotProvider';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import type { BotRuntimeStatusSnapshot } from '@/types/botRuntimeStatus';

import { type ConnectionMode, platformRegistry, resolveConnectionMode } from '../bot/platforms';
import { BOT_CONNECT_QUEUE_EXPIRE_MS, BotConnectQueue } from './botConnectQueue';
import { createGatewayManager, getGatewayManager } from './GatewayManager';
import { mapGatewayStatusToRuntimeStatus, resolveBotGatewayCapabilities } from './gatewayMapping';
import {
  getConfiguredMessageGatewayHosts,
  getMessageGatewayClient,
  getMessageGatewayClientForHost,
  isAnyMessageGatewayEnabled,
  type MessageGatewayHost,
} from './MessageGatewayClient';
import { BOT_RUNTIME_STATUSES, getBotRuntimeStatus, updateBotRuntimeStatus } from './runtimeStatus';
import { syncGatewayConnections } from './sync';
import * as desiredForHost from './sync/desiredForHost';
import type { UserMessengerConnectionParams } from './userMessenger';
import * as userMessenger from './userMessenger';

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
    return isAnyMessageGatewayEnabled();
  }

  async ensureRunning(): Promise<void> {
    if (this.useMessageGateway) {
      await syncGatewayConnections();
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
    for (const host of getConfiguredMessageGatewayHosts()) {
      const client = getMessageGatewayClientForHost(host);
      if (!client.isConfigured) continue;
      try {
        const result = await client.disconnectAll();
        if (result.total > 0) {
          log('Cleaned up %d gateway connections on %s host', result.total, host);
        }
      } catch (err) {
        log('Gateway cleanup skipped on %s host (non-critical): %O', host, err);
      }
    }
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
      const provider = await AgentBotProviderModel.findEnabledByPlatformAndAppId(
        serverDB,
        platform,
        applicationId,
        gateKeeper,
      );

      const connectionMode = resolveConnectionMode(definition, provider?.settings);

      if (provider) {
        await assertBotFeatureAccess({
          action: 'manage',
          applicationId,
          platform,
          userId: provider.userId,
          workspaceId: provider.workspaceId ?? undefined,
        });
      }

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
      await manager.startClient(platform, applicationId);
      log('Started client %s:%s (direct)', platform, applicationId);
      return 'started';
    }

    let manager = getGatewayManager();
    if (!manager?.isRunning) {
      log('GatewayManager not running, starting automatically...');
      await this.ensureRunning();
      manager = getGatewayManager();
    }

    await manager!.startClient(platform, applicationId);
    log('Started client %s:%s', platform, applicationId);
    return 'started';
  }

  /**
   * Pull live status from the gateway for every enabled provider under an
   * agent and persist each result to Redis. No-op when the gateway is
   * disabled; webhook-mode providers are skipped (they have no persistent
   * gateway connection to query).
   */
  async refreshBotRuntimeStatusesByAgent(agentId: string): Promise<void> {
    if (!this.useMessageGateway) return;

    const serverDB = await getServerDB();
    const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
    const providers = await AgentBotProviderModel.findByAgentId(serverDB, agentId, gateKeeper);

    await Promise.all(
      providers.map(async (provider) => {
        if (!provider.enabled) return;

        const definition = platformRegistry.getPlatform(provider.platform);
        const connectionMode = resolveConnectionMode(definition, provider.settings);
        if (connectionMode === 'webhook') return;

        try {
          const client = getMessageGatewayClient(provider.platform);
          const { state } = await client.getStatus(provider.id);
          await updateBotRuntimeStatus({
            applicationId: provider.applicationId,
            errorCode: state.errorCode,
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
  ): Promise<BotRuntimeStatusSnapshot> {
    const cached = await getBotRuntimeStatus(platform, applicationId);

    if (!this.useMessageGateway) return cached;

    const serverDB = await getServerDB();
    const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
    const provider = await AgentBotProviderModel.findEnabledByPlatformAndAppId(
      serverDB,
      platform,
      applicationId,
      gateKeeper,
    );

    if (!provider) return cached;

    const definition = platformRegistry.getPlatform(platform);
    const connectionMode = resolveConnectionMode(definition, provider.settings);

    // Webhook-mode bots have no persistent gateway connection to query — the
    // gateway only holds the webhook URL registration, so the local snapshot
    // is already the source of truth.
    if (connectionMode === 'webhook') return cached;

    const client = getMessageGatewayClient(platform);
    try {
      const { state } = await client.getStatus(provider.id);
      return await updateBotRuntimeStatus({
        applicationId,
        errorCode: state.errorCode,
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
        const provider = await AgentBotProviderModel.findEnabledByPlatformAndAppId(
          serverDB,
          platform,
          applicationId,
          gateKeeper,
        );
        connectionMode = resolveConnectionMode(definition, provider?.settings);
      } else {
        connectionMode = resolveConnectionMode(definition, undefined);
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

  listDesiredConnectionsForHost(host: MessageGatewayHost) {
    return desiredForHost.listDesiredConnectionsForHost(host);
  }

  ensureUserMessengerConnected(params: UserMessengerConnectionParams) {
    return userMessenger.ensureUserMessengerConnected(params);
  }

  disconnectUserMessenger(params: UserMessengerConnectionParams) {
    return userMessenger.disconnectUserMessenger(params);
  }

  // ─── External Message Gateway ───

  private async startClientViaGateway(
    platform: string,
    applicationId: string,
    userId: string,
  ): Promise<'started'> {
    const client = getMessageGatewayClient(platform);

    const serverDB = await getServerDB();
    const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
    const provider = await AgentBotProviderModel.findEnabledByPlatformAndAppId(
      serverDB,
      platform,
      applicationId,
      gateKeeper,
    );

    if (!provider) {
      log('No enabled provider found for %s:%s', platform, applicationId);
      throw new Error(`No enabled provider found for ${platform}:${applicationId}`);
    }

    await assertBotFeatureAccess({
      action: 'manage',
      applicationId,
      platform,
      userId: provider.userId,
      workspaceId: provider.workspaceId ?? undefined,
    });

    const definition = platformRegistry.getPlatform(platform);
    const connectionMode = resolveConnectionMode(definition, provider.settings);

    // Webhook-mode platforms don't need persistent gateway connections.
    // Run the platform client locally via GatewayManager so each platform can
    // perform its own initialization (e.g. Telegram calls setWebhook).
    if (connectionMode === 'webhook') {
      const manager = createGatewayManager({ definitions: platformRegistry.listPlatforms() });
      await manager.startClient(platform, applicationId);
      log('Started webhook-mode client locally %s:%s', platform, applicationId);
      return 'started';
    }

    const webhookPath = `/api/agent/webhooks/${platform}/${applicationId}`;

    await client.connect({
      applicationId: provider.applicationId,
      capabilities: resolveBotGatewayCapabilities(provider.settings),
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

    const client = getMessageGatewayClient(platform);

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
