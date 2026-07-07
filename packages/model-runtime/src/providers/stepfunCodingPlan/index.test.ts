// @vitest-environment node
import { ModelProvider } from 'model-bank';
import OpenAI from 'openai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import { AgentRuntimeErrorType } from '../../types/error';
import { LobeStepFunCodingPlanAI, params } from './index';

const provider = ModelProvider.StepFunCodingPlan;
const defaultBaseURL = 'https://api.stepfun.com/step_plan/v1';

testProvider({
  Runtime: LobeStepFunCodingPlanAI,
  chatDebugEnv: 'DEBUG_STEPFUN_CODING_PLAN_CHAT_COMPLETION',
  chatModel: 'step-3.5-flash',
  defaultBaseURL,
  provider,
  test: {
    skipAPICall: true,
    skipErrorHandle: true,
  },
});

describe('LobeStepFunCodingPlanAI', () => {
  let instance: InstanceType<typeof LobeStepFunCodingPlanAI>;

  beforeEach(() => {
    instance = new LobeStepFunCodingPlanAI({ apiKey: 'test_api_key' });
    vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(
      new ReadableStream() as any,
    );
  });

  describe('handlePayload', () => {
    it('should set stream to true', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'step-3.5-flash',
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.stream).toBe(true);
    });

    it('should filter out thinking parameter', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'step-3.5-flash',
        thinking: { budget_tokens: 1000, type: 'enabled' },
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.thinking).toBeUndefined();
      expect(calledPayload.enable_thinking).toBeUndefined();
    });

    it('should filter out enabledSearch parameter', async () => {
      await instance.chat({
        enabledSearch: true,
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'step-3.5-flash',
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.enabledSearch).toBeUndefined();
    });

    it('should add parallel_tool_calls when tools are present', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'step-3.5-flash',
        tools: [{ function: { name: 'test' }, type: 'function' }],
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.parallel_tool_calls).toBe(true);
    });

    it('should not add parallel_tool_calls when no tools', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'step-3.5-flash',
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.parallel_tool_calls).toBeUndefined();
    });

    it('should preserve other payload properties', async () => {
      await instance.chat({
        max_tokens: 100,
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'step-3.5-flash',
        temperature: 0.7,
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.temperature).toBe(0.7);
      expect(calledPayload.max_tokens).toBe(100);
    });
  });

  describe('handleError', () => {
    it('should handle 401 error as InvalidProviderAPIKey', async () => {
      const error = new Response('Unauthorized', { status: 401 });

      vi.spyOn(instance['client'].chat.completions, 'create').mockRejectedValue(error);

      try {
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'step-3.5-flash',
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
          model: 'step-3.5-flash',
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
          model: 'step-3.5-flash',
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
          model: 'step-3.5-flash',
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
          model: 'step-3.5-flash',
        });
      } catch (e: any) {
        expect(e.error?.message).toBe('Something went wrong');
      }
    });
  });

  describe('params export', () => {
    it('should export params with correct structure', () => {
      expect(params).toBeDefined();
      expect(params.provider).toBe(ModelProvider.StepFunCodingPlan);
      expect(params.baseURL).toBe(defaultBaseURL);
      expect(params.chatCompletion?.handleError).toBeDefined();
      expect(params.errorType).toBeDefined();
    });
  });
});
