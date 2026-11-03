export type ProxyType = 'http' | 'https' | 'socks5';

export interface NetworkProxySettings {
  enableProxy: boolean;
  proxyBypass?: string;
  proxyPassword?: string;
  proxyPort: string;
  proxyRequireAuth: boolean;
  proxyServer: string;
  proxyType: ProxyType;
  proxyUsername?: string;
}
