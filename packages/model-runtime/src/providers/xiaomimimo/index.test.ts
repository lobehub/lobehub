// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { describe, expect, it, vi } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import { LobeXiaomiMiMoAI, params } from './index';

const provider = ModelProvider.XiaomiMiMo;
const defaultBaseURL = 'https://api.xiaomimimo.com/v1';

testProvider({
  Runtime: LobeXiaomiMiMoAI,
  provider,
  defaultBaseURL,
  chatDebugEnv: 'DEBUG_XIAOMIMIMO_CHAT_COMPLETION',
  chatModel: 'gpt-4o',
  test: {
    skipAPICall: true,
  },
});

describe('LobeXiaomiMiMoAI - custom features', () => {
  describe('chatCompletion.handlePayload', () => {
    it('should map max_tokens to max_completion_tokens', () => {
      const payload = {
        max_tokens: 1000,
        model: 'gpt-4o',
      };

      const result = params.chatCompletion!.handlePayload!(payload as any);

      expect(result.max_completion_tokens).toBe(1000);
      expect(result.max_tokens).toBeUndefined();
    });

    it('should set stream to true by default', () => {
      const payload = {
        model: 'gpt-4o',
      };

      const result = params.chatCompletion!.handlePayload!(payload as any);

      expect(result.stream).toBe(true);
    });

    it('should preserve existing stream value', () => {
      const payload = {
        model: 'gpt-4o',
        stream: false,
      };

      const result = params.chatCompletion!.handlePayload!(payload as any);

      expect(result.stream).toBe(false);
    });

    it('should clamp temperature between 0 and 1.5', () => {
      const payloadLow = {
        temperature: -1,
        model: 'gpt-4o',
      };
      const resultLow = params.chatCompletion!.handlePayload!(payloadLow as any);
      expect(resultLow.temperature).toBe(0);

      const payloadHigh = {
        temperature: 2,
        model: 'gpt-4o',
      };
      const resultHigh = params.chatCompletion!.handlePayload!(payloadHigh as any);
      expect(resultHigh.temperature).toBe(1.5);

      const payloadNormal = {
        temperature: 0.7,
        model: 'gpt-4o',
      };
      const resultNormal = params.chatCompletion!.handlePayload!(payloadNormal as any);
      expect(resultNormal.temperature).toBe(0.7);
    });

    it('should clamp top_p between 0.01 and 1', () => {
      const payloadLow = {
        top_p: 0,
        model: 'gpt-4o',
      };
      const resultLow = params.chatCompletion!.handlePayload!(payloadLow as any);
      expect(resultLow.top_p).toBe(0.01);

      const payloadHigh = {
        top_p: 1.5,
        model: 'gpt-4o',
      };
      const resultHigh = params.chatCompletion!.handlePayload!(payloadHigh as any);
      expect(resultHigh.top_p).toBe(1);

      const payloadNormal = {
        top_p: 0.5,
        model: 'gpt-4o',
      };
      const resultNormal = params.chatCompletion!.handlePayload!(payloadNormal as any);
      expect(resultNormal.top_p).toBe(0.5);
    });

    it('should handle thinking type enabled/disabled', () => {
      const payloadEnabled = {
        thinking: { type: 'enabled' },
        model: 'gpt-4o',
      };
      const resultEnabled = params.chatCompletion!.handlePayload!(payloadEnabled as any);
      expect(resultEnabled.thinking).toEqual({ type: 'enabled' });

      const payloadDisabled = {
        thinking: { type: 'disabled' },
        model: 'gpt-4o',
      };
      const resultDisabled = params.chatCompletion!.handlePayload!(payloadDisabled as any);
      expect(resultDisabled.thinking).toEqual({ type: 'disabled' });

      const payloadOther = {
        thinking: { type: 'other' },
        model: 'gpt-4o',
      };
      const resultOther = params.chatCompletion!.handlePayload!(payloadOther as any);
      expect(resultOther.thinking).toBeUndefined();
    });
  });

  describe('models', () => {
    it('should fetch and process model list', async () => {
      const mockModels = [{ id: 'model-1' }, { id: 'model-2' }];
      const client = {
        models: {
          list: vi.fn().mockResolvedValue({ data: mockModels }),
        },
      };

      const result = await params.models!({ client: client as any });

      expect(client.models.list).toHaveBeenCalled();
      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'model-1' }),
          expect.objectContaining({ id: 'model-2' }),
        ]),
      );
    });
  });
});
