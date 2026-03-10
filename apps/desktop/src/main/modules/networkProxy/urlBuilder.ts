import type { NetworkProxySettings } from '@lobechat/electron-client-ipc';

/**
 * Proxy URL builder
 */
export const ProxyUrlBuilder = {
  /**
   * Build proxy URL
   */
  build(config: NetworkProxySettings): string {
    const { proxyType, proxyServer, proxyPort, proxyRequireAuth, proxyUsername, proxyPassword } =
      config;

    let proxyUrl = `${proxyType}://${proxyServer}:${proxyPort}`;

    // Add authentication information
    if (proxyRequireAuth && proxyUsername && proxyPassword) {
      const encodedUsername = encodeURIComponent(proxyUsername);
      const encodedPassword = encodeURIComponent(proxyPassword);
      proxyUrl = `${proxyType}://${encodedUsername}:${encodedPassword}@${proxyServer}:${proxyPort}`;
    }

    return proxyUrl;
  },
};
