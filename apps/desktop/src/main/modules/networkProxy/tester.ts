import { NetworkProxySettings } from '@lobechat/electron-client-ipc';
import { fetch, getGlobalDispatcher, setGlobalDispatcher } from 'undici';

import { appendVercelCookie } from '@/utils/http-headers';
import { createLogger } from '@/utils/logger';

import { ProxyDispatcherManager } from './dispatcher';
import { ProxyUrlBuilder } from './urlBuilder';
import { ProxyConfigValidator } from './validator';

// Create logger
const logger = createLogger('modules:networkProxy:tester');

/**
 * Proxy connection test result
 */
export interface ProxyTestResult {
  message?: string;
  responseTime?: number;
  success: boolean;
}

/**
 * Proxy connection tester
 */
export class ProxyConnectionTester {
  private static readonly DEFAULT_TIMEOUT = 10_000; // 10 seconds timeout
  private static readonly DEFAULT_TEST_URL = 'https://www.google.com';

  /**
   * Test proxy connection
   */
  static async testConnection(
    url: string = this.DEFAULT_TEST_URL,
    timeout: number = this.DEFAULT_TIMEOUT,
  ): Promise<ProxyTestResult> {
    const startTime = Date.now();

    try {
      logger.info(`Testing proxy connection with URL: ${url}`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const headers: Record<string, string> = { 'User-Agent': 'LobeChat-Desktop/1.0.0' };
      appendVercelCookie(headers);
      const response = await fetch(url, { headers, signal: controller.signal });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const responseTime = Date.now() - startTime;

      logger.info(`Proxy connection test successful, response time: ${responseTime}ms`);

      return {
        responseTime,
        success: true,
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      logger.error(`Proxy connection test failed after ${responseTime}ms:`, errorMessage);

      return {
        message: errorMessage,
        responseTime,
        success: false,
      };
    }
  }

  /**
   * Test connection with specified proxy configuration
   */
  static async testProxyConfig(
    config: NetworkProxySettings,
    testUrl: string = this.DEFAULT_TEST_URL,
  ): Promise<ProxyTestResult> {
    // Validate configuration
    const validation = ProxyConfigValidator.validate(config);
    if (!validation.isValid) {
      return {
        message: `Invalid proxy configuration: ${validation.errors.join(', ')}`,
        success: false,
      };
    }

    // If proxy is not enabled, test directly
    if (!config.enableProxy) {
      return this.testConnection(testUrl);
    }

    // Create temporary proxy agent for testing
    try {
      const proxyUrl = ProxyUrlBuilder.build(config);
      logger.debug(`Testing proxy with URL: ${proxyUrl}`);

      const agent = ProxyDispatcherManager.createProxyAgent(config.proxyType, proxyUrl);

      const startTime = Date.now();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.DEFAULT_TIMEOUT);

      // Temporarily set proxy for testing
      const originalDispatcher = getGlobalDispatcher();
      setGlobalDispatcher(agent);

      try {
        const testHeaders: Record<string, string> = { 'User-Agent': 'LobeChat-Desktop/1.0.0' };
        appendVercelCookie(testHeaders);
        const response = await fetch(testUrl, {
          dispatcher: agent,
          headers: testHeaders,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const responseTime = Date.now() - startTime;
        logger.info(`Proxy test successful, response time: ${responseTime}ms`);

        return {
          responseTime,
          success: true,
        };
      } catch (fetchError) {
        clearTimeout(timeoutId);
        throw fetchError;
      } finally {
        // Restore original dispatcher
        setGlobalDispatcher(originalDispatcher);
        // Clean up temporary proxy agent
        if (agent && typeof agent.destroy === 'function') {
          try {
            await agent.destroy();
          } catch (error) {
            logger.warn('Failed to destroy test agent:', error);
          }
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      logger.error(`Proxy test failed: ${errorMessage}`, error);

      return {
        message: `Proxy test failed: ${errorMessage}`,
        success: false,
      };
    }
  }
}
