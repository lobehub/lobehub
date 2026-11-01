import { describe, expect, it } from 'vitest';

import { ComfyUIAuthService } from '@/server/services/comfyui/core/comfyUIAuthService';
import { ServicesError } from '@/server/services/comfyui/errors';
import { type ComfyUIKeyVault } from '@/types/user/settings/keyVaults';

describe('ComfyUIAuthService', () => {
  describe('Constructor and initialization', () => {
    it('should initialize with none auth type by default', () => {
      const service = new ComfyUIAuthService({});

      expect(service.getCredentials()).toBeUndefined();
      expect(service.getAuthHeaders()).toBeUndefined();
    });

    it('should initialize with basic auth', () => {
      const options: ComfyUIKeyVault = {
        authType: 'basic',
        username: 'testuser',
        password: 'testpass',
      };

      const service = new ComfyUIAuthService(options);

      const credentials = service.getCredentials();
      expect(credentials).toEqual({
        type: 'basic',
        username: 'testuser',
        password: 'testpass',
      });

      const headers = service.getAuthHeaders();
      expect(headers).toEqual({
        Authorization: `Basic ${btoa('testuser:testpass')}`,
      });
    });

    it('should initialize with bearer auth', () => {
      const options: ComfyUIKeyVault = {
        authType: 'bearer',
        apiKey: 'test-api-key',
      };

      const service = new ComfyUIAuthService(options);

      const credentials = service.getCredentials();
      expect(credentials).toEqual({
        type: 'bearer_token',
        token: 'test-api-key',
      });

      const headers = service.getAuthHeaders();
      expect(headers).toEqual({
        Authorization: 'Bearer test-api-key',
      });
    });

    it('should initialize with custom auth', () => {
      const customHeaders = { 'X-API-Key': 'custom-key', 'X-Client': 'test' };
      const options: ComfyUIKeyVault = {
        authType: 'custom',
        customHeaders,
      };

      const service = new ComfyUIAuthService(options);

      const credentials = service.getCredentials();
      expect(credentials).toEqual({
        type: 'custom',
        headers: customHeaders,
      });

      const headers = service.getAuthHeaders();
      expect(headers).toEqual(customHeaders);
    });
  });

  describe('Validation', () => {
    it('should throw error for basic auth without username', () => {
      expect(() => {
        new ComfyUIAuthService({
          authType: 'basic',
          password: 'testpass',
        });
      }).toThrow(ServicesError);
    });

    it('should throw error for basic auth without password', () => {
      expect(() => {
        new ComfyUIAuthService({
          authType: 'basic',
          username: 'testuser',
        });
      }).toThrow(ServicesError);
    });

    it('should throw error for bearer auth without apiKey', () => {
      expect(() => {
        new ComfyUIAuthService({
          authType: 'bearer',
        });
      }).toThrow(ServicesError);
    });

    it('should throw error for custom auth without headers', () => {
      expect(() => {
        new ComfyUIAuthService({
          authType: 'custom',
        });
      }).toThrow(ServicesError);
    });

    it('should throw error for custom auth with empty headers', () => {
      expect(() => {
        new ComfyUIAuthService({
          authType: 'custom',
          customHeaders: {},
        });
      }).toThrow(ServicesError);
    });
  });

  describe('Edge cases', () => {
    it('should handle partial basic auth gracefully in headers', () => {
      // This tests the createAuthHeaders method behavior
      const options: ComfyUIKeyVault = {
        authType: 'basic',
        username: 'testuser',
        password: 'testpass',
      };

      const service = new ComfyUIAuthService(options);
      expect(service.getAuthHeaders()).toBeDefined();
    });

    it('should handle partial bearer auth gracefully in headers', () => {
      const options: ComfyUIKeyVault = {
        authType: 'bearer',
        apiKey: 'test-key',
      };

      const service = new ComfyUIAuthService(options);
      expect(service.getAuthHeaders()).toBeDefined();
    });
  });
});
