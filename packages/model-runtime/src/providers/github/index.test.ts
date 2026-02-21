// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import type { GithubModelCard } from './index';
import { LobeGithubAI, params } from './index';

// Basic provider tests
testProvider({
  Runtime: LobeGithubAI,
  chatDebugEnv: 'DEBUG_GITHUB_CHAT_COMPLETION',
  chatModel: 'openai/gpt-4o',
  defaultBaseURL: 'https://models.github.ai/inference',
  invalidErrorType: 'InvalidGithubToken',
  provider: ModelProvider.Github,
});

// Custom feature tests
describe('LobeGithubAI - custom features', () => {
  let instance: InstanceType<typeof LobeGithubAI>;

  beforeEach(() => {
    instance = new LobeGithubAI({ apiKey: 'test_api_key' });
    vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(
      new ReadableStream() as any,
    );
  });

  describe('params configuration', () => {
    it('should export params satisfying OpenAICompatibleFactoryOptions', () => {
      expect(params).toBeDefined();
      expect(params.baseURL).toBe('https://models.github.ai/inference');
      expect(params.provider).toBe(ModelProvider.Github);
      expect(params.chatCompletion?.handlePayload).toBeDefined();
      expect(params.debug.chatCompletion).toBeDefined();
      expect(params.models).toBeDefined();
    });

    it('should configure correct error types', () => {
      expect(params.errorType?.invalidAPIKey).toBe('InvalidGithubToken');
      expect(params.errorType?.bizError).toBe('ProviderBizError');
    });
  });

  describe('debug configuration', () => {
    it('should disable debug by default', () => {
      delete process.env.DEBUG_GITHUB_CHAT_COMPLETION;
      const result = params.debug.chatCompletion();
      expect(result).toBe(false);
    });

    it('should enable debug when env is set to 1', () => {
      process.env.DEBUG_GITHUB_CHAT_COMPLETION = '1';
      const result = params.debug.chatCompletion();
      expect(result).toBe(true);
      delete process.env.DEBUG_GITHUB_CHAT_COMPLETION;
    });

    it('should disable debug when env is set to other values', () => {
      process.env.DEBUG_GITHUB_CHAT_COMPLETION = '0';
      const result = params.debug.chatCompletion();
      expect(result).toBe(false);
      delete process.env.DEBUG_GITHUB_CHAT_COMPLETION;
    });
  });

  describe('handlePayload', () => {
    const basePayload = {
      max_tokens: 100,
      messages: [{ content: 'test', role: 'user' as const }],
      model: 'test-model',
      temperature: 0.7,
    };

    describe('o1 and o3 reasoning models', () => {
      it('should handle o1 models with disabled stream and pruned payload', () => {
        const payload = {
          ...basePayload,
          model: 'o1-preview',
          stream: true,
          temperature: 0.8,
          top_p: 0.9,
        };

        const result = params.chatCompletion!.handlePayload!(payload);

        expect(result.model).toBe('o1-preview');
        expect(result.stream).toBe(false);
        expect(result.temperature).toBe(undefined);
        expect(result.top_p).toBe(undefined);
        expect(result.frequency_penalty).toBe(0);
        expect(result.presence_penalty).toBe(0);
      });

      it('should handle o1-mini models', () => {
        const payload = {
          ...basePayload,
          model: 'o1-mini',
          stream: true,
        };

        const result = params.chatCompletion!.handlePayload!(payload);

        expect(result.model).toBe('o1-mini');
        expect(result.stream).toBe(false);
      });

      it('should handle o3 models', () => {
        const payload = {
          ...basePayload,
          model: 'o3-preview',
          stream: true,
          temperature: 0.5,
        };

        const result = params.chatCompletion!.handlePayload!(payload);

        expect(result.model).toBe('o3-preview');
        expect(result.stream).toBe(false);
        expect(result.temperature).toBe(undefined);
        expect(result.top_p).toBe(undefined);
      });

      it('should handle o3-mini models', () => {
        const payload = {
          ...basePayload,
          model: 'o3-mini',
          stream: true,
        };

        const result = params.chatCompletion!.handlePayload!(payload);

        expect(result.model).toBe('o3-mini');
        expect(result.stream).toBe(false);
      });
    });

    describe('xai/grok-3-mini model', () => {
      it('should remove frequency_penalty and presence_penalty', () => {
        const payload = {
          ...basePayload,
          frequency_penalty: 0.5,
          model: 'xai/grok-3-mini',
          presence_penalty: 0.3,
          stream: true,
        };

        const result = params.chatCompletion!.handlePayload!(payload);

        expect(result.model).toBe('xai/grok-3-mini');
        expect(result.frequency_penalty).toBeUndefined();
        expect(result.presence_penalty).toBeUndefined();
        expect(result.stream).toBe(true);
      });

      it('should preserve other parameters for grok-3-mini', () => {
        const payload = {
          ...basePayload,
          max_tokens: 100,
          model: 'xai/grok-3-mini',
          temperature: 0.7,
        };

        const result = params.chatCompletion!.handlePayload!(payload);

        expect(result.temperature).toBe(0.7);
        expect(result.max_tokens).toBe(100);
      });
    });

    describe('default model handling', () => {
      it('should set stream to true by default', () => {
        const payload = { ...basePayload };
        const result = params.chatCompletion!.handlePayload!(payload);

        expect(result.stream).toBe(true);
      });

      it('should preserve explicit stream value', () => {
        const payload = { ...basePayload, stream: false };
        const result = params.chatCompletion!.handlePayload!(payload);

        expect(result.stream).toBe(false);
      });

      it('should not modify other model payloads', () => {
        const payload = {
          ...basePayload,
          max_tokens: 100,
          model: 'openai/gpt-4o',
          temperature: 0.7,
        };

        const result = params.chatCompletion!.handlePayload!(payload);

        expect(result.model).toBe('openai/gpt-4o');
        expect(result.temperature).toBe(0.7);
        expect(result.max_tokens).toBe(100);
        expect(result.stream).toBe(true);
      });
    });

    describe('edge cases', () => {
      it('should handle models starting with o1 but not exact match', () => {
        const payload = {
          ...basePayload,
          model: 'o1-custom',
          stream: true,
        };

        const result = params.chatCompletion!.handlePayload!(payload);

        expect(result.stream).toBe(false);
      });

      it('should handle models starting with o3 but not exact match', () => {
        const payload = {
          ...basePayload,
          model: 'o3-custom',
          stream: true,
        };

        const result = params.chatCompletion!.handlePayload!(payload);

        expect(result.stream).toBe(false);
      });

      it('should not modify models that contain o1 but do not start with it', () => {
        const payload = {
          ...basePayload,
          model: 'model-o1',
          stream: true,
        };

        const result = params.chatCompletion!.handlePayload!(payload);

        expect(result.stream).toBe(true);
      });

      it('should not modify models that contain o3 but do not start with it', () => {
        const payload = {
          ...basePayload,
          model: 'model-o3',
          stream: true,
        };

        const result = params.chatCompletion!.handlePayload!(payload);

        expect(result.stream).toBe(true);
      });
    });
  });

  describe('models function', () => {
    const mockGithubModels: GithubModelCard[] = [
      {
        capabilities: ['tool-calling', 'vision'],
        html_url: 'https://github.com/models/openai-gpt-4o',
        id: 'openai/gpt-4o',
        limits: {
          max_input_tokens: 128_000,
          max_output_tokens: 4096,
        },
        name: 'GPT-4o',
        publisher: 'OpenAI',
        rate_limit_tier: 'high',
        registry: 'github',
        summary: 'Advanced GPT-4 model',
        supported_input_modalities: ['text', 'image'],
        supported_output_modalities: ['text'],
        tags: ['multimodal'],
        version: '2024-05-13',
      },
      {
        capabilities: ['tool-calling'],
        html_url: 'https://github.com/models/anthropic-claude-3.5-sonnet',
        id: 'anthropic/claude-3.5-sonnet',
        limits: {
          max_input_tokens: 200_000,
          max_output_tokens: 8192,
        },
        name: 'Claude 3.5 Sonnet',
        publisher: 'Anthropic',
        rate_limit_tier: 'high',
        registry: 'github',
        summary: 'Claude 3.5 Sonnet model',
        supported_input_modalities: ['text'],
        supported_output_modalities: ['text'],
        tags: [],
        version: '2024-06-20',
      },
      {
        capabilities: [],
        html_url: 'https://github.com/models/meta-llama-3.1-70b',
        id: 'meta/llama-3.1-70b',
        limits: {
          max_input_tokens: 128_000,
          max_output_tokens: 4096,
        },
        name: 'Meta Llama 3.1 70B',
        publisher: 'Meta',
        rate_limit_tier: 'medium',
        registry: 'github',
        summary: 'Llama 3.1 70B model',
        supported_input_modalities: ['text'],
        supported_output_modalities: ['text'],
        tags: ['reasoning'],
        version: '2024-07-01',
      },
      {
        capabilities: ['tool-calling'],
        html_url: 'https://github.com/models/mistral-large',
        id: 'mistral/mistral-large',
        limits: {
          max_input_tokens: 32_000,
          max_output_tokens: 8192,
        },
        name: 'Mistral Large',
        publisher: 'Mistral AI',
        rate_limit_tier: 'high',
        registry: 'github',
        summary: 'Mistral Large model',
        supported_input_modalities: ['text', 'image'],
        supported_output_modalities: ['text'],
        tags: ['multimodal'],
        version: 'invalid-version',
      },
    ];

    it('should fetch and format models successfully', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        json: async () => mockGithubModels,
      });

      const models = await params.models!();

      expect(models).toBeDefined();
      expect(Array.isArray(models)).toBe(true);
      expect(models.length).toBeGreaterThan(0);

      expect(fetch).toHaveBeenCalledWith('https://models.github.ai/catalog/models');
    });

    it('should format model with all capabilities', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        json: async () => [mockGithubModels[0]],
      });

      const models = await params.models!();
      const model = models.find((m) => m.id === 'openai/gpt-4o');

      expect(model).toBeDefined();
      expect(model?.displayName).toBe('GPT-4o');
      expect(model?.description).toBe('Advanced GPT-4 model');
      expect(model?.contextWindowTokens).toBe(132_096); // 128000 + 4096
      expect(model?.maxOutput).toBe(4096);
      expect(model?.functionCall).toBe(true);
      expect(model?.vision).toBe(true);
      expect(model?.releasedAt).toBe('2024-05-13');
    });

    it('should format model with reasoning tag', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        json: async () => [mockGithubModels[2]],
      });

      const models = await params.models!();
      const model = models.find((m) => m.id === 'meta/llama-3.1-70b');

      expect(model).toBeDefined();
      expect(model?.reasoning).toBe(true);
    });

    it('should handle model without tool-calling capability', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        json: async () => [mockGithubModels[2]],
      });

      const models = await params.models!();
      const model = models.find((m) => m.id === 'meta/llama-3.1-70b');

      expect(model).toBeDefined();
      expect(model?.functionCall).toBe(false);
    });

    it('should handle model without multimodal/vision tags', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        json: async () => [mockGithubModels[1]],
      });

      const models = await params.models!();
      const model = models.find((m) => m.id === 'anthropic/claude-3.5-sonnet');

      expect(model).toBeDefined();
      expect(model?.vision).toBe(false);
    });

    it('should handle invalid version format', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        json: async () => [mockGithubModels[3]],
      });

      const models = await params.models!();
      const model = models.find((m) => m.id === 'mistral/mistral-large');

      expect(model).toBeDefined();
      expect(model?.releasedAt).toBeUndefined();
    });

    it('should validate version format correctly', async () => {
      const validVersionModel = {
        ...mockGithubModels[0],
        version: '2024-01-15',
      };

      global.fetch = vi.fn().mockResolvedValue({
        json: async () => [validVersionModel],
      });

      const models = await params.models!();

      expect(models[0]?.releasedAt).toBe('2024-01-15');
    });

    it('should detect vision from supported_input_modalities', async () => {
      const visionModel = {
        ...mockGithubModels[0],
        supported_input_modalities: ['text', 'image'],
        tags: [],
      };

      global.fetch = vi.fn().mockResolvedValue({
        json: async () => [visionModel],
      });

      const models = await params.models!();

      expect(models[0]?.vision).toBe(true);
    });

    it('should handle empty model list', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        json: async () => [],
      });

      const models = await params.models!();

      expect(models).toBeDefined();
      expect(Array.isArray(models)).toBe(true);
      expect(models.length).toBe(0);
    });

    it('should handle fetch errors gracefully', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      await expect(params.models!()).rejects.toThrow('Network error');
    });

    it('should handle invalid JSON response', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        json: async () => {
          throw new Error('Invalid JSON');
        },
      });

      await expect(params.models!()).rejects.toThrow('Invalid JSON');
    });

    it('should handle models with missing optional fields', async () => {
      const minimalModel: GithubModelCard = {
        capabilities: [],
        html_url: '',
        id: 'test/model',
        limits: {
          max_input_tokens: 1000,
          max_output_tokens: 100,
        },
        name: 'Test Model',
        publisher: 'Test',
        rate_limit_tier: '',
        registry: '',
        summary: 'Test summary',
        supported_input_modalities: [],
        supported_output_modalities: [],
        tags: [],
        version: '',
      };

      global.fetch = vi.fn().mockResolvedValue({
        json: async () => [minimalModel],
      });

      const models = await params.models!();
      const model = models[0];

      expect(model).toBeDefined();
      expect(model?.id).toBe('test/model');
      expect(model?.functionCall).toBe(false);
      expect(model?.vision).toBe(false);
      expect(model?.reasoning).toBe(false);
      expect(model?.releasedAt).toBeUndefined();
    });

    it('should calculate contextWindowTokens correctly', async () => {
      const testModel = {
        ...mockGithubModels[0],
        limits: {
          max_input_tokens: 100_000,
          max_output_tokens: 5000,
        },
      };

      global.fetch = vi.fn().mockResolvedValue({
        json: async () => [testModel],
      });

      const models = await params.models!();

      expect(models[0]?.contextWindowTokens).toBe(105_000);
    });

    it('should handle multiple models with different features', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        json: async () => mockGithubModels,
      });

      const models = await params.models!();

      expect(models.length).toBeGreaterThan(0);

      const gpt4o = models.find((m) => m.id === 'openai/gpt-4o');
      expect(gpt4o?.functionCall).toBe(true);
      expect(gpt4o?.vision).toBe(true);

      const claude = models.find((m) => m.id === 'anthropic/claude-3.5-sonnet');
      expect(claude?.functionCall).toBe(true);
      expect(claude?.vision).toBe(false);

      const llama = models.find((m) => m.id === 'meta/llama-3.1-70b');
      expect(llama?.reasoning).toBe(true);
    });
  });
});
