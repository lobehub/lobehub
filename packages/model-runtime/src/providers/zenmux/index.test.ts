// @vitest-environment node
import { ModelProvider } from 'model-bank';
import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as modelParseModule from '../../utils/modelParse';
import { params } from './index';

// Mock external dependencies
vi.mock('../../utils/modelParse');

// Mock console methods
vi.spyOn(console, 'error').mockImplementation(() => {});
vi.spyOn(console, 'debug').mockImplementation(() => {});

describe('ZenMux Runtime', () => {
  let mockFetch: Mock;
  let mockProcessMultiProviderModelList: Mock;
  let mockDetectModelProvider: Mock;

  beforeEach(() => {
    // Setup fetch mock
    mockFetch = vi.fn();
    global.fetch = mockFetch;

    // Setup utility function mocks
    mockProcessMultiProviderModelList = vi.mocked(modelParseModule.processMultiProviderModelList);
    mockDetectModelProvider = vi.mocked(modelParseModule.detectModelProvider);

    // Clear environment variables
    delete process.env.DEBUG_ZENMUX_CHAT_COMPLETION;
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.DEBUG_ZENMUX_CHAT_COMPLETION;
  });

  describe('Debug Configuration', () => {
    it('should return false when DEBUG_ZENMUX_CHAT_COMPLETION is not set', () => {
      delete process.env.DEBUG_ZENMUX_CHAT_COMPLETION;
      const debugResult = process.env.DEBUG_ZENMUX_CHAT_COMPLETION === '1';
      expect(debugResult).toBe(false);
    });

    it('should return true when DEBUG_ZENMUX_CHAT_COMPLETION is set to 1', () => {
      process.env.DEBUG_ZENMUX_CHAT_COMPLETION = '1';
      const debugResult = process.env.DEBUG_ZENMUX_CHAT_COMPLETION === '1';
      expect(debugResult).toBe(true);
    });
  });

  describe('LobeZenMuxAI - custom features', () => {
    describe('Params Export', () => {
      it('should export params object', () => {
        expect(params).toBeDefined();
        expect(params.id).toBe('zenmux');
      });

      it('should have routers configuration', () => {
        expect(params.routers).toBeDefined();
        expect(typeof params.routers).toBe('function');
      });

      it('should have models function', () => {
        expect(params.models).toBeDefined();
        expect(typeof params.models).toBe('function');
      });

      it('should have correct provider ID', () => {
        expect(params.id).toBe(ModelProvider.ZenMux);
      });

      it('should have chatCompletion handlePayload function', () => {
        expect(params.chatCompletion).toBeDefined();
        expect(params.chatCompletion?.handlePayload).toBeDefined();
        expect(typeof params.chatCompletion?.handlePayload).toBe('function');
      });
    });

    describe('ChatCompletion HandlePayload', () => {
      it('should map reasoning_effort to reasoning.effort', () => {
        const payload = {
          model: 'gpt-4o',
          messages: [],
          reasoning_effort: 'high' as const,
        } as any;

        const result = params.chatCompletion?.handlePayload?.(payload);

        expect(result).toBeDefined();
        expect(result?.reasoning).toBeDefined();
        expect(result?.reasoning?.effort).toBe('high');
        expect(result?.reasoning_effort).toBeUndefined();
      });

      it('should map thinking.budget_tokens to reasoning.max_tokens', () => {
        const payload = {
          model: 'gpt-4o',
          messages: [],
          thinking: { budget_tokens: 2048, type: 'enabled' as const },
        } as any;

        const result = params.chatCompletion?.handlePayload?.(payload);

        expect(result).toBeDefined();
        expect(result?.reasoning).toBeDefined();
        expect(result?.reasoning?.max_tokens).toBe(2048);
        expect(result?.thinking).toBeUndefined();
      });

      it('should map thinking.type=enabled to reasoning.enabled=true', () => {
        const payload = {
          model: 'gpt-4o',
          messages: [],
          thinking: { budget_tokens: 1024, type: 'enabled' as const },
        } as any;

        const result = params.chatCompletion?.handlePayload?.(payload);

        expect(result).toBeDefined();
        expect(result?.reasoning).toBeDefined();
        expect(result?.reasoning?.enabled).toBe(true);
        expect(result?.thinking).toBeUndefined();
      });

      it('should not set reasoning.enabled when thinking.type=disabled', () => {
        const payload = {
          model: 'gpt-4o',
          messages: [],
          thinking: { budget_tokens: 1024, type: 'disabled' as const },
        } as any;

        const result = params.chatCompletion?.handlePayload?.(payload);

        expect(result).toBeDefined();
        // When thinking.type is 'disabled', max_tokens should be mapped and enabled should be false
        expect(result?.reasoning?.max_tokens).toBe(1024);
        expect(result?.reasoning?.enabled).toBe(false);
      });

      it('should map both reasoning_effort and thinking.budget_tokens together', () => {
        const payload = {
          model: 'gpt-4o',
          messages: [],
          reasoning_effort: 'high' as const,
          thinking: { budget_tokens: 2048, type: 'enabled' as const },
        } as any;

        const result = params.chatCompletion?.handlePayload?.(payload);

        expect(result).toBeDefined();
        expect(result?.reasoning).toBeDefined();
        expect(result?.reasoning?.effort).toBe('high');
        expect(result?.reasoning?.max_tokens).toBe(2048);
      });

      it('should preserve existing reasoning properties', () => {
        const payload = {
          model: 'gpt-4o',
          messages: [],
          reasoning: { summary: 'auto' },
          reasoning_effort: 'medium' as const,
        } as any;

        const result = params.chatCompletion?.handlePayload?.(payload);

        expect(result).toBeDefined();
        expect(result?.reasoning).toBeDefined();
        expect(result?.reasoning?.summary).toBe('auto');
        expect(result?.reasoning?.effort).toBe('medium');
      });

      it('should not include reasoning when no reasoning-related properties', () => {
        const payload = {
          model: 'gpt-4o',
          messages: [],
          temperature: 0.7,
        } as any;

        const result = params.chatCompletion?.handlePayload?.(payload);

        expect(result).toBeDefined();
        expect(result?.reasoning).toBeUndefined();
      });

      it('should preserve other payload properties', () => {
        const payload = {
          model: 'gpt-4o',
          messages: [],
          temperature: 0.7,
          top_p: 0.9,
          max_tokens: 1024,
          reasoning_effort: 'high' as const,
        } as any;

        const result = params.chatCompletion?.handlePayload?.(payload);

        expect(result).toBeDefined();
        expect(result?.temperature).toBe(0.7);
        expect(result?.top_p).toBe(0.9);
        expect(result?.max_tokens).toBe(1024);
        expect(result?.reasoning?.effort).toBe('high');
      });
    });

    describe('Routers Configuration', () => {
      it('should configure routers with correct endpoints', () => {
        const mockOptions = { baseURL: 'https://zenmux.ai/api/v1' };
        const routers = params.routers(mockOptions);

        expect(routers).toBeDefined();
        expect(Array.isArray(routers)).toBe(true);

        // Check anthropic router
        const anthropicRouter = routers.find((r) => r.apiType === 'anthropic');
        expect(anthropicRouter).toBeDefined();
        expect(anthropicRouter?.options.baseURL).toContain('/api/anthropic');

        // Check google router
        const googleRouter = routers.find((r) => r.apiType === 'google');
        expect(googleRouter).toBeDefined();
        expect(googleRouter?.options.baseURL).toContain('/api/vertex-ai');

        // Check openai router (default)
        const openaiRouter = routers.find((r) => r.apiType === 'openai');
        expect(openaiRouter).toBeDefined();
        expect(openaiRouter?.options.baseURL).toContain('/api/v1');
      });

      it('should strip version paths from baseURL', () => {
        const mockOptions = { baseURL: 'https://zenmux.ai/v1' };
        const routers = params.routers(mockOptions);

        const anthropicRouter = routers.find((r) => r.apiType === 'anthropic');
        expect(anthropicRouter?.options.baseURL).toBe('https://zenmux.ai/api/anthropic');
      });

      it('should use default baseURL when not provided', () => {
        const mockOptions = {}; // No baseURL provided
        const routers = params.routers(mockOptions);

        const anthropicRouter = routers.find((r) => r.apiType === 'anthropic');
        expect(anthropicRouter?.options.baseURL).toBe('https://zenmux.ai/api/anthropic');

        const googleRouter = routers.find((r) => r.apiType === 'google');
        expect(googleRouter?.options.baseURL).toBe('https://zenmux.ai/api/vertex-ai');

        const openaiRouter = routers.find((r) => r.apiType === 'openai');
        expect(openaiRouter?.options.baseURL).toBe('https://zenmux.ai/api/v1');
      });
    });
    describe('Models Function', () => {
      it('should fetch and process models correctly', async () => {
        const mockClient = {
          apiKey: 'test-key',
          baseURL: 'https://zenmux.ai/api/v1',
          models: {
            list: vi.fn().mockResolvedValue({
              data: [
                {
                  id: 'openai/gpt-4o-mini',
                  object: 'model',
                  created: 1755177025,
                  owned_by: 'openai',
                },
                {
                  id: 'anthropic/claude-3-5-sonnet-20241022',
                  object: 'model',
                  created: 1755177025,
                  owned_by: 'anthropic',
                },
              ],
            }),
          },
        } as any;

        // Mock processMultiProviderModelList to return processed models
        mockProcessMultiProviderModelList.mockResolvedValue([
          {
            id: 'openai/gpt-4o-mini',
            displayName: 'GPT-4o Mini',
            providerId: 'openai',
          },
          {
            id: 'anthropic/claude-3-5-sonnet-20241022',
            displayName: 'Claude 3.5 Sonnet',
            providerId: 'anthropic',
          },
        ] as any);

        const models = await params.models({ client: mockClient });

        expect(models).toBeDefined();
        expect(Array.isArray(models)).toBe(true);
        expect(models.length).toBeGreaterThan(0);
      });

      it('should handle empty model list', async () => {
        const mockClient = {
          apiKey: 'test-key',
          baseURL: 'https://zenmux.ai/api/v1',
          models: {
            list: vi.fn().mockResolvedValue({
              data: [],
            }),
          },
        } as any;

        // Mock processMultiProviderModelList
        mockProcessMultiProviderModelList.mockResolvedValue([]);

        const models = await params.models({ client: mockClient });

        expect(models).toBeDefined();
        expect(Array.isArray(models)).toBe(true);
        expect(models.length).toBe(0);
      });
    });
  });
});
