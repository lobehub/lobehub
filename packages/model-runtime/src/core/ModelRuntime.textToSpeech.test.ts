// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import type { TextToSpeechResponse } from '../types';
import { ModelRuntime, type ModelRuntimeHooks } from './ModelRuntime';

vi.mock('../providers/lobehub', () => ({
  LobeHubAI: class LobeHubAI {},
}));

const createMockRuntime = (hooks?: ModelRuntimeHooks) => {
  const mockRuntimeAI = { textToSpeech: vi.fn() } as any;
  return { runtime: new ModelRuntime(mockRuntimeAI, hooks), mockRuntimeAI };
};

const ttsPayload = {
  input: '你好，我是 Claude 娘',
  model: 'tts-1',
  params: { format: 'mp3' as const, speed: 1.2 },
  voice: 'nova',
};

const speech = (usage?: TextToSpeechResponse['usage']): TextToSpeechResponse => ({
  audio: new ArrayBuffer(8),
  format: 'mp3',
  usage,
});

describe('ModelRuntime textToSpeech', () => {
  it('passes payload and options through to the provider and returns its response', async () => {
    const { runtime, mockRuntimeAI } = createMockRuntime();
    const response = speech({ inputCharacters: 13 });
    mockRuntimeAI.textToSpeech.mockResolvedValue(response);

    const options = { user: 'u1' };
    const result = await runtime.textToSpeech(ttsPayload, options);

    expect(mockRuntimeAI.textToSpeech).toHaveBeenCalledWith(ttsPayload, options);
    expect(result).toBe(response);
  });

  it('resolves to undefined when the provider has no textToSpeech', async () => {
    const runtime = new ModelRuntime({} as any);

    await expect(runtime.textToSpeech(ttsPayload)).resolves.toBeUndefined();
  });

  describe('hooks', () => {
    it('passes provider usage to onTextToSpeechFinal after beforeTextToSpeech', async () => {
      const usage = { cost: 0.000_195, inputCharacters: 13 };
      const callerOnUsage = vi.fn();
      const beforeTextToSpeech = vi.fn();
      const onTextToSpeechFinal = vi.fn();
      const { runtime, mockRuntimeAI } = createMockRuntime({
        beforeTextToSpeech,
        onTextToSpeechFinal,
      });
      mockRuntimeAI.textToSpeech.mockImplementation(async (_payload: any, options: any) => {
        await options.onUsage(usage);
        return speech(usage);
      });

      const options = { onUsage: callerOnUsage, user: 'u1' };
      const result = await runtime.textToSpeech(ttsPayload, options);

      expect(result?.usage).toEqual(usage);
      expect(beforeTextToSpeech).toHaveBeenCalledWith(ttsPayload, options);
      expect(beforeTextToSpeech.mock.invocationCallOrder[0]).toBeLessThan(
        mockRuntimeAI.textToSpeech.mock.invocationCallOrder[0],
      );
      // The caller's own onUsage still fires alongside the hook's capture.
      expect(callerOnUsage).toHaveBeenCalledWith(usage);
      expect(onTextToSpeechFinal).toHaveBeenCalledWith(
        { latencyMs: expect.any(Number), usage },
        { options, payload: ttsPayload },
      );
    });

    it('forwards beforeTextToSpeech option mutations to the provider', async () => {
      const pricingContext = { plan: 'premium', scope: 'personal' } as const;
      const beforeTextToSpeech: ModelRuntimeHooks['beforeTextToSpeech'] = async (_p, options) => {
        if (options) options.pricingContext = pricingContext;
      };
      const { runtime, mockRuntimeAI } = createMockRuntime({ beforeTextToSpeech });
      mockRuntimeAI.textToSpeech.mockResolvedValue(speech());

      await runtime.textToSpeech(ttsPayload);

      expect(mockRuntimeAI.textToSpeech.mock.calls[0][1]).toMatchObject({ pricingContext });
    });

    it('still fires onTextToSpeechFinal without usage so reservations can be released', async () => {
      const onTextToSpeechFinal = vi.fn();
      const { runtime, mockRuntimeAI } = createMockRuntime({ onTextToSpeechFinal });
      mockRuntimeAI.textToSpeech.mockResolvedValue(speech());

      await runtime.textToSpeech(ttsPayload);

      expect(onTextToSpeechFinal).toHaveBeenCalledWith(
        { latencyMs: expect.any(Number), usage: undefined },
        { options: undefined, payload: ttsPayload },
      );
    });

    it('calls onTextToSpeechError and re-throws when the provider fails', async () => {
      const providerError = { errorType: 'ProviderBizError', error: { message: 'boom' } };
      const onTextToSpeechError = vi.fn();
      const onTextToSpeechFinal = vi.fn();
      const { runtime, mockRuntimeAI } = createMockRuntime({
        onTextToSpeechError,
        onTextToSpeechFinal,
      });
      mockRuntimeAI.textToSpeech.mockRejectedValue(providerError);

      await expect(runtime.textToSpeech(ttsPayload)).rejects.toBe(providerError);
      expect(onTextToSpeechFinal).not.toHaveBeenCalled();
      expect(onTextToSpeechError).toHaveBeenCalledWith(providerError, {
        options: undefined,
        payload: ttsPayload,
      });
    });

    it('aborts before the provider call when beforeTextToSpeech throws', async () => {
      const budgetError = new Error('insufficient budget');
      const onTextToSpeechError = vi.fn();
      const { runtime, mockRuntimeAI } = createMockRuntime({
        beforeTextToSpeech: vi.fn().mockRejectedValue(budgetError),
        onTextToSpeechError,
      });

      await expect(runtime.textToSpeech(ttsPayload)).rejects.toBe(budgetError);
      expect(mockRuntimeAI.textToSpeech).not.toHaveBeenCalled();
      expect(onTextToSpeechError).toHaveBeenCalledWith(budgetError, {
        options: undefined,
        payload: ttsPayload,
      });
    });

    it('swallows onTextToSpeechFinal failures so the audio is still returned', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { runtime, mockRuntimeAI } = createMockRuntime({
        onTextToSpeechFinal: vi.fn().mockRejectedValue(new Error('settle failed')),
      });
      const response = speech();
      mockRuntimeAI.textToSpeech.mockResolvedValue(response);

      await expect(runtime.textToSpeech(ttsPayload)).resolves.toBe(response);
      expect(consoleError).toHaveBeenCalledWith(
        '[ModelRuntime] onTextToSpeechFinal hook error:',
        expect.any(Error),
      );
      consoleError.mockRestore();
    });
  });
});
