// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import type { TogetherAIModel } from './index';
import { LobeTogetherAI, params } from './index';

const provider = ModelProvider.TogetherAI;
const defaultBaseURL = 'https://api.together.xyz/v1';

// Basic provider tests
testProvider({
  Runtime: LobeTogetherAI,
  bizErrorType: 'ProviderBizError',
  chatDebugEnv: 'DEBUG_TOGETHERAI_CHAT_COMPLETION',
  chatModel: 'mistralai/mistral-7b-instruct:free',
  defaultBaseURL,
  invalidErrorType: 'InvalidProviderAPIKey',
  provider,
  test: {
    skipAPICall: true,
    skipErrorHandle: true,
  },
});

// Custom feature tests
describe('LobeTogetherAI - custom features', () => {
  describe('params export', () => {
    it('should export params object', () => {
      expect(params).toBeDefined();
      expect(params.baseURL).toBe(defaultBaseURL);
      expect(params.provider).toBe(provider);
    });

    it('should have custom defaultHeaders', () => {
      expect(params.constructorOptions?.defaultHeaders).toEqual({
        'HTTP-Referer': 'https://chat-preview.lobehub.com',
        'X-Title': 'Lobe Chat',
      });
    });

    it('should have correct debug configuration', () => {
      expect(params.debug?.chatCompletion).toBeDefined();

      // Test debug = false
      delete process.env.DEBUG_TOGETHERAI_CHAT_COMPLETION;
      expect(params.debug?.chatCompletion?.()).toBe(false);

      // Test debug = true
      process.env.DEBUG_TOGETHERAI_CHAT_COMPLETION = '1';
      expect(params.debug?.chatCompletion?.()).toBe(true);

      // Cleanup
      delete process.env.DEBUG_TOGETHERAI_CHAT_COMPLETION;
    });
  });

  describe('models function', () => {
    let mockClient: any;

    beforeEach(() => {
      mockClient = {
        baseURL: 'https://api.together.xyz/v1',
        models: {
          list: vi.fn(),
        },
      };
    });

    it('should transform TogetherAI models to ChatModelCard format', async () => {
      const mockModels: Partial<TogetherAIModel>[] = [
        {
          context_length: 8192,
          description: 'A powerful reasoning model with function calling',
          display_name: 'DeepSeek R1',
          id: 'deepseek-r1',
        },
        {
          context_length: 128000,
          description: 'A vision model for image understanding',
          display_name: 'QvQ 32B',
          id: 'qvq-32b-preview',
        },
      ];

      mockClient.models.list.mockResolvedValue({ body: mockModels });

      const result = await params.models!({ client: mockClient });

      expect(mockClient.baseURL).toBe('https://api.together.xyz/api');
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        description: 'A powerful reasoning model with function calling',
        displayName: 'DeepSeek R1',
        functionCall: true, // Contains 'function calling' in description
        id: 'deepseek-r1',
        maxOutput: 8192,
        reasoning: true, // Contains 'deepseek-r1' keyword
        tokens: 8192,
      });
      expect(result[1]).toMatchObject({
        description: 'A vision model for image understanding',
        displayName: 'QvQ 32B',
        id: 'qvq-32b-preview',
        maxOutput: 128000,
        reasoning: false,
        tokens: 128000,
        vision: true, // Contains 'vision' in description and 'qvq' in id
      });
    });

    it('should detect reasoning models by deepseek-r1 keyword', async () => {
      const mockModels: Partial<TogetherAIModel>[] = [
        {
          context_length: 8192,
          description: 'DeepSeek reasoning model',
          display_name: 'DeepSeek R1 Distill',
          id: 'deepseek-r1-distill-qwen-32b',
        },
      ];

      mockClient.models.list.mockResolvedValue({ body: mockModels });

      const result = await params.models!({ client: mockClient });

      expect(result[0].reasoning).toBe(true);
    });

    it('should detect reasoning models by qwq keyword', async () => {
      const mockModels: Partial<TogetherAIModel>[] = [
        {
          context_length: 32768,
          description: 'QwQ reasoning model',
          display_name: 'QwQ 32B',
          id: 'qwq-32b-preview',
        },
      ];

      mockClient.models.list.mockResolvedValue({ body: mockModels });

      const result = await params.models!({ client: mockClient });

      expect(result[0].reasoning).toBe(true);
    });

    it('should detect function calling from description', async () => {
      const mockModels: Partial<TogetherAIModel>[] = [
        {
          context_length: 8192,
          description: 'This model supports Function Calling for better integration',
          display_name: 'Test Model',
          id: 'test-model',
        },
      ];

      mockClient.models.list.mockResolvedValue({ body: mockModels });

      const result = await params.models!({ client: mockClient });

      expect(result[0].functionCall).toBe(true);
    });

    it('should detect vision from description', async () => {
      const mockModels: Partial<TogetherAIModel>[] = [
        {
          context_length: 8192,
          description: 'A model with Vision capabilities for image analysis',
          display_name: 'Vision Model',
          id: 'vision-test',
        },
      ];

      mockClient.models.list.mockResolvedValue({ body: mockModels });

      const result = await params.models!({ client: mockClient });

      expect(result[0].vision).toBe(true);
    });

    it('should detect vision from qvq keyword in id', async () => {
      const mockModels: Partial<TogetherAIModel>[] = [
        {
          context_length: 32768,
          description: 'QvQ model',
          display_name: 'QvQ',
          id: 'qvq-72b-preview',
        },
      ];

      mockClient.models.list.mockResolvedValue({ body: mockModels });

      const result = await params.models!({ client: mockClient });

      expect(result[0].vision).toBe(true);
    });

    it('should detect vision from vision keyword in id', async () => {
      const mockModels: Partial<TogetherAIModel>[] = [
        {
          context_length: 8192,
          description: 'Vision model',
          display_name: 'Vision Test',
          id: 'test-vision-model',
        },
      ];

      mockClient.models.list.mockResolvedValue({ body: mockModels });

      const result = await params.models!({ client: mockClient });

      expect(result[0].vision).toBe(true);
    });

    it('should use case-insensitive matching for all keywords', async () => {
      const mockModels: Partial<TogetherAIModel>[] = [
        {
          context_length: 8192,
          description: 'Model with FUNCTION CALLING and VISION',
          display_name: 'Test Model',
          id: 'DEEPSEEK-R1-UPPER',
        },
        {
          context_length: 32768,
          description: 'QVQ model',
          display_name: 'QVQ',
          id: 'QVQ-UPPER',
        },
      ];

      mockClient.models.list.mockResolvedValue({ body: mockModels });

      const result = await params.models!({ client: mockClient });

      expect(result[0].reasoning).toBe(true); // 'deepseek-r1' keyword
      expect(result[0].functionCall).toBe(true); // 'function calling' in description
      expect(result[0].vision).toBe(true); // 'vision' in description
      expect(result[1].vision).toBe(true); // 'qvq' keyword
    });

    it('should handle models not in LOBE_DEFAULT_MODEL_LIST', async () => {
      const mockModels: Partial<TogetherAIModel>[] = [
        {
          context_length: 4096,
          description: 'Unknown model',
          display_name: 'Unknown',
          id: 'unknown-custom-model',
        },
      ];

      mockClient.models.list.mockResolvedValue({ body: mockModels });

      const result = await params.models!({ client: mockClient });

      expect(result[0]).toMatchObject({
        contextWindowTokens: undefined,
        description: 'Unknown model',
        displayName: 'Unknown',
        enabled: false,
        functionCall: false,
        id: 'unknown-custom-model',
        maxOutput: 4096,
        reasoning: false,
        tokens: 4096,
        vision: false,
      });
    });

    it('should handle empty model list', async () => {
      mockClient.models.list.mockResolvedValue({ body: [] });

      const result = await params.models!({ client: mockClient });

      expect(result).toEqual([]);
    });

    it('should merge abilities from knownModel', async () => {
      const mockModels: Partial<TogetherAIModel>[] = [
        {
          context_length: 8192,
          description: 'GPT-4O model',
          display_name: 'GPT-4O',
          id: 'gpt-4o',
        },
      ];

      mockClient.models.list.mockResolvedValue({ body: mockModels });

      const result = await params.models!({ client: mockClient });

      // Should get abilities from knownModel if exists
      expect(result[0]).toHaveProperty('functionCall');
      expect(result[0]).toHaveProperty('vision');
      expect(result[0]).toHaveProperty('reasoning');
    });

    it('should change client.baseURL to API endpoint for models.list', async () => {
      const originalBaseURL = mockClient.baseURL;
      mockClient.models.list.mockResolvedValue({ body: [] });

      await params.models!({ client: mockClient });

      expect(mockClient.baseURL).toBe('https://api.together.xyz/api');
      expect(mockClient.baseURL).not.toBe(originalBaseURL);
    });

    it('should handle models with only some abilities', async () => {
      const mockModels: Partial<TogetherAIModel>[] = [
        {
          context_length: 8192,
          description: 'Model with function calling',
          display_name: 'FC Model',
          id: 'function-only',
        },
        {
          context_length: 32768,
          description: 'Model with vision',
          display_name: 'Vision Model',
          id: 'vision-only',
        },
        {
          context_length: 8192,
          description: 'Regular model',
          display_name: 'Regular',
          id: 'deepseek-r1-reasoning',
        },
      ];

      mockClient.models.list.mockResolvedValue({ body: mockModels });

      const result = await params.models!({ client: mockClient });

      expect(result[0]).toMatchObject({
        functionCall: true,
        reasoning: false,
        vision: false,
      });
      expect(result[1]).toMatchObject({
        functionCall: false,
        reasoning: false,
        vision: true,
      });
      expect(result[2]).toMatchObject({
        functionCall: false,
        reasoning: true,
        vision: false,
      });
    });

    it('should set context tokens correctly', async () => {
      const mockModels: Partial<TogetherAIModel>[] = [
        {
          context_length: 200000,
          description: 'Large context model',
          display_name: 'Large Context',
          id: 'large-context',
        },
      ];

      mockClient.models.list.mockResolvedValue({ body: mockModels });

      const result = await params.models!({ client: mockClient });

      expect(result[0].maxOutput).toBe(200000);
    });
  });
});
