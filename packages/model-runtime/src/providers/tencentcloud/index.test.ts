// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import type { TencentCloudModelCard } from './index';
import { LobeTencentCloudAI, params } from './index';

const provider = ModelProvider.TencentCloud;
const defaultBaseURL = 'https://api.lkeap.cloud.tencent.com/v1';

// Basic provider tests
testProvider({
  Runtime: LobeTencentCloudAI,
  bizErrorType: 'ProviderBizError',
  chatDebugEnv: 'DEBUG_TENCENT_CLOUD_CHAT_COMPLETION',
  chatModel: 'DeepSeek-R1',
  defaultBaseURL,
  invalidErrorType: 'InvalidProviderAPIKey',
  provider,
  test: {
    skipAPICall: true,
    skipErrorHandle: true,
  },
});

// Custom feature tests
describe('LobeTencentCloudAI - custom features', () => {
  describe('params export', () => {
    it('should export params object', () => {
      expect(params).toBeDefined();
      expect(params.baseURL).toBe(defaultBaseURL);
      expect(params.provider).toBe(provider);
    });

    it('should have correct debug configuration', () => {
      expect(params.debug?.chatCompletion).toBeDefined();

      // Test debug = false
      delete process.env.DEBUG_TENCENT_CLOUD_CHAT_COMPLETION;
      expect(params.debug?.chatCompletion?.()).toBe(false);

      // Test debug = true
      process.env.DEBUG_TENCENT_CLOUD_CHAT_COMPLETION = '1';
      expect(params.debug?.chatCompletion?.()).toBe(true);

      // Cleanup
      delete process.env.DEBUG_TENCENT_CLOUD_CHAT_COMPLETION;
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

    it('should transform TencentCloud models to ChatModelCard format', async () => {
      const mockModels: TencentCloudModelCard[] = [{ id: 'deepseek-r1' }, { id: 'gpt-4o-mini' }];

      mockClient.models.list.mockResolvedValue({ data: mockModels });

      const result = await params.models!({ client: mockClient });

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        id: 'deepseek-r1',
        reasoning: true, // Contains 'deepseek-r1' keyword
      });
      expect(result[1]).toMatchObject({
        id: 'gpt-4o-mini',
        reasoning: false,
      });
    });

    it('should detect reasoning models by deepseek-r1 keyword', async () => {
      const mockModels: TencentCloudModelCard[] = [
        { id: 'deepseek-r1-distill' },
        { id: 'deepseek-r1-pro' },
      ];

      mockClient.models.list.mockResolvedValue({ data: mockModels });

      const result = await params.models!({ client: mockClient });

      expect(result[0].reasoning).toBe(true);
      expect(result[1].reasoning).toBe(true);
    });

    it('should use case-insensitive matching for deepseek-r1 keyword', async () => {
      const mockModels: TencentCloudModelCard[] = [{ id: 'DEEPSEEK-R1-UPPER' }];

      mockClient.models.list.mockResolvedValue({ data: mockModels });

      const result = await params.models!({ client: mockClient });

      expect(result[0].reasoning).toBe(true);
    });

    it('should handle models not in LOBE_DEFAULT_MODEL_LIST', async () => {
      const mockModels: TencentCloudModelCard[] = [{ id: 'unknown-custom-model' }];

      mockClient.models.list.mockResolvedValue({ data: mockModels });

      const result = await params.models!({ client: mockClient });

      expect(result[0]).toMatchObject({
        contextWindowTokens: undefined,
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

    it('should get abilities from knownModel in LOBE_DEFAULT_MODEL_LIST', async () => {
      const mockModels: TencentCloudModelCard[] = [{ id: 'gpt-4o' }];

      mockClient.models.list.mockResolvedValue({ data: mockModels });

      const result = await params.models!({ client: mockClient });

      // Should get all abilities from knownModel if exists
      expect(result[0]).toHaveProperty('functionCall');
      expect(result[0]).toHaveProperty('vision');
      expect(result[0]).toHaveProperty('reasoning');
    });

    it('should merge reasoning from keyword and knownModel abilities', async () => {
      const mockModels: TencentCloudModelCard[] = [
        { id: 'deepseek-r1' }, // Has keyword
        { id: 'regular-model' }, // No keyword
      ];

      mockClient.models.list.mockResolvedValue({ data: mockModels });

      const result = await params.models!({ client: mockClient });

      // First model should have reasoning from keyword
      expect(result[0].reasoning).toBe(true);

      // Second model should not have reasoning (no keyword, not in default list with reasoning)
      expect(result[1].reasoning).toBe(false);
    });

    it('should fallback to undefined for contextWindowTokens when not in known models', async () => {
      const mockModels: TencentCloudModelCard[] = [{ id: 'unknown-model' }];

      mockClient.models.list.mockResolvedValue({ data: mockModels });

      const result = await params.models!({ client: mockClient });

      expect(result[0].contextWindowTokens).toBeUndefined();
    });

    it('should fallback to false for enabled when not in known models', async () => {
      const mockModels: TencentCloudModelCard[] = [{ id: 'unknown-model' }];

      mockClient.models.list.mockResolvedValue({ data: mockModels });

      const result = await params.models!({ client: mockClient });

      expect(result[0].enabled).toBe(false);
    });

    it('should handle models without reasoning keyword', async () => {
      const mockModels: TencentCloudModelCard[] = [{ id: 'claude-3-opus' }, { id: 'gemini-pro' }];

      mockClient.models.list.mockResolvedValue({ data: mockModels });

      const result = await params.models!({ client: mockClient });

      // Both models should not have reasoning from keyword
      expect(result[0].reasoning).toBe(false);
      expect(result[1].reasoning).toBe(false);
    });
  });
});
