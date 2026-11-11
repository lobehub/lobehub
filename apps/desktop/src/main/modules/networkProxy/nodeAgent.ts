import type { Agent } from 'node:http';

import type { NetworkProxySettings } from '@lobechat/electron-client-ipc';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';

import { ProxyUrlBuilder } from './urlBuilder';

/**
 * Whether `hostname` is listed in the comma-separated bypass setting. Read with
 * NO_PROXY semantics, which is how child processes receive the same list: an
 * entry covers the host and its subdomains, a leading `.` or `*.` is optional,
 * and `*` covers every host.
 */
export const isProxyBypassed = (bypass: string | undefined, hostname: string): boolean => {
  const host = hostname.replace(/^\[(.*)\]$/, '$1').toLowerCase();

  return (bypass ?? '')
    .split(',')
    .map((entry) =>
      entry
        .trim()
        .toLowerCase()
        .replace(/^\*?\./, ''),
    )
    .some(
      (entry) => entry === '*' || (entry !== '' && (host === entry || host.endsWith(`.${entry}`))),
    );
};

/**
 * Agent that sends a Node `http`/`https` request for `targetUrl` through the
 * configured proxy, or `undefined` when it should connect directly.
 *
 * The proxy setting otherwise only replaces undici's global dispatcher, which
 * libraries built on Node's `http` module (such as `ws`) never consult.
 */
export const createNodeProxyAgent = (
  config: NetworkProxySettings | undefined,
  targetUrl: string,
): Agent | undefined => {
  if (!config?.enableProxy || !config.proxyServer || !config.proxyPort) return undefined;
  if (isProxyBypassed(config.proxyBypass, new URL(targetUrl).hostname)) return undefined;

  const proxyUrl = ProxyUrlBuilder.build(config);

  // `socks5h:` lets the proxy resolve the host, as the undici SOCKS dispatcher
  // does; plain `socks5:` would resolve it locally first.
  if (config.proxyType === 'socks5') {
    return new SocksProxyAgent(proxyUrl.replace(/^socks5:/, 'socks5h:'));
  }

  // CONNECT tunnels both `ws:` and `wss:` upgrades through an HTTP(S) proxy.
  return new HttpsProxyAgent(proxyUrl);
};
