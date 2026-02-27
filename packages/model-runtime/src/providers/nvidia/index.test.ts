// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { describe, expect, it, vi } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import { LobeNvidiaAI, params } from './index';

const provider = ModelProvider.Nvidia;
const defaultBaseURL = 'https://integrate.api.nvidia.com/v1';

testProvider({
  Runtime: LobeNvidiaAI,
  provider,
  defaultBaseURL,
  chatDebugEnv: 'DEBUG_NVIDIA_CHAT_COMPLETION',
  chatModel: 'meta/llama-3.1-8b-instruct',
  test: {
    skipAPICall: true,
  },
});

describe('LobeNvidiaAI - custom features', () => {
  describe('handlePayload', () => {
    // thinking parameter conversion
    it('should add chat_template_kwargs with thinking: true when thinking.type is enabled', () => {
      const payload = {
        model: 'deepseek-ai/deepseek-v3.1',
        messages: [{ role: 'user', content: 'test' }],
        thinking: { type: 'enabled' as const },
      };

      const result = params.chatCompletion!.handlePayload!(payload as any);

      expect(result).toEqual({
        model: 'deepseek-ai/deepseek-v3.1',
        messages: [{ role: 'user', content: 'test' }],
        chat_template_kwargs: { thinking: true },
      });
    });

    it('should add chat_template_kwargs with thinking: false when thinking.type is disabled', () => {
      const payload = {
        model: 'deepseek-ai/deepseek-v3.1',
        messages: [{ role: 'user', content: 'test' }],
        thinking: { type: 'disabled' as const },
      };

      const result = params.chatCompletion!.handlePayload!(payload as any);

      expect(result).toEqual({
        model: 'deepseek-ai/deepseek-v3.1',
        messages: [{ role: 'user', content: 'test' }],
        chat_template_kwargs: { thinking: false },
      });
    });

    it('should not add chat_template_kwargs when thinking type is not set', () => {
      const payload = {
        model: 'deepseek-ai/deepseek-v3.1',
        messages: [{ role: 'user', content: 'test' }],
        thinking: {},
      };

      const result = params.chatCompletion!.handlePayload!(payload as any);

      expect(result).toEqual({
        model: 'deepseek-ai/deepseek-v3.1',
        messages: [{ role: 'user', content: 'test' }],
      });
    });

    it('should not add chat_template_kwargs when thinking param is not provided', () => {
      const payload = {
        model: 'meta/llama-3.1-8b-instruct',
        messages: [{ role: 'user', content: 'test' }],
      };

      const result = params.chatCompletion!.handlePayload!(payload as any);

      expect(result).toEqual({
        model: 'meta/llama-3.1-8b-instruct',
        messages: [{ role: 'user', content: 'test' }],
      });
    });

    it('should use enable_thinking and clear_thinking for GLM models when enabled', () => {
      const payload = {
        model: 'z-ai/glm5',
        messages: [{ role: 'user', content: 'test' }],
        thinking: { type: 'enabled' as const },
      };

      const result = params.chatCompletion!.handlePayload!(payload as any);

      expect(result.chat_template_kwargs).toEqual({ enable_thinking: true, clear_thinking: false });
    });

    it('should use enable_thinking and clear_thinking for GLM models when disabled', () => {
      const payload = {
        model: 'z-ai/glm5',
        messages: [{ role: 'user', content: 'test' }],
        thinking: { type: 'disabled' as const },
      };

      const result = params.chatCompletion!.handlePayload!(payload as any);

      expect(result.chat_template_kwargs).toEqual({
        enable_thinking: false,
        clear_thinking: false,
      });
    });

    it('should use thinking for non-GLM models', () => {
      const payload = {
        model: 'deepseek-ai/deepseek-v3.2',
        messages: [{ role: 'user', content: 'test' }],
        thinking: { type: 'enabled' as const },
      };

      const result = params.chatCompletion!.handlePayload!(payload as any);

      expect(result.chat_template_kwargs).toEqual({ thinking: true });
    });

    // reasoning -> reasoning_content conversion
    it('should convert reasoning to reasoning_content for all NVIDIA models', () => {
      const payload = {
        model: 'meta/llama-3.1-8b-instruct',
        messages: [
          { role: 'user', content: 'test' },
          { role: 'assistant', reasoning: { content: 'thinking process' }, content: 'response' },
        ],
      };

      const result = params.chatCompletion!.handlePayload!(payload as any);

      expect(result.messages).toEqual([
        { role: 'user', content: 'test' },
        { role: 'assistant', content: 'response', reasoning_content: 'thinking process' },
      ]);
    });

    it('should convert reasoning to reasoning_content combined with thinking param', () => {
      const payload = {
        model: 'z-ai/glm5',
        messages: [
          { role: 'user', content: 'test' },
          { role: 'assistant', reasoning: { content: 'thinking process' }, content: 'response' },
        ],
        thinking: { type: 'enabled' as const },
      };

      const result = params.chatCompletion!.handlePayload!(payload as any);

      expect(result.messages).toEqual([
        { role: 'user', content: 'test' },
        { role: 'assistant', content: 'response', reasoning_content: 'thinking process' },
      ]);
      // GLM models use enable_thinking + clear_thinking
      expect(result.chat_template_kwargs).toEqual({ enable_thinking: true, clear_thinking: false });
    });

    it('should preserve other payload properties', () => {
      const payload = {
        model: 'deepseek-ai/deepseek-v3.1',
        messages: [{ role: 'user', content: 'test' }],
        thinking: { type: 'enabled' as const },
        temperature: 0.7,
        max_tokens: 1000,
      };

      const result = params.chatCompletion!.handlePayload!(payload as any);

      expect(result).toEqual({
        model: 'deepseek-ai/deepseek-v3.1',
        messages: [{ role: 'user', content: 'test' }],
        temperature: 0.7,
        max_tokens: 1000,
        chat_template_kwargs: { thinking: true },
      });
    });
  });

  describe('models', () => {
    it('should fetch and process models successfully', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({
            data: [
              { id: 'meta/llama-3.1-8b-instruct' },
              { id: 'deepseek-ai/deepseek-v3.1' },
              { id: 'nvidia/nemotron-4-340b-instruct' },
            ],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });

      expect(mockClient.models.list).toHaveBeenCalled();
      expect(models).toBeDefined();
      expect(Array.isArray(models)).toBe(true);
    });

    it('should handle empty model list', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({
            data: [],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });

      expect(mockClient.models.list).toHaveBeenCalled();
      expect(models).toBeDefined();
      expect(Array.isArray(models)).toBe(true);
    });

    it('should handle API errors gracefully', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockRejectedValue(new Error('API Error')),
        },
      };

      await expect(params.models!({ client: mockClient as any })).rejects.toThrow('API Error');
      expect(mockClient.models.list).toHaveBeenCalled();
    });
  });

  describe('debug configuration', () => {
    it('should enable debug when env is set', () => {
      process.env.DEBUG_NVIDIA_CHAT_COMPLETION = '1';
      const result = params.debug.chatCompletion();
      expect(result).toBe(true);
      delete process.env.DEBUG_NVIDIA_CHAT_COMPLETION;
    });

    it('should disable debug by default', () => {
      delete process.env.DEBUG_NVIDIA_CHAT_COMPLETION;
      const result = params.debug.chatCompletion();
      expect(result).toBe(false);
    });
  });
});
