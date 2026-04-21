import type { NetworkProxySettings } from '@lobechat/electron-client-ipc';

import { ProxyUrlBuilder } from './urlBuilder';

/**
 * Build proxy env vars (HTTPS_PROXY / HTTP_PROXY / ALL_PROXY / NO_PROXY) to
 * forward the user's proxy config to spawned child processes (e.g. CLI tools
 * like claude-code, codex, MCP stdio servers). The in-process undici
 * dispatcher set by ProxyDispatcherManager only covers the main process —
 * children need env vars to pick it up.
 *
 * Returns `{}` when proxy is disabled, so callers can unconditionally spread
 * the result into the spawn env.
 */
export const buildProxyEnv = (config?: NetworkProxySettings): Record<string, string> => {
  if (!config?.enableProxy || !config.proxyServer || !config.proxyPort) {
    return {};
  }

  const url = ProxyUrlBuilder.build(config);
  const env: Record<string, string> = {};

  // SOCKS5 is not universally supported via HTTP(S)_PROXY — stick to ALL_PROXY.
  if (config.proxyType === 'socks5') {
    env.ALL_PROXY = url;
  } else {
    env.HTTP_PROXY = url;
    env.HTTPS_PROXY = url;
  }

  if (config.proxyBypass) {
    env.NO_PROXY = config.proxyBypass;
  }

  return env;
};
