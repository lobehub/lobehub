import debug from 'debug';

import { platformBotRegistry } from '../bot/platforms';
import { createGatewayManager, getGatewayManager } from './GatewayManager';

const log = debug('lobe-server:service:gateway');

export class GatewayService {
  async ensureRunning(): Promise<void> {
    const existing = getGatewayManager();
    if (existing?.isRunning) {
      log('GatewayManager already running');
      return;
    }

    const manager = createGatewayManager({ registry: platformBotRegistry });
    await manager.start();

    log('GatewayManager started');
  }

  async stop(): Promise<void> {
    const manager = getGatewayManager();
    if (!manager) return;

    await manager.stop();
    log('GatewayManager stopped');
  }

  async startBot(platform: string, applicationId: string, userId: string): Promise<void> {
    const manager = getGatewayManager();
    if (!manager?.isRunning) {
      throw new Error('GatewayManager is not running. Call ensureRunning() first.');
    }

    await manager.startBot(platform, applicationId, userId);
    log('Started bot %s:%s', platform, applicationId);
  }

  async stopBot(platform: string, applicationId: string): Promise<void> {
    const manager = getGatewayManager();
    if (!manager?.isRunning) return;

    await manager.stopBot(platform, applicationId);
    log('Stopped bot %s:%s', platform, applicationId);
  }
}
