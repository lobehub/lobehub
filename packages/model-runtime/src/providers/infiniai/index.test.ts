// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LobeInfiniAI } from './index';

describe('LobeInfiniAI - custom features', () => {
  let instance: InstanceType<typeof LobeInfiniAI>;

  beforeEach(() => {
    instance = new LobeInfiniAI({ apiKey: 'test_api_key' });
    vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(
      new ReadableStream() as any,
    );
  });

  describe('handlePayload', () => {
    it('should add enable_thinking when thinking is enabled', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'deepseek-v3',
        thinking: {
          type: 'enabled',
          budget_tokens: 1000,
        },
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.enable_thinking).toBe(true);
    });

    it('should not add enable_thinking when thinking is disabled', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'deepseek-v3',
        thinking: {
          budget_tokens: 1000,
          type: 'disabled',
        },
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.enable_thinking).toBe(false);
    });

    it('should set enable_thinking to false when thinking is undefined', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'deepseek-v3',
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.enable_thinking).toBe(false);
    });
  });
});
