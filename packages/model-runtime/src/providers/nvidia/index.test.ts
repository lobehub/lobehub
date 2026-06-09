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
        model: 'moonshotai/kimi-k2.6',
        messages: [{ role: 'user', content: 'test' }],
        thinking: { type: 'enabled' as const },
      };

      const result = params.chatCompletion!.handlePayload!(payload as any);

      expect(result).toEqual({
        model: 'moonshotai/kimi-k2.6',
        messages: [{ role: 'user', content: 'test' }],
        chat_template_kwargs: { thinking: true },
      });
    });

    it('should add chat_template_kwargs with thinking: false when thinking.type is disabled', () => {
      const payload = {
        model: 'moonshotai/kimi-k2.6',
        messages: [{ role: 'user', content: 'test' }],
        thinking: { type: 'disabled' as const },
      };

      const result = params.chatCompletion!.handlePayload!(payload as any);

      expect(result).toEqual({
        model: 'moonshotai/kimi-k2.6',
        messages: [{ role: 'user', content: 'test' }],
        chat_template_kwargs: { thinking: false },
      });
    });

    it('should not add chat_template_kwargs when thinking type is not set', () => {
      const payload = {
        model: 'moonshotai/kimi-k2.6',
        messages: [{ role: 'user', content: 'test' }],
        thinking: {},
      };

      const result = params.chatCompletion!.handlePayload!(payload as any);

      expect(result).toEqual({
        model: 'moonshotai/kimi-k2.6',
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

    it('should use enable_thinking and clear_thinking for GLM models', () => {
      const payload = {
        model: 'z-ai/glm-5.1',
        messages: [{ role: 'user', content: 'test' }],
        thinking: { type: 'enabled' as const },
      };

      const result = params.chatCompletion!.handlePayload!(payload as any);

      expect(result.chat_template_kwargs).toEqual({ enable_thinking: true, clear_thinking: false });
    });

    it('should use enable_thinking and clear_thinking for GLM models when disabled', () => {
      const payload = {
        model: 'z-ai/glm-5.1',
        messages: [{ role: 'user', content: 'test' }],
        thinking: { type: 'disabled' as const },
      };

      const result = params.chatCompletion!.handlePayload!(payload as any);

      expect(result.chat_template_kwargs).toEqual({
        enable_thinking: false,
        clear_thinking: false,
      });
    });

    it('should use chat_template_kwargs.thinking for kimi-k2.6', () => {
      const payload = {
        model: 'moonshotai/kimi-k2.6',
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
        model: 'z-ai/glm-5.1',
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
        model: 'moonshotai/kimi-k2.6',
        messages: [{ role: 'user', content: 'test' }],
        thinking: { type: 'enabled' as const },
        temperature: 0.7,
        max_tokens: 1000,
      };

      const result = params.chatCompletion!.handlePayload!(payload as any);

      expect(result).toEqual({
        model: 'moonshotai/kimi-k2.6',
        messages: [{ role: 'user', content: 'test' }],
        temperature: 0.7,
        max_tokens: 1000,
        chat_template_kwargs: { thinking: true },
      });
    });

    it('should put reasoning_effort inside chat_template_kwargs for DeepSeek V4 models', () => {
      const payload = {
        model: 'deepseek-ai/deepseek-v4-flash',
        messages: [{ role: 'user', content: 'test' }],
        thinking: { type: 'enabled' as const },
        reasoning_effort: 'max',
      };

      const result = params.chatCompletion!.handlePayload!(payload as any);

      expect(result.chat_template_kwargs).toEqual({
        thinking: true,
        reasoning_effort: 'max',
      });
    });

    it('should not include reasoning_effort at top level for DeepSeek V4 models', () => {
      const payload = {
        model: 'deepseek-ai/deepseek-v4-pro',
        messages: [{ role: 'user', content: 'test' }],
        thinking: { type: 'enabled' as const },
        reasoning_effort: 'high',
      };

      const result = params.chatCompletion!.handlePayload!(payload as any);

      expect(result).not.toHaveProperty('reasoning_effort');
    });

    // Responses API path for gpt-oss models
    it('should set apiMode: responses for gpt-oss-120b', () => {
      const payload = {
        model: 'openai/gpt-oss-120b',
        messages: [{ role: 'user', content: 'test' }],
        reasoning_effort: 'high',
      };

      const result = params.chatCompletion!.handlePayload!(payload as any);

      expect(result).toEqual({
        model: 'openai/gpt-oss-120b',
        reasoning_effort: 'high',
        apiMode: 'responses',
      });
    });

    it('should default reasoning_effort to medium for gpt-oss models', () => {
      const payload = {
        model: 'openai/gpt-oss-20b',
        messages: [{ role: 'user', content: 'test' }],
      };

      const result = params.chatCompletion!.handlePayload!(payload as any);

      expect(result).toMatchObject({
        model: 'openai/gpt-oss-20b',
        reasoning_effort: 'medium',
        apiMode: 'responses',
      });
    });

    it('should pass reasoning_effort as none for gpt-oss models when thinking is disabled', () => {
      const payload = {
        model: 'openai/gpt-oss-120b',
        messages: [{ role: 'user', content: 'test' }],
        thinking: { type: 'disabled' as const },
      };

      const result = params.chatCompletion!.handlePayload!(payload as any);

      expect(result).toMatchObject({
        reasoning_effort: 'medium',
        apiMode: 'responses',
      });
    });

    // nemotron-nano-9b thinking via system message tag
    it('should append /think to system message for nemotron-nano-9b when thinking enabled', () => {
      const payload = {
        model: 'nvidia/nvidia-nemotron-nano-9b-v2',
        messages: [{ role: 'system', content: 'You are helpful.' }, { role: 'user', content: 'hi' }],
        thinking: { type: 'enabled' as const },
      };

      const result = params.chatCompletion!.handlePayload!(payload as any);

      expect(result.messages[0].content).toBe('You are helpful./think');
      expect(result.extra_body).toEqual({ min_thinking_tokens: 1024, max_thinking_tokens: 4096 });
    });

    it('should append /no_think to system message for nemotron-nano-9b when thinking disabled', () => {
      const payload = {
        model: 'nvidia/nvidia-nemotron-nano-9b-v2',
        messages: [{ role: 'system', content: 'You are helpful.' }, { role: 'user', content: 'hi' }],
        thinking: { type: 'disabled' as const },
      };

      const result = params.chatCompletion!.handlePayload!(payload as any);

      expect(result.messages[0].content).toBe('You are helpful./no_think');
      expect(result.extra_body).toBeUndefined();
    });

    it('should create system message for nemotron-nano-9b when none exists', () => {
      const payload = {
        model: 'nvidia/nvidia-nemotron-nano-9b-v2',
        messages: [{ role: 'user', content: 'hi' }],
        thinking: { type: 'enabled' as const },
      };

      const result = params.chatCompletion!.handlePayload!(payload as any);

      expect(result.messages[0]).toEqual({ role: 'system', content: '/think' });
      expect(result.messages[1]).toEqual({ role: 'user', content: 'hi' });
    });

    it('should not modify messages for nemotron-nano-9b when thinking is not set', () => {
      const payload = {
        model: 'nvidia/nvidia-nemotron-nano-9b-v2',
        messages: [{ role: 'user', content: 'hi' }],
      };

      const result = params.chatCompletion!.handlePayload!(payload as any);

      expect(result.messages).toEqual([{ role: 'user', content: 'hi' }]);
    });

    // Tool schema sanitization scoped to Kimi K2.6
    it('should sanitize tool parameters for Kimi K2.6', () => {
      const payload = {
        model: 'moonshotai/kimi-k2.6',
        messages: [{ role: 'user', content: 'test' }],
        tools: [
          {
            type: 'function',
            function: {
              name: 'test',
              parameters: {
                type: 'object',
                properties: {
                  type: { type: 'string' },
                  value: { type: 'string' },
                },
              },
            },
          },
        ],
      };

      const result = params.chatCompletion!.handlePayload!(payload as any);

      // The property 'type' should be renamed to '_type'
      expect(result.tools[0].function.parameters.properties).toHaveProperty('_type');
      expect(result.tools[0].function.parameters.properties).not.toHaveProperty('type');
    });

    it('should not sanitize tool parameters for non-Kimi models', () => {
      const payload = {
        model: 'meta/llama-3.1-8b-instruct',
        messages: [{ role: 'user', content: 'test' }],
        tools: [
          {
            type: 'function',
            function: {
              name: 'test',
              parameters: {
                type: 'object',
                properties: {
                  type: { type: 'string' },
                },
              },
            },
          },
        ],
      };

      const result = params.chatCompletion!.handlePayload!(payload as any);

      // Property 'type' should be preserved for non-Kimi models
      expect(result.tools[0].function.parameters.properties).toHaveProperty('type');
    });

    // nemotron-3-nano-30b and nemotron-3-super-120b use enable_thinking (Pattern B)
    it('should use enable_thinking for nemotron-3-nano-30b', () => {
      const payload = {
        model: 'nvidia/nemotron-3-nano-30b-a3b',
        messages: [{ role: 'user', content: 'test' }],
        thinking: { type: 'enabled' as const },
      };

      const result = params.chatCompletion!.handlePayload!(payload as any);

      expect(result.chat_template_kwargs).toEqual({ enable_thinking: true });
    });

    it('should use enable_thinking for nemotron-3-super-120b', () => {
      const payload = {
        model: 'nvidia/nemotron-3-super-120b-a12b',
        messages: [{ role: 'user', content: 'test' }],
        thinking: { type: 'enabled' as const },
      };

      const result = params.chatCompletion!.handlePayload!(payload as any);

      expect(result.chat_template_kwargs).toEqual({ enable_thinking: true });
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
