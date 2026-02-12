// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import type { ModelScopeModelCard } from './index';
import { LobeModelScopeAI, params } from './index';

const provider = ModelProvider.ModelScope;
const defaultBaseURL = 'https://api-inference.modelscope.cn/v1';

// Basic provider tests
testProvider({
  Runtime: LobeModelScopeAI,
  provider,
  defaultBaseURL,
  chatDebugEnv: 'DEBUG_MODELSCOPE_CHAT_COMPLETION',
  chatModel: 'qwen2-7b-instruct',
  test: {
    skipAPICall: true,
  },
});

// Custom feature tests
describe('LobeModelScopeAI - custom features', () => {
  describe('params export', () => {
    it('should export params object', () => {
      expect(params).toBeDefined();
      expect(params.baseURL).toBe(defaultBaseURL);
      expect(params.provider).toBe(provider);
      expect(params.debug).toBeDefined();
      expect(params.models).toBeDefined();
    });
  });

  describe('debug configuration', () => {
    it('should disable debug mode by default', () => {
      delete process.env.DEBUG_MODELSCOPE_CHAT_COMPLETION;
      const result = params.debug.chatCompletion();
      expect(result).toBe(false);
    });

    it('should enable debug mode when env is set to 1', () => {
      process.env.DEBUG_MODELSCOPE_CHAT_COMPLETION = '1';
      const result = params.debug.chatCompletion();
      expect(result).toBe(true);
    });

    it('should disable debug mode when env is not 1', () => {
      process.env.DEBUG_MODELSCOPE_CHAT_COMPLETION = '0';
      const result = params.debug.chatCompletion();
      expect(result).toBe(false);
    });
  });

  describe('models function', () => {
    let mockClient: any;
    let consoleWarnSpy: any;

    beforeEach(() => {
      mockClient = {
        models: {
          list: vi.fn(),
        },
      };
      consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    it('should fetch and process models successfully', async () => {
      const mockModelData: ModelScopeModelCard[] = [
        {
          id: 'qwen2-7b-instruct',
          object: 'model',
          created: 1234567890,
          owned_by: 'qwen',
        },
        {
          id: 'qwen2.5-72b-instruct',
          object: 'model',
          created: 1234567891,
          owned_by: 'qwen',
        },
      ];

      mockClient.models.list.mockResolvedValue({
        data: mockModelData,
      });

      const models = await params.models({ client: mockClient });

      expect(mockClient.models.list).toHaveBeenCalledTimes(1);
      expect(models).toBeDefined();
      expect(Array.isArray(models)).toBe(true);
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it('should handle empty model list', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [],
      });

      const models = await params.models({ client: mockClient });

      expect(mockClient.models.list).toHaveBeenCalledTimes(1);
      expect(models).toBeDefined();
      expect(Array.isArray(models)).toBe(true);
      expect(models).toHaveLength(0);
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it('should handle missing data field', async () => {
      mockClient.models.list.mockResolvedValue({});

      const models = await params.models({ client: mockClient });

      expect(mockClient.models.list).toHaveBeenCalledTimes(1);
      expect(models).toBeDefined();
      expect(Array.isArray(models)).toBe(true);
      expect(models).toHaveLength(0);
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it('should handle API errors gracefully', async () => {
      const mockError = new Error('API Error');
      mockClient.models.list.mockRejectedValue(mockError);

      const models = await params.models({ client: mockClient });

      expect(mockClient.models.list).toHaveBeenCalledTimes(1);
      expect(models).toEqual([]);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Failed to fetch ModelScope models. Please ensure your ModelScope API key is valid and your Alibaba Cloud account is properly bound:',
        mockError,
      );
    });

    it('should handle network errors', async () => {
      const networkError = new Error('Network timeout');
      mockClient.models.list.mockRejectedValue(networkError);

      const models = await params.models({ client: mockClient });

      expect(models).toEqual([]);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Failed to fetch ModelScope models. Please ensure your ModelScope API key is valid and your Alibaba Cloud account is properly bound:',
        networkError,
      );
    });

    it('should handle invalid API key errors', async () => {
      const authError = new Error('Invalid API key');
      mockClient.models.list.mockRejectedValue(authError);

      const models = await params.models({ client: mockClient });

      expect(models).toEqual([]);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Failed to fetch ModelScope models. Please ensure your ModelScope API key is valid and your Alibaba Cloud account is properly bound:',
        authError,
      );
    });

    it('should process models with processMultiProviderModelList', async () => {
      const mockModelData: ModelScopeModelCard[] = [
        {
          id: 'qwen-plus',
          object: 'model',
          created: 1234567890,
          owned_by: 'qwen',
        },
        {
          id: 'qwen-turbo',
          object: 'model',
          created: 1234567891,
          owned_by: 'qwen',
        },
      ];

      mockClient.models.list.mockResolvedValue({
        data: mockModelData,
      });

      const models = await params.models({ client: mockClient });

      expect(models).toBeDefined();
      expect(Array.isArray(models)).toBe(true);
      // processMultiProviderModelList should process the models
      expect(mockClient.models.list).toHaveBeenCalledTimes(1);
    });

    it('should handle models with different owned_by values', async () => {
      const mockModelData: ModelScopeModelCard[] = [
        {
          id: 'model-1',
          object: 'model',
          created: 1234567890,
          owned_by: 'provider-1',
        },
        {
          id: 'model-2',
          object: 'model',
          created: 1234567891,
          owned_by: 'provider-2',
        },
      ];

      mockClient.models.list.mockResolvedValue({
        data: mockModelData,
      });

      const models = await params.models({ client: mockClient });

      expect(models).toBeDefined();
      expect(Array.isArray(models)).toBe(true);
    });
  });

  describe('ModelScopeModelCard interface', () => {
    it('should have correct structure', () => {
      const mockCard: ModelScopeModelCard = {
        id: 'test-model',
        object: 'model',
        created: 1234567890,
        owned_by: 'test-provider',
      };

      expect(mockCard.id).toBe('test-model');
      expect(mockCard.object).toBe('model');
      expect(mockCard.created).toBe(1234567890);
      expect(mockCard.owned_by).toBe('test-provider');
    });
  });

  describe('runtime instantiation', () => {
    it('should create runtime instance with default config', () => {
      const instance = new LobeModelScopeAI({ apiKey: 'test_api_key' });
      expect(instance).toBeDefined();
      expect(instance.baseURL).toBe(defaultBaseURL);
    });

    it('should create runtime instance with custom baseURL', () => {
      const customBaseURL = 'https://custom.modelscope.cn/v1';
      const instance = new LobeModelScopeAI({
        apiKey: 'test_api_key',
        baseURL: customBaseURL,
      });
      expect(instance).toBeDefined();
      expect(instance.baseURL).toBe(customBaseURL);
    });
  });
});
