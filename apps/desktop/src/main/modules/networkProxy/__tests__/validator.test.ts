import type { NetworkProxySettings } from '@lobechat/electron-client-ipc';
import { describe, expect, it } from 'vitest';

import { ProxyConfigValidator } from '../validator';

describe('ProxyConfigValidator', () => {
  const validConfig: NetworkProxySettings = {
    enableProxy: true,
    proxyType: 'http',
    proxyServer: 'proxy.example.com',
    proxyPort: '8080',
    proxyRequireAuth: false,
    proxyBypass: 'localhost,127.0.0.1,::1',
  };

  describe('validate', () => {
    describe('disabled proxy', () => {
      it('should validate successfully when proxy is disabled', () => {
        const config: NetworkProxySettings = {
          ...validConfig,
          enableProxy: false,
        };

        const result = ProxyConfigValidator.validate(config);

        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it('should skip validation for disabled proxy even with invalid fields', () => {
        const config: NetworkProxySettings = {
          enableProxy: false,
          proxyType: 'invalid' as any,
          proxyServer: '',
          proxyPort: 'invalid',
          proxyRequireAuth: false,
          proxyBypass: 'localhost',
        };

        const result = ProxyConfigValidator.validate(config);

        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });
    });

    describe('proxy type validation', () => {
      it('should accept http proxy type', () => {
        const config: NetworkProxySettings = {
          ...validConfig,
          proxyType: 'http',
        };

        const result = ProxyConfigValidator.validate(config);

        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it('should accept https proxy type', () => {
        const config: NetworkProxySettings = {
          ...validConfig,
          proxyType: 'https',
        };

        const result = ProxyConfigValidator.validate(config);

        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it('should accept socks5 proxy type', () => {
        const config: NetworkProxySettings = {
          ...validConfig,
          proxyType: 'socks5',
        };

        const result = ProxyConfigValidator.validate(config);

        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it('should reject unsupported proxy type', () => {
        const config: NetworkProxySettings = {
          ...validConfig,
          proxyType: 'socks4' as any,
        };

        const result = ProxyConfigValidator.validate(config);

        expect(result.isValid).toBe(false);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toContain('Unsupported proxy type');
        expect(result.errors[0]).toContain('socks4');
      });

      it('should reject invalid proxy type', () => {
        const config: NetworkProxySettings = {
          ...validConfig,
          proxyType: 'ftp' as any,
        };

        const result = ProxyConfigValidator.validate(config);

        expect(result.isValid).toBe(false);
        expect(result.errors[0]).toContain('Supported types: http, https, socks5');
      });
    });

    describe('proxy server validation', () => {
      it('should accept valid domain name', () => {
        const config: NetworkProxySettings = {
          ...validConfig,
          proxyServer: 'proxy.example.com',
        };

        const result = ProxyConfigValidator.validate(config);

        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it('should accept valid IPv4 address', () => {
        const config: NetworkProxySettings = {
          ...validConfig,
          proxyServer: '192.168.1.1',
        };

        const result = ProxyConfigValidator.validate(config);

        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it('should accept localhost', () => {
        const config: NetworkProxySettings = {
          ...validConfig,
          proxyServer: 'localhost',
        };

        const result = ProxyConfigValidator.validate(config);

        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it('should accept subdomain', () => {
        const config: NetworkProxySettings = {
          ...validConfig,
          proxyServer: 'proxy.subdomain.example.com',
        };

        const result = ProxyConfigValidator.validate(config);

        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it('should reject empty proxy server', () => {
        const config: NetworkProxySettings = {
          ...validConfig,
          proxyServer: '',
        };

        const result = ProxyConfigValidator.validate(config);

        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Proxy server is required when proxy is enabled');
      });

      it('should reject whitespace-only proxy server', () => {
        const config: NetworkProxySettings = {
          ...validConfig,
          proxyServer: '   ',
        };

        const result = ProxyConfigValidator.validate(config);

        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Proxy server is required when proxy is enabled');
      });

      it('should reject invalid domain format', () => {
        const config: NetworkProxySettings = {
          ...validConfig,
          proxyServer: 'invalid..domain',
        };

        const result = ProxyConfigValidator.validate(config);

        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Invalid proxy server format');
      });

      it('should reject domain starting with hyphen', () => {
        const config: NetworkProxySettings = {
          ...validConfig,
          proxyServer: '-proxy.com',
        };

        const result = ProxyConfigValidator.validate(config);

        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Invalid proxy server format');
      });

      it('should reject domain with invalid characters', () => {
        const config: NetworkProxySettings = {
          ...validConfig,
          proxyServer: 'proxy@example.com',
        };

        const result = ProxyConfigValidator.validate(config);

        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Invalid proxy server format');
      });
    });

    describe('proxy port validation', () => {
      it('should accept valid port 1', () => {
        const config: NetworkProxySettings = {
          ...validConfig,
          proxyPort: '1',
        };

        const result = ProxyConfigValidator.validate(config);

        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it('should accept valid port 65535', () => {
        const config: NetworkProxySettings = {
          ...validConfig,
          proxyPort: '65535',
        };

        const result = ProxyConfigValidator.validate(config);

        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it('should accept common proxy port 8080', () => {
        const config: NetworkProxySettings = {
          ...validConfig,
          proxyPort: '8080',
        };

        const result = ProxyConfigValidator.validate(config);

        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it('should reject empty proxy port', () => {
        const config: NetworkProxySettings = {
          ...validConfig,
          proxyPort: '',
        };

        const result = ProxyConfigValidator.validate(config);

        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Proxy port is required when proxy is enabled');
      });

      it('should reject whitespace-only proxy port', () => {
        const config: NetworkProxySettings = {
          ...validConfig,
          proxyPort: '   ',
        };

        const result = ProxyConfigValidator.validate(config);

        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Proxy port is required when proxy is enabled');
      });

      it('should reject port 0', () => {
        const config: NetworkProxySettings = {
          ...validConfig,
          proxyPort: '0',
        };

        const result = ProxyConfigValidator.validate(config);

        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Proxy port must be a valid number between 1 and 65535');
      });

      it('should reject port above 65535', () => {
        const config: NetworkProxySettings = {
          ...validConfig,
          proxyPort: '65536',
        };

        const result = ProxyConfigValidator.validate(config);

        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Proxy port must be a valid number between 1 and 65535');
      });

      it('should reject negative port', () => {
        const config: NetworkProxySettings = {
          ...validConfig,
          proxyPort: '-1',
        };

        const result = ProxyConfigValidator.validate(config);

        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Proxy port must be a valid number between 1 and 65535');
      });

      it('should reject non-numeric port', () => {
        const config: NetworkProxySettings = {
          ...validConfig,
          proxyPort: 'abc',
        };

        const result = ProxyConfigValidator.validate(config);

        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Proxy port must be a valid number between 1 and 65535');
      });
    });

    describe('authentication validation', () => {
      it('should validate successfully with auth disabled', () => {
        const config: NetworkProxySettings = {
          ...validConfig,
          proxyRequireAuth: false,
        };

        const result = ProxyConfigValidator.validate(config);

        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it('should validate successfully with auth enabled and credentials provided', () => {
        const config: NetworkProxySettings = {
          ...validConfig,
          proxyRequireAuth: true,
          proxyUsername: 'testuser',
          proxyPassword: 'testpass',
        };

        const result = ProxyConfigValidator.validate(config);

        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it('should reject when auth is enabled but username is missing', () => {
        const config: NetworkProxySettings = {
          ...validConfig,
          proxyRequireAuth: true,
          proxyUsername: '',
          proxyPassword: 'testpass',
        };

        const result = ProxyConfigValidator.validate(config);

        expect(result.isValid).toBe(false);
        expect(result.errors).toContain(
          'Proxy username is required when authentication is enabled',
        );
      });

      it('should reject when auth is enabled but username is whitespace', () => {
        const config: NetworkProxySettings = {
          ...validConfig,
          proxyRequireAuth: true,
          proxyUsername: '   ',
          proxyPassword: 'testpass',
        };

        const result = ProxyConfigValidator.validate(config);

        expect(result.isValid).toBe(false);
        expect(result.errors).toContain(
          'Proxy username is required when authentication is enabled',
        );
      });

      it('should reject when auth is enabled but password is missing', () => {
        const config: NetworkProxySettings = {
          ...validConfig,
          proxyRequireAuth: true,
          proxyUsername: 'testuser',
          proxyPassword: '',
        };

        const result = ProxyConfigValidator.validate(config);

        expect(result.isValid).toBe(false);
        expect(result.errors).toContain(
          'Proxy password is required when authentication is enabled',
        );
      });

      it('should reject when auth is enabled but password is whitespace', () => {
        const config: NetworkProxySettings = {
          ...validConfig,
          proxyRequireAuth: true,
          proxyUsername: 'testuser',
          proxyPassword: '   ',
        };

        const result = ProxyConfigValidator.validate(config);

        expect(result.isValid).toBe(false);
        expect(result.errors).toContain(
          'Proxy password is required when authentication is enabled',
        );
      });

      it('should reject when auth is enabled but both username and password are missing', () => {
        const config: NetworkProxySettings = {
          ...validConfig,
          proxyRequireAuth: true,
          proxyUsername: '',
          proxyPassword: '',
        };

        const result = ProxyConfigValidator.validate(config);

        expect(result.isValid).toBe(false);
        expect(result.errors).toHaveLength(2);
        expect(result.errors).toContain(
          'Proxy username is required when authentication is enabled',
        );
        expect(result.errors).toContain(
          'Proxy password is required when authentication is enabled',
        );
      });

      it('should allow missing credentials when auth is disabled', () => {
        const config: NetworkProxySettings = {
          ...validConfig,
          proxyRequireAuth: false,
          proxyUsername: undefined,
          proxyPassword: undefined,
        };

        const result = ProxyConfigValidator.validate(config);

        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });
    });

    describe('multiple validation errors', () => {
      it('should collect all validation errors', () => {
        const config: NetworkProxySettings = {
          enableProxy: true,
          proxyType: 'invalid' as any,
          proxyServer: '',
          proxyPort: 'abc',
          proxyRequireAuth: true,
          proxyUsername: '',
          proxyPassword: '',
          proxyBypass: 'localhost',
        };

        const result = ProxyConfigValidator.validate(config);

        expect(result.isValid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(1);
      });

      it('should collect errors for invalid server and port', () => {
        const config: NetworkProxySettings = {
          ...validConfig,
          proxyServer: 'invalid..domain',
          proxyPort: '99999',
        };

        const result = ProxyConfigValidator.validate(config);

        expect(result.isValid).toBe(false);
        expect(result.errors).toHaveLength(2);
        expect(result.errors).toContain('Invalid proxy server format');
        expect(result.errors).toContain('Proxy port must be a valid number between 1 and 65535');
      });
    });
  });
});
