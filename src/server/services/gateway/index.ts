import debug from 'debug';

import { getServerDB } from '@/database/core/db-adaptor';
import { AgentBotProviderModel } from '@/database/models/agentBotProvider';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

import { platformRegistry } from '../bot/platforms';
import { BotConnectQueue } from './botConnectQueue';
import { createGatewayManager, getGatewayManager } from './GatewayManager';

const log = debug('lobe-server:service:gateway');

const isVercel = !!process.env.VERCEL_ENV;

export class GatewayService {
  async ensureRunning(): Promise<void> {
    const existing = getGatewayManager();
    if (existing?.isRunning) {
      log('GatewayManager already running');
      return;
    }

    const manager = createGatewayManager({ definitions: platformRegistry.listPlatforms() });
    await manager.start();

    log('GatewayManager started');
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
    if (isVercel) {
      // Query DB to determine connection mode from user settings
      const connectionMode = await this.getConnectionMode(platform, applicationId, userId);

      if (connectionMode === 'websocket') {
        // Persistent platforms (e.g. Discord WebSocket) cannot run in a
        // serverless function — queue for the long-running cron gateway.
        const queue = new BotConnectQueue();
        await queue.push(platform, applicationId, userId);
        log('Queued connect %s:%s', platform, applicationId);
        return 'queued';
      }

      // Webhook-based platforms only need a single HTTP call,
      // so we can run directly in a Vercel serverless function.
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

  async stopClient(platform: string, applicationId: string): Promise<void> {
    const manager = getGatewayManager();
    if (!manager?.isRunning) return;

    await manager.stopClient(platform, applicationId);
    log('Stopped client %s:%s', platform, applicationId);
  }

  /**
   * Read the connectionMode from the bot provider's settings.
   * Defaults to 'webhook' if not configured.
   */
  private async getConnectionMode(
    platform: string,
    applicationId: string,
    userId: string,
  ): Promise<string> {
    try {
      const serverDB = await getServerDB();
      const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
      const model = new AgentBotProviderModel(serverDB, userId, gateKeeper);
      const provider = await model.findEnabledByApplicationId(platform, applicationId);
      return (provider?.settings as any)?.connectionMode || 'webhook';
    } catch (err) {
      log('Failed to read connectionMode for %s:%s: %O', platform, applicationId, err);
      return 'webhook';
    }
  }
}
