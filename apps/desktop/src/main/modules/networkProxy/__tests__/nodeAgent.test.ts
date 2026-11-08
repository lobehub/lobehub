import type { NetworkProxySettings } from '@lobechat/electron-client-ipc';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { describe, expect, it } from 'vitest';

import { createNodeProxyAgent, isProxyBypassed } from '../nodeAgent';

describe('createNodeProxyAgent', () => {
  const baseConfig: NetworkProxySettings = {
    enableProxy: true,
    proxyBypass: 'localhost, 127.0.0.1, ::1',
    proxyPort: '8080',
    proxyRequireAuth: false,
    proxyServer: 'proxy.example.com',
    proxyType: 'http',
  };
  const gatewayUrl = 'https://device-gateway.lobehub.com';

  it('returns nothing when the proxy is disabled or incomplete', () => {
    expect(createNodeProxyAgent(undefined, gatewayUrl)).toBeUndefined();
    expect(createNodeProxyAgent({ ...baseConfig, enableProxy: false }, gatewayUrl)).toBeUndefined();
    expect(createNodeProxyAgent({ ...baseConfig, proxyServer: '' }, gatewayUrl)).toBeUndefined();
    expect(createNodeProxyAgent({ ...baseConfig, proxyPort: '' }, gatewayUrl)).toBeUndefined();
  });

  it('tunnels through an HTTP proxy with CONNECT', () => {
    const agent = createNodeProxyAgent(baseConfig, gatewayUrl);

    expect(agent).toBeInstanceOf(HttpsProxyAgent);
    expect((agent as HttpsProxyAgent<string>).proxy.href).toBe('http://proxy.example.com:8080/');
  });

  it('keeps the proxy credentials', () => {
    const agent = createNodeProxyAgent(
      { ...baseConfig, proxyPassword: 'p@ss', proxyRequireAuth: true, proxyUsername: 'user' },
      gatewayUrl,
    );

    expect((agent as HttpsProxyAgent<string>).proxy.href).toBe(
      'http://user:p%40ss@proxy.example.com:8080/',
    );
  });

  it('uses a SOCKS agent that lets a socks5 proxy resolve the host', () => {
    const agent = createNodeProxyAgent({ ...baseConfig, proxyType: 'socks5' }, gatewayUrl);

    expect(agent).toBeInstanceOf(SocksProxyAgent);
    expect((agent as SocksProxyAgent).shouldLookup).toBe(false);
  });

  it('connects directly to a bypassed gateway', () => {
    expect(createNodeProxyAgent(baseConfig, 'http://localhost:8787')).toBeUndefined();
    expect(createNodeProxyAgent(baseConfig, 'http://[::1]:8787')).toBeUndefined();
  });
});

describe('isProxyBypassed', () => {
  it('matches hosts and their subdomains like NO_PROXY', () => {
    expect(isProxyBypassed('example.com', 'example.com')).toBe(true);
    expect(isProxyBypassed('example.com', 'gw.example.com')).toBe(true);
    expect(isProxyBypassed('.example.com', 'gw.example.com')).toBe(true);
    expect(isProxyBypassed('*.example.com', 'gw.example.com')).toBe(true);
    expect(isProxyBypassed('example.com', 'notexample.com')).toBe(false);
  });

  it('treats * as every host and ignores empty entries', () => {
    expect(isProxyBypassed('*', 'device-gateway.lobehub.com')).toBe(true);
    expect(isProxyBypassed(' , ', 'device-gateway.lobehub.com')).toBe(false);
    expect(isProxyBypassed(undefined, 'device-gateway.lobehub.com')).toBe(false);
  });
});
