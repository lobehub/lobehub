// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import type { JinaModelCard } from './index';
import { LobeJinaAI, params } from './index';

const provider = ModelProvider.Jina;
const defaultBaseURL = 'https://deepsearch.jina.ai/v1';

// Basic provider tests
testProvider({
  Runtime: LobeJinaAI,
  bizErrorType: 'ProviderBizError',
  chatDebugEnv: 'DEBUG_JINA_CHAT_COMPLETION',
  chatModel: 'jina-embeddings-v3',
  defaultBaseURL,
  invalidErrorType: 'InvalidProviderAPIKey',
  provider,
  test: {
    skipAPICall: true,
    skipErrorHandle: true,
  },
});

// Custom feature tests
describe('LobeJinaAI - custom features', () => {
  describe('params export', () => {
    it('should export params object', () => {
      expect(params).toBeDefined();
      expect(params.baseURL).toBe(defaultBaseURL);
      expect(params.provider).toBe(provider);
    });

    it('should have correct debug configuration', () => {
      expect(params.debug?.chatCompletion).toBeDefined();

      // Test debug = false
      delete process.env.DEBUG_JINA_CHAT_COMPLETION;
      expect(params.debug?.chatCompletion?.()).toBe(false);

      // Test debug = true
      process.env.DEBUG_JINA_CHAT_COMPLETION = '1';
      expect(params.debug?.chatCompletion?.()).toBe(true);

      // Cleanup
      delete process.env.DEBUG_JINA_CHAT_COMPLETION;
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

    it('should transform Jina models to ChatModelCard format', async () => {
      const mockModels: JinaModelCard[] = [
        { id: 'jina-deepsearch-v1' },
        { id: 'jina-embeddings-v3' },
      ];

      mockClient.models.list.mockResolvedValue({ data: mockModels });

      const result = await params.models!({ client: mockClient });

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        id: 'jina-deepsearch-v1',
        reasoning: true, // Contains 'deepsearch' keyword
      });
      expect(result[1]).toMatchObject({
        id: 'jina-embeddings-v3',
        reasoning: false,
      });
    });

    it('should detect reasoning models by deepsearch keyword', async () => {
      const mockModels: JinaModelCard[] = [{ id: 'jina-deepsearch-v2' }, { id: 'deepsearch-pro' }];

      mockClient.models.list.mockResolvedValue({ data: mockModels });

      const result = await params.models!({ client: mockClient });

      expect(result[0].reasoning).toBe(true);
      expect(result[1].reasoning).toBe(true);
    });

    it('should use case-insensitive matching for deepsearch keyword', async () => {
      const mockModels: JinaModelCard[] = [{ id: 'JINA-DEEPSEARCH-UPPER' }];

      mockClient.models.list.mockResolvedValue({ data: mockModels });

      const result = await params.models!({ client: mockClient });

      expect(result[0].reasoning).toBe(true);
    });

    it('should handle models not in LOBE_DEFAULT_MODEL_LIST', async () => {
      const mockModels: JinaModelCard[] = [{ id: 'unknown-custom-model' }];

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
      const mockModels: JinaModelCard[] = [{ id: 'jina-embeddings-v3' }];

      mockClient.models.list.mockResolvedValue({ data: mockModels });

      const result = await params.models!({ client: mockClient });

      // Should get all abilities from knownModel if exists
      expect(result[0]).toHaveProperty('functionCall');
      expect(result[0]).toHaveProperty('vision');
      expect(result[0]).toHaveProperty('reasoning');
    });

    it('should merge reasoning from keyword and knownModel abilities', async () => {
      const mockModels: JinaModelCard[] = [
        { id: 'jina-deepsearch-v1' }, // Has keyword
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
      const mockModels: JinaModelCard[] = [{ id: 'unknown-model' }];

      mockClient.models.list.mockResolvedValue({ data: mockModels });

      const result = await params.models!({ client: mockClient });

      expect(result[0].contextWindowTokens).toBeUndefined();
    });

    it('should fallback to false for enabled when not in known models', async () => {
      const mockModels: JinaModelCard[] = [{ id: 'unknown-model' }];

      mockClient.models.list.mockResolvedValue({ data: mockModels });

      const result = await params.models!({ client: mockClient });

      expect(result[0].enabled).toBe(false);
    });
  });
});
