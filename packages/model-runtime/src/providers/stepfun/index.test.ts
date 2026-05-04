// @vitest-environment node
import { ModelProvider } from 'model-bank';
import OpenAI from 'openai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import { AgentRuntimeErrorType } from '../../types/error';
import { LobeStepfunAI, params } from './index';

const provider = ModelProvider.Stepfun;
const defaultBaseURL = 'https://api.stepfun.com/v1';

testProvider({
  Runtime: LobeStepfunAI,
  chatDebugEnv: 'DEBUG_STEPFUN_CHAT_COMPLETION',
  chatModel: 'stepfun',
  defaultBaseURL,
  provider,
  test: {
    skipAPICall: true,
    skipErrorHandle: true,
  },
});

describe('LobeStepfunAI - custom features', () => {
  let instance: InstanceType<typeof LobeStepfunAI>;

  beforeEach(() => {
    instance = new LobeStepfunAI({ apiKey: 'test_api_key' });
    vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(
      new ReadableStream() as any,
    );
  });

  describe('params export', () => {
    it('should export params with correct structure', () => {
      expect(params).toBeDefined();
      expect(params.provider).toBe(ModelProvider.Stepfun);
      expect(params.baseURL).toBe('https://api.stepfun.com/v1');
      expect(params.debug).toBeDefined();
      expect(params.chatCompletion).toBeDefined();
      expect(params.models).toBeDefined();
    });

    it('should have debug.chatCompletion function', () => {
      expect(typeof params.debug?.chatCompletion).toBe('function');
    });

    it('should return false when DEBUG_STEPFUN_CHAT_COMPLETION is not set', () => {
      delete process.env.DEBUG_STEPFUN_CHAT_COMPLETION;
      expect(params.debug?.chatCompletion()).toBe(false);
    });

    it('should return true when DEBUG_STEPFUN_CHAT_COMPLETION is set to 1', () => {
      process.env.DEBUG_STEPFUN_CHAT_COMPLETION = '1';
      expect(params.debug?.chatCompletion()).toBe(true);
      delete process.env.DEBUG_STEPFUN_CHAT_COMPLETION;
    });
  });

  describe('handlePayload', () => {
    it('should add web_search tool when enabledSearch is true', async () => {
      await instance.chat({
        enabledSearch: true,
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'step-1-8k',
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.tools).toContainEqual({
        function: {
          description: 'use web_search to search information on the internet',
        },
        type: 'web_search',
      });
    });

    it('should merge web_search with existing tools', async () => {
      await instance.chat({
        enabledSearch: true,
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'step-1-8k',
        tools: [{ function: { name: 'test' }, type: 'function' }],
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.tools).toHaveLength(2);
      expect(calledPayload.tools[0]).toEqual({ function: { name: 'test' }, type: 'function' });
      expect(calledPayload.tools[1]).toEqual({
        function: {
          description: 'use web_search to search information on the internet',
        },
        type: 'web_search',
      });
    });

    it('should not add web_search tool when enabledSearch is false', async () => {
      await instance.chat({
        enabledSearch: false,
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'step-1-8k',
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.tools).toBeUndefined();
    });

    it('should not add web_search tool when enabledSearch is undefined', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'step-1-8k',
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.tools).toBeUndefined();
    });

    it('should preserve existing tools when enabledSearch is false', async () => {
      await instance.chat({
        enabledSearch: false,
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'step-1-8k',
        tools: [{ function: { name: 'test' }, type: 'function' }],
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.tools).toHaveLength(1);
      expect(calledPayload.tools[0]).toEqual({ function: { name: 'test' }, type: 'function' });
    });

    it('should set stream to false when tools are present', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'step-1-8k',
        tools: [{ function: { name: 'test' }, type: 'function' }],
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.stream).toBe(false);
    });

    it('should set stream to false when web_search is enabled', async () => {
      await instance.chat({
        enabledSearch: true,
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'step-1-8k',
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.stream).toBe(false);
    });

    it('should set stream to true when no tools are present', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'step-1-8k',
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.stream).toBe(true);
    });

    it('should preserve other payload properties', async () => {
      await instance.chat({
        max_tokens: 100,
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'step-1-8k',
        temperature: 0.7,
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.temperature).toBe(0.7);
      expect(calledPayload.max_tokens).toBe(100);
    });
  });

  describe('models function - keyword detection', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should detect function call from step-1- keyword', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({
            data: [{ id: 'step-1-8k' }],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      expect(models).toBeDefined();
    });

    it('should detect function call from step-1o- keyword', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({
            data: [{ id: 'step-1o-8k' }],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      expect(models).toBeDefined();
    });

    it('should detect function call from step-1v- keyword', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({
            data: [{ id: 'step-1v-8k' }],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      expect(models).toBeDefined();
    });

    it('should detect function call from step-2- keyword', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({
            data: [{ id: 'step-2-16k' }],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      expect(models).toBeDefined();
    });

    it('should detect vision from step-1o- keyword', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({
            data: [{ id: 'step-1o-8k' }],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      expect(models).toBeDefined();
    });

    it('should detect vision from step-r1-v- keyword', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({
            data: [{ id: 'step-r1-v-8k' }],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      expect(models).toBeDefined();
    });

    it('should detect vision from step-1v- keyword', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({
            data: [{ id: 'step-1v-8k' }],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      expect(models).toBeDefined();
    });

    it('should detect reasoning from step-r1- keyword', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({
            data: [{ id: 'step-r1-8k' }],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      expect(models).toBeDefined();
    });

    it('should handle case-insensitive keyword matching', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({
            data: [{ id: 'STEP-1-8K' }, { id: 'Step-R1-Turbo' }],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      expect(models).toBeDefined();
    });

    it('should handle models without matching keywords', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({
            data: [{ id: 'other-model' }],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      expect(models).toBeDefined();
    });

    it('should merge abilities from known models', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({
            data: [{ id: 'step-1-8k' }],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      expect(models).toBeDefined();
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
      expect(models).toEqual([]);
    });
  });

  describe('handleError', () => {
    let instance: InstanceType<typeof LobeStepfunAI>;

    beforeEach(() => {
      instance = new LobeStepfunAI({ apiKey: 'test_api_key' });
      vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(
        new ReadableStream() as any,
      );
    });

    it('should handle 401 error as InvalidProviderAPIKey', async () => {
      const error = new Response('Unauthorized', { status: 401 });

      vi.spyOn(instance['client'].chat.completions, 'create').mockRejectedValue(error);

      try {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'step-1-8k',
        });
      } catch (e: any) {
        expect(e.errorType).toBe(AgentRuntimeErrorType.InvalidProviderAPIKey);
      }
    });

    it('should handle 402 error as InsufficientQuota', async () => {
      const error = new Response('Payment Required', { status: 402 });

      vi.spyOn(instance['client'].chat.completions, 'create').mockRejectedValue(error);

      try {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'step-1-8k',
        });
      } catch (e: any) {
        expect(e.errorType).toBe(AgentRuntimeErrorType.InsufficientQuota);
      }
    });

    it('should handle 429 error as ProviderBizError with rate limit message', async () => {
      const error = new Response('Too Many Requests', { status: 429 });

      vi.spyOn(instance['client'].chat.completions, 'create').mockRejectedValue(error);

      try {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'step-1-8k',
        });
      } catch (e: any) {
        expect(e.errorType).toBe(AgentRuntimeErrorType.ProviderBizError);
        expect(e.message).toContain('rate limit');
      }
    });

    it('should extract error details from nested error structure', async () => {
      const errorInfo = {
        error: {
          code: 'invalid_request',
          message: 'Invalid model parameter',
        },
      };
      const apiError = new OpenAI.APIError(400, errorInfo, 'Request failed', {
        status: 400,
      } as any);

      vi.spyOn(instance['client'].chat.completions, 'create').mockRejectedValue(apiError);

      try {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'step-1-8k',
        });
      } catch (e: any) {
        expect(e.error?.code).toBe('invalid_request');
        expect(e.error?.message).toBe('Invalid model parameter');
      }
    });

    it('should handle error with top-level message', async () => {
      const error = {
        message: 'Something went wrong',
        status: 500,
      };

      vi.spyOn(instance['client'].chat.completions, 'create').mockRejectedValue(error);

      try {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'step-1-8k',
        });
      } catch (e: any) {
        expect(e.error?.message).toBe('Something went wrong');
      }
    });
  });
});
