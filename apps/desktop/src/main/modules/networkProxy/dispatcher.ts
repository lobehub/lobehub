import type { NetworkProxySettings } from '@lobechat/electron-client-ipc';
import type { SocksProxies } from 'fetch-socks';
import { socksDispatcher } from 'fetch-socks';
import { Agent, getGlobalDispatcher, ProxyAgent, setGlobalDispatcher } from 'undici';

import { createLogger } from '@/utils/logger';

import { ProxyUrlBuilder } from './urlBuilder';

// Create logger
const logger = createLogger('modules:networkProxy:dispatcher');

/**
 * Proxy dispatcher manager
 */
export class ProxyDispatcherManager {
  private static isChanging = false;
  private static changeQueue: Array<() => Promise<void>> = [];

  /**
   * Apply proxy settings (with concurrency control)
   */
  static async applyProxySettings(config: NetworkProxySettings): Promise<void> {
    return new Promise((resolve, reject) => {
      const operation = async () => {
        try {
          await this.doApplyProxySettings(config);
          resolve();
        } catch (error) {
          reject(error);
        }
      };

      if (this.isChanging) {
        // If currently switching, add to queue
        this.changeQueue.push(operation);
      } else {
        // Execute immediately
        operation();
      }
    });
  }

  /**
   * Execute proxy settings application
   */
  private static async doApplyProxySettings(config: NetworkProxySettings): Promise<void> {
    this.isChanging = true;

    try {
      const currentDispatcher = getGlobalDispatcher();

      // Disable proxy, restore default connection
      if (!config.enableProxy) {
        await this.safeDestroyDispatcher(currentDispatcher);
        // Create a new default Agent to replace the proxy
        setGlobalDispatcher(new Agent());
        logger.debug('Proxy disabled, reset to direct connection mode');
        return;
      }

      // Build proxy URL
      const proxyUrl = ProxyUrlBuilder.build(config);

      // Create proxy agent
      const agent = this.createProxyAgent(config.proxyType, proxyUrl);

      // Destroy old dispatcher before switching proxy
      await this.safeDestroyDispatcher(currentDispatcher);
      setGlobalDispatcher(agent);

      logger.info(
        `Proxy settings applied: ${config.proxyType}://${config.proxyServer}:${config.proxyPort}`,
      );
      logger.debug(
        'Global request proxy set, all Node.js network requests will go through this proxy',
      );
    } finally {
      this.isChanging = false;

      // Process next operation in queue
      if (this.changeQueue.length > 0) {
        const nextOperation = this.changeQueue.shift();
        if (nextOperation) {
          setTimeout(() => nextOperation(), 0);
        }
      }
    }
  }

  /**
   * Create proxy agent
   */
  static createProxyAgent(proxyType: string, proxyUrl: string) {
    try {
      if (proxyType === 'socks5') {
        // Parse SOCKS5 proxy URL
        const url = new URL(proxyUrl);
        const socksProxies: SocksProxies = [
          {
            host: url.hostname,
            port: parseInt(url.port, 10),
            type: 5,
            ...(url.username && url.password
              ? {
                  password: url.password,
                  userId: url.username,
                }
              : {}),
          },
        ];

        // Use fetch-socks to handle SOCKS5 proxy
        return socksDispatcher(socksProxies);
      } else {
        // undici's ProxyAgent supports http, https
        return new ProxyAgent({ uri: proxyUrl });
      }
    } catch (error) {
      logger.error(`Failed to create proxy agent for ${proxyType}:`, error);
      throw new Error(
        `Failed to create proxy agent: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { cause: error },
      );
    }
  }

  /**
   * Safely destroy dispatcher
   */
  private static async safeDestroyDispatcher(dispatcher: any): Promise<void> {
    try {
      if (dispatcher && typeof dispatcher.destroy === 'function') {
        await dispatcher.destroy();
      }
    } catch (error) {
      logger.warn('Failed to destroy dispatcher:', error);
    }
  }
}
