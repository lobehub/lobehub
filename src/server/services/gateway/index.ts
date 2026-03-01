import debug from 'debug';

import { platformBotRegistry } from '../bot/platforms';
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

  async startBot(
    platform: string,
    applicationId: string,
    userId: string,
  ): Promise<'started' | 'queued'> {
    if (isVercel) {
      const queue = new BotConnectQueue();
      await queue.push(platform, applicationId, userId);
      log('Queued bot connect %s:%s', platform, applicationId);
      return 'queued';
    }

    let manager = getGatewayManager();
    if (!manager?.isRunning) {
      log('GatewayManager not running, starting automatically...');
      await this.ensureRunning();
      manager = getGatewayManager();
    }

    await manager!.startBot(platform, applicationId, userId);
    log('Started bot %s:%s', platform, applicationId);
    return 'started';
  }

  async stopBot(platform: string, applicationId: string): Promise<void> {
    const manager = getGatewayManager();
    if (!manager?.isRunning) return;

    await manager.stopBot(platform, applicationId);
    log('Stopped bot %s:%s', platform, applicationId);
  }
}
