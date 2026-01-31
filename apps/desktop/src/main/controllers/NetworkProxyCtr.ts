import { NetworkProxySettings } from '@lobechat/electron-client-ipc';
import { isEqual, merge } from 'es-toolkit/compat';

import { defaultProxySettings } from '@/const/store';
import { createLogger } from '@/utils/logger';

import {
  ProxyConfigValidator,
  ProxyConnectionTester,
  ProxyDispatcherManager,
  ProxyTestResult,
} from '../modules/networkProxy';
import { ControllerModule, IpcMethod } from './index';

// Create logger
const logger = createLogger('controllers:NetworkProxyCtr');

/**
 * Network proxy controller
 * Handle desktop application network proxy related functions
 */
export default class NetworkProxyCtr extends ControllerModule {
  static override readonly groupName = 'networkProxy';
  /**
   * Get proxy settings
   */
  @IpcMethod()
  async getDesktopSettings(): Promise<NetworkProxySettings> {
    try {
      const settings = this.app.storeManager.get(
        'networkProxy',
        defaultProxySettings,
      ) as NetworkProxySettings;
      logger.debug('Retrieved proxy settings:', {
        enableProxy: settings.enableProxy,
        proxyType: settings.proxyType,
      });
      return settings;
    } catch (error) {
      logger.error('Failed to get proxy settings:', error);
      return defaultProxySettings;
    }
  }

  /**
   * Set proxy configuration
   */
  @IpcMethod()
  async setProxySettings(config: Partial<NetworkProxySettings>): Promise<void> {
    try {
      // Get current configuration
      const currentConfig = this.app.storeManager.get(
        'networkProxy',
        defaultProxySettings,
      ) as NetworkProxySettings;

      // Merge configuration and validate
      const newConfig = merge({}, currentConfig, config);

      const validation = ProxyConfigValidator.validate(newConfig);
      if (!validation.isValid) {
        const errorMessage = `Invalid proxy configuration: ${validation.errors.join(', ')}`;
        logger.error(errorMessage);
        throw new Error(errorMessage);
      }

      if (isEqual(currentConfig, newConfig)) {
        logger.debug('Proxy settings unchanged, skipping update');
        return;
      }

      // Apply proxy settings
      await ProxyDispatcherManager.applyProxySettings(newConfig);

      // Save to storage
      this.app.storeManager.set('networkProxy', newConfig);

      logger.info('Proxy settings updated successfully', {
        enableProxy: newConfig.enableProxy,
        proxyPort: newConfig.proxyPort,
        proxyServer: newConfig.proxyServer,
        proxyType: newConfig.proxyType,
      });
    } catch (error) {
      logger.error('Failed to update proxy settings:', error);
      throw error;
    }
  }

  /**
   * Test proxy connection
   */
  @IpcMethod()
  async testProxyConnection(url: string): Promise<{ message?: string; success: boolean }> {
    try {
      const result = await ProxyConnectionTester.testConnection(url);

      if (result.success) {
        return { success: true };
      } else {
        throw new Error(result.message || 'Connection test failed');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Proxy connection test failed:', errorMessage);
      throw new Error(`Connection failed: ${errorMessage}`);
    }
  }

  /**
   * Test specified proxy configuration
   */
  @IpcMethod()
  async testProxyConfig({
    config,
    testUrl,
  }: {
    config: NetworkProxySettings;
    testUrl?: string;
  }): Promise<ProxyTestResult> {
    try {
      return await ProxyConnectionTester.testProxyConfig(config, testUrl);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Proxy config test failed:', errorMessage);
      return {
        message: `Proxy config test failed: ${errorMessage}`,
        success: false,
      };
    }
  }

  /**
   * Apply initial proxy settings
   */
  async beforeAppReady(): Promise<void> {
    try {
      // Get stored proxy settings
      const networkProxy = this.app.storeManager.get(
        'networkProxy',
        defaultProxySettings,
      ) as NetworkProxySettings;

      // Validate configuration
      const validation = ProxyConfigValidator.validate(networkProxy);
      if (!validation.isValid) {
        logger.warn('Invalid stored proxy configuration, using defaults:', validation.errors);
        await ProxyDispatcherManager.applyProxySettings(defaultProxySettings);
        return;
      }

      // Apply proxy settings
      await ProxyDispatcherManager.applyProxySettings(networkProxy);

      logger.info('Initial proxy settings applied successfully', {
        enableProxy: networkProxy.enableProxy,
        proxyType: networkProxy.proxyType,
      });
    } catch (error) {
      logger.error('Failed to apply initial proxy settings:', error);
      // Use default settings on error
      try {
        await ProxyDispatcherManager.applyProxySettings(defaultProxySettings);
        logger.info('Fallback to default proxy settings');
      } catch (fallbackError) {
        logger.error('Failed to apply fallback proxy settings:', fallbackError);
      }
    }
  }
}
