import type { NetworkProxySettings } from '@lobechat/electron-client-ipc';

/**
 * Proxy configuration validation result
 */
export interface ProxyValidationResult {
  errors: string[];
  isValid: boolean;
}

/**
 * Proxy configuration validator
 */
export class ProxyConfigValidator {
  private static readonly SUPPORTED_TYPES = ['http', 'https', 'socks5'] as const;
  private static readonly DEFAULT_BYPASS = 'localhost,127.0.0.1,::1';

  /**
   * Validate proxy configuration
   */
  static validate(config: NetworkProxySettings): ProxyValidationResult {
    const errors: string[] = [];

    // If proxy is not enabled, skip validation
    if (!config.enableProxy) {
      return { errors: [], isValid: true };
    }

    // Validate proxy type
    if (!this.SUPPORTED_TYPES.includes(config.proxyType as any)) {
      errors.push(
        `Unsupported proxy type: ${config.proxyType}. Supported types: ${this.SUPPORTED_TYPES.join(', ')}`,
      );
    }

    // Validate proxy server
    if (!config.proxyServer?.trim()) {
      errors.push('Proxy server is required when proxy is enabled');
    } else if (!this.isValidHost(config.proxyServer)) {
      errors.push('Invalid proxy server format');
    }

    // Validate proxy port
    if (!config.proxyPort?.trim()) {
      errors.push('Proxy port is required when proxy is enabled');
    } else {
      const port = parseInt(config.proxyPort, 10);
      if (isNaN(port) || port < 1 || port > 65_535) {
        errors.push('Proxy port must be a valid number between 1 and 65535');
      }
    }

    // Validate authentication information
    if (config.proxyRequireAuth) {
      if (!config.proxyUsername?.trim()) {
        errors.push('Proxy username is required when authentication is enabled');
      }
      if (!config.proxyPassword?.trim()) {
        errors.push('Proxy password is required when authentication is enabled');
      }
    }

    return {
      errors,
      isValid: errors.length === 0,
    };
  }

  /**
   * Validate host format
   */
  private static isValidHost(host: string): boolean {
    // Simple host validation (IP address or domain name)
    const ipRegex = /^(?:\d{1,3}\.){3}\d{1,3}$/;
    const domainRegex = /^[\dA-Z](?:[\dA-Z-]*[\dA-Z])?(?:\.[\dA-Z](?:[\dA-Z-]*[\dA-Z])?)*$/i;

    return ipRegex.test(host) || domainRegex.test(host);
  }
}
