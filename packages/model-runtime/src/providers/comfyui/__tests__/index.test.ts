// @vitest-environment node
import { createBasicAuthCredentials } from '@lobechat/utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ComfyUIKeyVault } from '@/types/index';

import type { CreateImagePayload } from '../../../types/image';
import { LobeComfyUI } from '../index';

// Mock debug
vi.mock('debug', () => ({
  default: vi.fn(() => vi.fn()),
}));

describe('LobeComfyUI Runtime', () => {
  let runtime: LobeComfyUI;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock global fetch
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  describe('constructor', () => {
    it('should initialize with default options', () => {
      runtime = new LobeComfyUI();

      expect(runtime.baseURL).toBe('http://localhost:8188');
    });

    it('should initialize with custom baseURL', () => {
      const options: ComfyUIKeyVault = {
        baseURL: 'https://custom.comfyui.com',
      };

      runtime = new LobeComfyUI(options);

      expect(runtime.baseURL).toBe('https://custom.comfyui.com');
    });

    it('should use environment variable if no baseURL provided', () => {
      const originalEnv = process.env.COMFYUI_DEFAULT_URL;
      process.env.COMFYUI_DEFAULT_URL = 'https://env.comfyui.com';

      runtime = new LobeComfyUI();

      expect(runtime.baseURL).toBe('https://env.comfyui.com');

      // Restore environment
      if (originalEnv === undefined) {
        delete process.env.COMFYUI_DEFAULT_URL;
      } else {
        process.env.COMFYUI_DEFAULT_URL = originalEnv;
      }
    });
  });

  describe('getAuthHeaders', () => {
    it('should return undefined for no auth', () => {
      runtime = new LobeComfyUI({ authType: 'none' });

      const headers = runtime.getAuthHeaders();

      expect(headers).toBeUndefined();
    });

    it('should return undefined for default auth type', () => {
      runtime = new LobeComfyUI();

      const headers = runtime.getAuthHeaders();

      expect(headers).toBeUndefined();
    });

    it('should return Basic auth headers when configured correctly', () => {
      const options: ComfyUIKeyVault = {
        authType: 'basic',
        username: 'testuser',
        password: 'testpass',
      };

      runtime = new LobeComfyUI(options);

      const headers = runtime.getAuthHeaders();

      expect(headers).toEqual({
        Authorization: `Basic ${createBasicAuthCredentials('testuser', 'testpass')}`,
      });
    });

    it('should return undefined for basic auth without credentials', () => {
      const options: ComfyUIKeyVault = {
        authType: 'basic',
      };

      runtime = new LobeComfyUI(options);

      const headers = runtime.getAuthHeaders();

      expect(headers).toBeUndefined();
    });

    it('should return Bearer auth headers when configured correctly', () => {
      const options: ComfyUIKeyVault = {
        authType: 'bearer',
        apiKey: 'test-api-key',
      };

      runtime = new LobeComfyUI(options);

      const headers = runtime.getAuthHeaders();

      expect(headers).toEqual({
        Authorization: 'Bearer test-api-key',
      });
    });

    it('should return undefined for bearer auth without apiKey', () => {
      const options: ComfyUIKeyVault = {
        authType: 'bearer',
      };

      runtime = new LobeComfyUI(options);

      const headers = runtime.getAuthHeaders();

      expect(headers).toBeUndefined();
    });

    it('should return custom headers when configured', () => {
      const customHeaders = {
        'X-Custom-Auth': 'custom-value',
        'Authorization': 'Custom auth-token',
      };

      const options: ComfyUIKeyVault = {
        authType: 'custom',
        customHeaders,
      };

      runtime = new LobeComfyUI(options);

      const headers = runtime.getAuthHeaders();

      expect(headers).toEqual(customHeaders);
    });

    it('should return undefined for custom auth without headers', () => {
      const options: ComfyUIKeyVault = {
        authType: 'custom',
      };

      runtime = new LobeComfyUI(options);

      const headers = runtime.getAuthHeaders();

      expect(headers).toBeUndefined();
    });
  });

  describe('createImage', () => {
    beforeEach(() => {
      runtime = new LobeComfyUI({
        baseURL: 'https://test.comfyui.com',
        authType: 'bearer',
        apiKey: 'test-key',
      });
    });

    it('should call WebAPI endpoint with correct URL and payload', async () => {
      const mockPayload: CreateImagePayload = {
        model: 'flux1-dev.safetensors',
        params: {
          prompt: 'a beautiful landscape',
          width: 1024,
          height: 1024,
          steps: 20,
          cfg: 7,
        },
      };

      const mockResponse = {
        imageUrl: 'https://test.comfyui.com/image/output.png',
        width: 1024,
        height: 1024,
      };

      // Mock successful response
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockResponse),
      });

      // Set APP_URL environment variable
      const originalAppUrl = process.env.APP_URL;
      process.env.APP_URL = 'http://localhost:3010';

      const result = await runtime.createImage(mockPayload);

      // Verify fetch was called with correct parameters
      expect(mockFetch).toHaveBeenCalledWith('http://localhost:3010/webapi/create-image/comfyui', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-key',
        },
        body: JSON.stringify({
          model: 'flux1-dev.safetensors',
          options: {
            baseURL: 'https://test.comfyui.com',
            authType: 'bearer',
            apiKey: 'test-key',
          },
          params: {
            prompt: 'a beautiful landscape',
            width: 1024,
            height: 1024,
            steps: 20,
            cfg: 7,
          },
        }),
      });

      expect(result).toEqual(mockResponse);

      // Restore environment
      if (originalAppUrl === undefined) {
        delete process.env.APP_URL;
      } else {
        process.env.APP_URL = originalAppUrl;
      }
    });

    it('should use default APP_URL when environment variable is not set', async () => {
      const mockPayload: CreateImagePayload = {
        model: 'flux1-dev.safetensors',
        params: {
          prompt: 'test prompt',
        },
      };

      // Mock successful response
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ imageUrl: 'test.png' }),
      });

      // Ensure APP_URL is not set
      const originalAppUrl = process.env.APP_URL;
      const originalPort = process.env.PORT;
      delete process.env.APP_URL;
      process.env.PORT = '3000';

      await runtime.createImage(mockPayload);

      // Should use default localhost:3000
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/webapi/create-image/comfyui',
        expect.any(Object),
      );

      // Restore environment
      if (originalAppUrl !== undefined) {
        process.env.APP_URL = originalAppUrl;
      }
      if (originalPort === undefined) {
        delete process.env.PORT;
      } else {
        process.env.PORT = originalPort;
      }
    });

    it('should use default port 3010 when PORT is not set', async () => {
      const mockPayload: CreateImagePayload = {
        model: 'flux1-dev.safetensors',
        params: {
          prompt: 'test prompt',
        },
      };

      // Mock successful response
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ imageUrl: 'test.png' }),
      });

      // Ensure both APP_URL and PORT are not set
      const originalAppUrl = process.env.APP_URL;
      const originalPort = process.env.PORT;
      delete process.env.APP_URL;
      delete process.env.PORT;

      await runtime.createImage(mockPayload);

      // Should use default localhost:3010
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3010/webapi/create-image/comfyui',
        expect.any(Object),
      );

      // Restore environment
      if (originalAppUrl !== undefined) {
        process.env.APP_URL = originalAppUrl;
      }
      if (originalPort !== undefined) {
        process.env.PORT = originalPort;
      }
    });

    it('should include auth headers when configured', async () => {
      const mockPayload: CreateImagePayload = {
        model: 'test-model.safetensors',
        params: {
          prompt: 'test prompt',
        },
      };

      // Test with basic auth
      runtime = new LobeComfyUI({
        baseURL: 'https://test.comfyui.com',
        authType: 'basic',
        username: 'testuser',
        password: 'testpass',
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ imageUrl: 'test.png' }),
      });

      await runtime.createImage(mockPayload);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'Authorization': `Basic ${createBasicAuthCredentials('testuser', 'testpass')}`,
          }),
        }),
      );
    });

    it('should not include auth headers when auth is disabled', async () => {
      const mockPayload: CreateImagePayload = {
        model: 'test-model.safetensors',
        params: {
          prompt: 'test prompt',
        },
      };

      // Test with no auth
      runtime = new LobeComfyUI({
        baseURL: 'https://test.comfyui.com',
        authType: 'none',
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ imageUrl: 'test.png' }),
      });

      await runtime.createImage(mockPayload);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: {
            'Content-Type': 'application/json',
          },
        }),
      );
    });

    it('should throw error when fetch response is not ok', async () => {
      const mockPayload: CreateImagePayload = {
        model: 'flux1-dev.safetensors',
        params: {
          prompt: 'test prompt',
        },
      };

      // Mock error response
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: vi.fn().mockResolvedValue('Internal server error'),
      });

      await expect(runtime.createImage(mockPayload)).rejects.toMatchObject({
        errorType: 'ComfyUIServiceUnavailable',
        provider: 'comfyui',
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should throw error when fetch throws', async () => {
      const mockPayload: CreateImagePayload = {
        model: 'flux1-dev.safetensors',
        params: {
          prompt: 'test prompt',
        },
      };

      const networkError = new Error('Network connection failed');
      mockFetch.mockRejectedValue(networkError);

      await expect(runtime.createImage(mockPayload)).rejects.toMatchObject({
        errorType: 'ComfyUIBizError',
        provider: 'comfyui',
        error: {
          message: 'Network connection failed',
        },
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should handle complex payload with all parameters', async () => {
      const complexPayload: CreateImagePayload = {
        model: 'sd3.5-large.safetensors',
        params: {
          prompt: 'complex image generation with multiple parameters',
          width: 1152,
          height: 896,
          steps: 25,
          cfg: 8.5,
          seed: 12345,
        },
      };

      const mockResponse = {
        imageUrl: 'https://test.comfyui.com/complex-image.png',
        width: 1152,
        height: 896,
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockResponse),
      });

      const result = await runtime.createImage(complexPayload);

      expect(result).toEqual(mockResponse);

      // Verify that complex payload was passed correctly
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            model: 'sd3.5-large.safetensors',
            options: {
              baseURL: 'https://test.comfyui.com',
              authType: 'bearer',
              apiKey: 'test-key',
            },
            params: {
              prompt: 'complex image generation with multiple parameters',
              width: 1152,
              height: 896,
              steps: 25,
              cfg: 8.5,
              seed: 12345,
            },
          }),
        }),
      );
    });

    it('should handle WebAPI error responses with JSON body', async () => {
      const mockPayload: CreateImagePayload = {
        model: 'flux1-dev.safetensors',
        params: {
          prompt: 'test prompt',
        },
      };

      // Mock error response with JSON body
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        text: vi
          .fn()
          .mockResolvedValue('{"message":"Invalid model specified","error":"Model not found"}'),
      });

      await expect(runtime.createImage(mockPayload)).rejects.toMatchObject({
        errorType: 'ComfyUIBizError',
        provider: 'comfyui',
        error: {
          message: 'Invalid model specified',
        },
      });
    });
  });

  describe('runtime interface compliance', () => {
    it('should implement LobeRuntimeAI interface', () => {
      runtime = new LobeComfyUI();

      expect(runtime).toHaveProperty('baseURL');
      expect(typeof runtime.createImage).toBe('function');
    });

    it('should implement AuthenticatedImageRuntime interface', () => {
      runtime = new LobeComfyUI();

      expect(typeof runtime.getAuthHeaders).toBe('function');
    });
  });
});
