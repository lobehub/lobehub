// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import { LobeBailianCodingPlanAI } from './index';

const provider = ModelProvider.BailianCodingPlan;
const defaultBaseURL = 'https://coding.dashscope.aliyuncs.com/v1';

testProvider({
  Runtime: LobeBailianCodingPlanAI,
  provider,
  defaultBaseURL,
  chatDebugEnv: 'DEBUG_BAILIAN_CODING_PLAN_CHAT_COMPLETION',
  chatModel: 'qwen3.5-plus',
  test: {
    skipAPICall: true,
  },
});

describe('LobeBailianCodingPlanAI - reasoning_content transformation', () => {
  let instance: InstanceType<typeof LobeBailianCodingPlanAI>;

  beforeEach(() => {
    instance = new LobeBailianCodingPlanAI({ apiKey: 'test_api_key' });
    vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(
      new ReadableStream() as any,
    );
  });

  describe('handlePayload', () => {
    it('should transform reasoning.content to reasoning_content for assistant messages', async () => {
      await instance.chat({
        messages: [
          { content: 'Hello', role: 'user' },
          {
            content: 'The answer is 42.',
            reasoning: { content: 'Let me think about this...' },
            role: 'assistant',
          },
        ],
        model: 'qwen3.6-plus',
        thinking: { type: 'enabled', budget_tokens: 1024 },
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      const assistantMessage = calledPayload.messages.find((m: any) => m.role === 'assistant');

      expect(assistantMessage.reasoning_content).toBe('Let me think about this...');
      expect(assistantMessage.reasoning).toBeUndefined();
    });

    it('should preserve reasoning_content if already present', async () => {
      await instance.chat({
        messages: [
          { content: 'Hello', role: 'user' },
          {
            content: 'The answer is 42.',
            reasoning_content: 'Existing reasoning content',
            role: 'assistant',
          },
        ],
        model: 'qwen3.6-plus',
        thinking: { type: 'enabled', budget_tokens: 1024 },
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      const assistantMessage = calledPayload.messages.find((m: any) => m.role === 'assistant');

      expect(assistantMessage.reasoning_content).toBe('Existing reasoning content');
    });

    it('should not add reasoning_content for non-assistant messages', async () => {
      await instance.chat({
        messages: [
          {
            content: 'Hello',
            reasoning: { content: 'User thinking' },
            role: 'user',
          },
        ],
        model: 'qwen3.6-plus',
        thinking: { type: 'enabled', budget_tokens: 1024 },
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      const userMessage = calledPayload.messages.find((m: any) => m.role === 'user');

      // reasoning field is removed by OpenAI compatible runtime (not bailianCodingPlan specific)
      // only assistant messages get reasoning_content transformation
      expect(userMessage.reasoning_content).toBeUndefined();
    });

    it('should not transform reasoning with signature (thinking mode)', async () => {
      await instance.chat({
        messages: [
          { content: 'Hello', role: 'user' },
          {
            content: 'The answer is 42.',
            reasoning: { content: 'Thinking...', signature: 'abc123' },
            role: 'assistant',
          },
        ],
        model: 'qwen3.6-plus',
        thinking: { type: 'enabled', budget_tokens: 1024 },
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      const assistantMessage = calledPayload.messages.find((m: any) => m.role === 'assistant');

      // reasoning with signature should be transformed to reasoning_content
      expect(assistantMessage.reasoning_content).toBe('Thinking...');
      expect(assistantMessage.reasoning).toBeUndefined();
    });

    it('should set preserve_thinking when thinking is enabled', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'qwen3.6-plus',
        thinking: { type: 'enabled', budget_tokens: 2048 },
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.preserve_thinking).toBe(true);
      expect(calledPayload.enable_thinking).toBe(true);
      expect(calledPayload.thinking_budget).toBe(2048);
    });

    it('should not set preserve_thinking when thinking is disabled', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'qwen3.6-plus',
        thinking: { type: 'disabled', budget_tokens: 0 },
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.preserve_thinking).toBeUndefined();
      expect(calledPayload.enable_thinking).toBeUndefined();
    });
  });
});
