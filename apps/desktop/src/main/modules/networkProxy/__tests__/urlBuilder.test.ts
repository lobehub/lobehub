import type { NetworkProxySettings } from '@lobechat/electron-client-ipc';
import { describe, expect, it } from 'vitest';

import { ProxyUrlBuilder } from '../urlBuilder';

describe('ProxyUrlBuilder', () => {
  const baseConfig: NetworkProxySettings = {
    enableProxy: true,
    proxyType: 'http',
    proxyServer: 'proxy.example.com',
    proxyPort: '8080',
    proxyRequireAuth: false,
    proxyBypass: 'localhost,127.0.0.1,::1',
  };

  describe('build', () => {
    describe('without authentication', () => {
      it('should build URL with http proxy type', () => {
        const config: NetworkProxySettings = {
          ...baseConfig,
          proxyType: 'http',
        };

        const url = ProxyUrlBuilder.build(config);

        expect(url).toBe('http://proxy.example.com:8080');
      });

      it('should build URL with https proxy type', () => {
        const config: NetworkProxySettings = {
          ...baseConfig,
          proxyType: 'https',
        };

        const url = ProxyUrlBuilder.build(config);

        expect(url).toBe('https://proxy.example.com:8080');
      });

      it('should build URL with socks5 proxy type', () => {
        const config: NetworkProxySettings = {
          ...baseConfig,
          proxyType: 'socks5',
        };

        const url = ProxyUrlBuilder.build(config);

        expect(url).toBe('socks5://proxy.example.com:8080');
      });

      it('should build URL with IPv4 address', () => {
        const config: NetworkProxySettings = {
          ...baseConfig,
          proxyServer: '192.168.1.1',
        };

        const url = ProxyUrlBuilder.build(config);

        expect(url).toBe('http://192.168.1.1:8080');
      });

      it('should build URL with localhost', () => {
        const config: NetworkProxySettings = {
          ...baseConfig,
          proxyServer: 'localhost',
        };

        const url = ProxyUrlBuilder.build(config);

        expect(url).toBe('http://localhost:8080');
      });

      it('should build URL with different port', () => {
        const config: NetworkProxySettings = {
          ...baseConfig,
          proxyPort: '3128',
        };

        const url = ProxyUrlBuilder.build(config);

        expect(url).toBe('http://proxy.example.com:3128');
      });
    });

    describe('with authentication', () => {
      it('should build URL with username and password', () => {
        const config: NetworkProxySettings = {
          ...baseConfig,
          proxyRequireAuth: true,
          proxyUsername: 'testuser',
          proxyPassword: 'testpass',
        };

        const url = ProxyUrlBuilder.build(config);

        expect(url).toBe('http://testuser:testpass@proxy.example.com:8080');
      });

      it('should build URL with encoded username containing @ symbol', () => {
        const config: NetworkProxySettings = {
          ...baseConfig,
          proxyRequireAuth: true,
          proxyUsername: 'user@domain.com',
          proxyPassword: 'password',
        };

        const url = ProxyUrlBuilder.build(config);

        expect(url).toBe('http://user%40domain.com:password@proxy.example.com:8080');
        // Verify encoding
        expect(url).toContain('user%40domain.com');
      });

      it('should build URL with encoded password containing colon', () => {
        const config: NetworkProxySettings = {
          ...baseConfig,
          proxyRequireAuth: true,
          proxyUsername: 'user',
          proxyPassword: 'pass:word',
        };

        const url = ProxyUrlBuilder.build(config);

        expect(url).toBe('http://user:pass%3Aword@proxy.example.com:8080');
        // Verify encoding
        expect(url).toContain('pass%3Aword');
      });

      it('should build URL with encoded special characters in username', () => {
        const config: NetworkProxySettings = {
          ...baseConfig,
          proxyRequireAuth: true,
          proxyUsername: 'user name',
          proxyPassword: 'password',
        };

        const url = ProxyUrlBuilder.build(config);

        expect(url).toBe('http://user%20name:password@proxy.example.com:8080');
        // Verify encoding
        expect(url).toContain('user%20name');
      });

      it('should build URL with encoded special characters in password', () => {
        const config: NetworkProxySettings = {
          ...baseConfig,
          proxyRequireAuth: true,
          proxyUsername: 'user',
          proxyPassword: 'p@ss w0rd!',
        };

        const url = ProxyUrlBuilder.build(config);

        // Verify encoding of special characters
        expect(url).toContain(encodeURIComponent('p@ss w0rd!'));
        expect(url).toContain('user:');
        expect(url).toContain('@proxy.example.com:8080');
      });

      it('should build URL with encoded slash in credentials', () => {
        const config: NetworkProxySettings = {
          ...baseConfig,
          proxyRequireAuth: true,
          proxyUsername: 'domain/user',
          proxyPassword: 'pass/word',
        };

        const url = ProxyUrlBuilder.build(config);

        expect(url).toBe('http://domain%2Fuser:pass%2Fword@proxy.example.com:8080');
        // Verify encoding
        expect(url).toContain('domain%2Fuser');
        expect(url).toContain('pass%2Fword');
      });

      it('should build URL with encoded hash in credentials', () => {
        const config: NetworkProxySettings = {
          ...baseConfig,
          proxyRequireAuth: true,
          proxyUsername: 'user#123',
          proxyPassword: 'pass#word',
        };

        const url = ProxyUrlBuilder.build(config);

        expect(url).toBe('http://user%23123:pass%23word@proxy.example.com:8080');
        // Verify encoding
        expect(url).toContain('user%23123');
        expect(url).toContain('pass%23word');
      });

      it('should build URL with encoded question mark in credentials', () => {
        const config: NetworkProxySettings = {
          ...baseConfig,
          proxyRequireAuth: true,
          proxyUsername: 'user?name',
          proxyPassword: 'pass?word',
        };

        const url = ProxyUrlBuilder.build(config);

        expect(url).toBe('http://user%3Fname:pass%3Fword@proxy.example.com:8080');
        // Verify encoding
        expect(url).toContain('user%3Fname');
        expect(url).toContain('pass%3Fword');
      });

      it('should build URL with https proxy type and auth', () => {
        const config: NetworkProxySettings = {
          ...baseConfig,
          proxyType: 'https',
          proxyRequireAuth: true,
          proxyUsername: 'testuser',
          proxyPassword: 'testpass',
        };

        const url = ProxyUrlBuilder.build(config);

        expect(url).toBe('https://testuser:testpass@proxy.example.com:8080');
      });

      it('should build URL with socks5 proxy type and auth', () => {
        const config: NetworkProxySettings = {
          ...baseConfig,
          proxyType: 'socks5',
          proxyRequireAuth: true,
          proxyUsername: 'sockuser',
          proxyPassword: 'sockpass',
        };

        const url = ProxyUrlBuilder.build(config);

        expect(url).toBe('socks5://sockuser:sockpass@proxy.example.com:8080');
      });
    });

    describe('edge cases', () => {
      it('should not include auth when proxyRequireAuth is false but credentials are provided', () => {
        const config: NetworkProxySettings = {
          ...baseConfig,
          proxyRequireAuth: false,
          proxyUsername: 'testuser',
          proxyPassword: 'testpass',
        };

        const url = ProxyUrlBuilder.build(config);

        expect(url).toBe('http://proxy.example.com:8080');
        expect(url).not.toContain('testuser');
        expect(url).not.toContain('testpass');
      });

      it('should not include auth when username is empty', () => {
        const config: NetworkProxySettings = {
          ...baseConfig,
          proxyRequireAuth: true,
          proxyUsername: '',
          proxyPassword: 'testpass',
        };

        const url = ProxyUrlBuilder.build(config);

        expect(url).toBe('http://proxy.example.com:8080');
        expect(url).not.toContain('@');
      });

      it('should not include auth when password is empty', () => {
        const config: NetworkProxySettings = {
          ...baseConfig,
          proxyRequireAuth: true,
          proxyUsername: 'testuser',
          proxyPassword: '',
        };

        const url = ProxyUrlBuilder.build(config);

        expect(url).toBe('http://proxy.example.com:8080');
        expect(url).not.toContain('@');
      });

      it('should not include auth when username is undefined', () => {
        const config: NetworkProxySettings = {
          ...baseConfig,
          proxyRequireAuth: true,
          proxyUsername: undefined,
          proxyPassword: 'testpass',
        };

        const url = ProxyUrlBuilder.build(config);

        expect(url).toBe('http://proxy.example.com:8080');
        expect(url).not.toContain('@');
      });

      it('should not include auth when password is undefined', () => {
        const config: NetworkProxySettings = {
          ...baseConfig,
          proxyRequireAuth: true,
          proxyUsername: 'testuser',
          proxyPassword: undefined,
        };

        const url = ProxyUrlBuilder.build(config);

        expect(url).toBe('http://proxy.example.com:8080');
        expect(url).not.toContain('@');
      });

      it('should handle minimum port number', () => {
        const config: NetworkProxySettings = {
          ...baseConfig,
          proxyPort: '1',
        };

        const url = ProxyUrlBuilder.build(config);

        expect(url).toBe('http://proxy.example.com:1');
      });

      it('should handle maximum port number', () => {
        const config: NetworkProxySettings = {
          ...baseConfig,
          proxyPort: '65535',
        };

        const url = ProxyUrlBuilder.build(config);

        expect(url).toBe('http://proxy.example.com:65535');
      });

      it('should handle complex URL encoding scenario', () => {
        const config: NetworkProxySettings = {
          ...baseConfig,
          proxyRequireAuth: true,
          proxyUsername: 'user@example.com:admin',
          proxyPassword: 'p@ss:w0rd#123',
        };

        const url = ProxyUrlBuilder.build(config);

        // Verify all special characters are encoded
        const expectedUsername = encodeURIComponent('user@example.com:admin');
        const expectedPassword = encodeURIComponent('p@ss:w0rd#123');

        expect(url).toBe(`http://${expectedUsername}:${expectedPassword}@proxy.example.com:8080`);
      });
    });
  });
});
