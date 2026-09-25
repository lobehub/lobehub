// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { describe, expect, it, vi } from 'vitest';

import { params } from './index';

describe('LobeHigressAI - params', () => {
  it('should have correct baseURL default', () => {
    expect(params.provider).toBe(ModelProvider.Higress);
  });

  it('should have constructorOptions with default headers', () => {
    expect(params.constructorOptions?.defaultHeaders).toHaveProperty('HTTP-Referer');
    expect(params.constructorOptions?.defaultHeaders).toHaveProperty('X-Title');
    expect(params.constructorOptions?.defaultHeaders).toHaveProperty('x-Request-Id');
  });

  describe('models function', () => {
    it('should process model list correctly', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({
            data: [
              {
                id: 'gpt-4',
                name: 'GPT-4',
                description: 'GPT-4 with vision and function calling support',
                context_length: 8192,
                top_provider: {
                  max_completion_tokens: 4096,
                },
              },
              {
                id: 'claude-3-opus',
                name: 'Claude 3 Opus',
                description: 'Claude 3 Opus supports multimodal and reasoning',
                context_length: 200000,
                top_provider: {
                  max_completion_tokens: 4096,
                },
              },
            ],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });

      expect(models.length).toBeGreaterThan(0);
      expect(models[0]).toHaveProperty('id');
      expect(models[0]).toHaveProperty('displayName');
      expect(models[0]).toHaveProperty('contextWindowTokens');
      expect(models[0]).toHaveProperty('functionCall');
      expect(models[0]).toHaveProperty('vision');
      expect(models[0]).toHaveProperty('reasoning');
    });

    it('should detect functionCall from description', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({
            data: [
              {
                id: 'test-model',
                name: 'Test Model',
                description: 'This model supports function calling',
                context_length: 8192,
                top_provider: {
                  max_completion_tokens: 4096,
                },
              },
            ],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      expect(models[0].functionCall).toBe(true);
    });

    it('should detect vision from description', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({
            data: [
              {
                id: 'test-model',
                name: 'Test Model',
                description: 'This model supports vision capabilities',
                context_length: 8192,
                top_provider: {
                  max_completion_tokens: 4096,
                },
              },
            ],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      expect(models[0].vision).toBe(true);
    });

    it('should detect reasoning from description', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({
            data: [
              {
                id: 'test-model',
                name: 'Test Model',
                description: 'This model supports reasoning',
                context_length: 8192,
                top_provider: {
                  max_completion_tokens: 4096,
                },
              },
            ],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      expect(models[0].reasoning).toBe(true);
    });
  });

  describe('debug', () => {
    it('should return false when DEBUG_HIGRESS_CHAT_COMPLETION is not set', () => {
      delete process.env.DEBUG_HIGRESS_CHAT_COMPLETION;
      expect(params.debug?.chatCompletion()).toBe(false);
    });

    it('should return true when DEBUG_HIGRESS_CHAT_COMPLETION is set to 1', () => {
      process.env.DEBUG_HIGRESS_CHAT_COMPLETION = '1';
      expect(params.debug?.chatCompletion()).toBe(true);
      delete process.env.DEBUG_HIGRESS_CHAT_COMPLETION;
    });
  });
});
