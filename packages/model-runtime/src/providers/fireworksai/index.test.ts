// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import type { FireworksAIModelCard } from './index';
import { LobeFireworksAI, params } from './index';

const provider = ModelProvider.FireworksAI;
const defaultBaseURL = 'https://api.fireworks.ai/inference/v1';

// Basic provider tests
testProvider({
  Runtime: LobeFireworksAI,
  bizErrorType: 'ProviderBizError',
  chatDebugEnv: 'DEBUG_FIREWORKSAI_CHAT_COMPLETION',
  chatModel: 'deepseek-r1',
  defaultBaseURL,
  invalidErrorType: 'InvalidProviderAPIKey',
  provider,
  test: {
    skipAPICall: true,
    skipErrorHandle: true,
  },
});

// Custom feature tests
describe('LobeFireworksAI - custom features', () => {
  describe('params export', () => {
    it('should export params object', () => {
      expect(params).toBeDefined();
      expect(params.baseURL).toBe(defaultBaseURL);
      expect(params.provider).toBe(provider);
    });

    it('should have correct debug configuration', () => {
      expect(params.debug?.chatCompletion).toBeDefined();

      // Test debug = false
      delete process.env.DEBUG_FIREWORKSAI_CHAT_COMPLETION;
      expect(params.debug?.chatCompletion?.()).toBe(false);

      // Test debug = true
      process.env.DEBUG_FIREWORKSAI_CHAT_COMPLETION = '1';
      expect(params.debug?.chatCompletion?.()).toBe(true);

      // Cleanup
      delete process.env.DEBUG_FIREWORKSAI_CHAT_COMPLETION;
    });
  });

  describe('models function', () => {
    let mockClient: any;

    beforeEach(() => {
      mockClient = {
        models: {
          list: vi.fn(),
        },
      };
    });

    it('should transform FireworksAI models to ChatModelCard format', async () => {
      const mockModels: FireworksAIModelCard[] = [
        {
          context_length: 8192,
          id: 'accounts/fireworks/models/deepseek-r1',
          supports_image_input: false,
          supports_tools: true,
        },
        {
          context_length: 4096,
          id: 'accounts/fireworks/models/qwq-32b',
          supports_image_input: false,
          supports_tools: false,
        },
      ];

      mockClient.models.list.mockResolvedValue({ data: mockModels });

      const result = await params.models!({ client: mockClient });

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        contextWindowTokens: 8192,
        functionCall: true,
        id: 'accounts/fireworks/models/deepseek-r1',
        reasoning: true, // Contains 'deepseek-r1' keyword
        vision: false,
      });
      expect(result[1]).toMatchObject({
        contextWindowTokens: 4096,
        functionCall: false,
        id: 'accounts/fireworks/models/qwq-32b',
        reasoning: true, // Contains 'qwq' keyword
        vision: false,
      });
    });

    it('should detect reasoning models by keyword - deepseek-r1', async () => {
      const mockModels: FireworksAIModelCard[] = [
        {
          context_length: 8192,
          id: 'deepseek-r1-distill-qwen-32b',
          supports_image_input: false,
          supports_tools: true,
        },
      ];

      mockClient.models.list.mockResolvedValue({ data: mockModels });

      const result = await params.models!({ client: mockClient });

      expect(result[0].reasoning).toBe(true);
    });

    it('should detect reasoning models by keyword - qwq', async () => {
      const mockModels: FireworksAIModelCard[] = [
        {
          context_length: 4096,
          id: 'qwq-32b-preview',
          supports_image_input: false,
          supports_tools: false,
        },
      ];

      mockClient.models.list.mockResolvedValue({ data: mockModels });

      const result = await params.models!({ client: mockClient });

      expect(result[0].reasoning).toBe(true);
    });

    it('should detect function call from supports_tools', async () => {
      const mockModels: FireworksAIModelCard[] = [
        {
          context_length: 8192,
          id: 'test-model',
          supports_image_input: false,
          supports_tools: true,
        },
      ];

      mockClient.models.list.mockResolvedValue({ data: mockModels });

      const result = await params.models!({ client: mockClient });

      expect(result[0].functionCall).toBe(true);
    });

    it('should detect function call from model id containing "function"', async () => {
      const mockModels: FireworksAIModelCard[] = [
        {
          context_length: 8192,
          id: 'test-function-calling-model',
          supports_image_input: false,
          supports_tools: false,
        },
      ];

      mockClient.models.list.mockResolvedValue({ data: mockModels });

      const result = await params.models!({ client: mockClient });

      expect(result[0].functionCall).toBe(true);
    });

    it('should set functionCall to false when neither supports_tools nor id contains "function"', async () => {
      const mockModels: FireworksAIModelCard[] = [
        {
          context_length: 8192,
          id: 'test-model',
          supports_image_input: false,
          supports_tools: false,
        },
      ];

      mockClient.models.list.mockResolvedValue({ data: mockModels });

      const result = await params.models!({ client: mockClient });

      expect(result[0].functionCall).toBe(false);
    });

    it('should detect vision support from supports_image_input', async () => {
      const mockModels: FireworksAIModelCard[] = [
        {
          context_length: 8192,
          id: 'vision-model',
          supports_image_input: true,
          supports_tools: false,
        },
      ];

      mockClient.models.list.mockResolvedValue({ data: mockModels });

      const result = await params.models!({ client: mockClient });

      expect(result[0].vision).toBe(true);
    });

    it('should handle models not in LOBE_DEFAULT_MODEL_LIST', async () => {
      const mockModels: FireworksAIModelCard[] = [
        {
          context_length: 4096,
          id: 'unknown-custom-model',
          supports_image_input: false,
          supports_tools: false,
        },
      ];

      mockClient.models.list.mockResolvedValue({ data: mockModels });

      const result = await params.models!({ client: mockClient });

      expect(result[0]).toMatchObject({
        contextWindowTokens: 4096,
        displayName: undefined,
        enabled: false,
        functionCall: false,
        id: 'unknown-custom-model',
        reasoning: false,
        vision: false,
      });
    });

    it('should handle empty model list', async () => {
      mockClient.models.list.mockResolvedValue({ data: [] });

      const result = await params.models!({ client: mockClient });

      expect(result).toEqual([]);
    });

    it('should use case-insensitive matching for model detection', async () => {
      const mockModels: FireworksAIModelCard[] = [
        {
          context_length: 8192,
          id: 'DEEPSEEK-R1-UPPER',
          supports_image_input: false,
          supports_tools: false,
        },
        {
          context_length: 4096,
          id: 'TEST-FUNCTION-MODEL',
          supports_image_input: false,
          supports_tools: false,
        },
      ];

      mockClient.models.list.mockResolvedValue({ data: mockModels });

      const result = await params.models!({ client: mockClient });

      expect(result[0].reasoning).toBe(true); // 'deepseek-r1' keyword match (case-insensitive)
      expect(result[1].functionCall).toBe(true); // 'function' in id (case-insensitive)
    });

    it('should merge knownModel abilities with detected reasoning', async () => {
      const mockModels: FireworksAIModelCard[] = [
        {
          context_length: 8192,
          id: 'regular-model',
          supports_image_input: false,
          supports_tools: false,
        },
      ];

      mockClient.models.list.mockResolvedValue({ data: mockModels });

      const result = await params.models!({ client: mockClient });

      // Since 'regular-model' doesn't contain reasoning keywords and is not in LOBE_DEFAULT_MODEL_LIST
      // with reasoning abilities, it should be false
      expect(result[0].reasoning).toBe(false);
    });
  });
});
