import type { NetworkProxySettings } from '@lobechat/electron-client-ipc';
import { describe, expect, it } from 'vitest';

import { buildProxyEnv } from '../envBuilder';

describe('buildProxyEnv', () => {
  const baseConfig: NetworkProxySettings = {
    enableProxy: true,
    proxyType: 'http',
    proxyServer: 'proxy.example.com',
    proxyPort: '8080',
    proxyRequireAuth: false,
    proxyBypass: 'localhost,127.0.0.1,::1',
  };

  it('should return empty object when proxy is disabled', () => {
    const env = buildProxyEnv({ ...baseConfig, enableProxy: false });

    expect(env).toEqual({});
  });

  it('should return empty object when proxy server is empty', () => {
    const env = buildProxyEnv({ ...baseConfig, proxyServer: '' });

    expect(env).toEqual({});
  });

  it('should return empty object when proxy port is empty', () => {
    const env = buildProxyEnv({ ...baseConfig, proxyPort: '' });

    expect(env).toEqual({});
  });

  it('should set HTTP(S)_PROXY for http proxy', () => {
    const env = buildProxyEnv({ ...baseConfig, proxyType: 'http' });

    expect(env.HTTP_PROXY).toBe('http://proxy.example.com:8080');
    expect(env.HTTPS_PROXY).toBe('http://proxy.example.com:8080');
    expect(env.ALL_PROXY).toBeUndefined();
  });

  it('should set HTTP(S)_PROXY for https proxy', () => {
    const env = buildProxyEnv({ ...baseConfig, proxyType: 'https' });

    expect(env.HTTP_PROXY).toBe('https://proxy.example.com:8080');
    expect(env.HTTPS_PROXY).toBe('https://proxy.example.com:8080');
    expect(env.ALL_PROXY).toBeUndefined();
  });

  it('should set ALL_PROXY for socks5 proxy and skip HTTP(S)_PROXY', () => {
    const env = buildProxyEnv({ ...baseConfig, proxyType: 'socks5' });

    expect(env.ALL_PROXY).toBe('socks5://proxy.example.com:8080');
    expect(env.HTTP_PROXY).toBeUndefined();
    expect(env.HTTPS_PROXY).toBeUndefined();
  });

  it('should include NO_PROXY from proxyBypass', () => {
    const env = buildProxyEnv(baseConfig);

    expect(env.NO_PROXY).toBe('localhost,127.0.0.1,::1');
  });

  it('should omit NO_PROXY when proxyBypass is empty', () => {
    const env = buildProxyEnv({ ...baseConfig, proxyBypass: '' });

    expect(env.NO_PROXY).toBeUndefined();
  });

  it('should include auth in proxy URL', () => {
    const env = buildProxyEnv({
      ...baseConfig,
      proxyRequireAuth: true,
      proxyUsername: 'user',
      proxyPassword: 'pass',
    });

    expect(env.HTTP_PROXY).toBe('http://user:pass@proxy.example.com:8080');
    expect(env.HTTPS_PROXY).toBe('http://user:pass@proxy.example.com:8080');
  });
});
