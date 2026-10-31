import { RequestTrigger } from '@lobechat/types';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TextToSpeechOptions, TextToSpeechPayload, TextToSpeechResponse } from '../../types';
import type { LobeRuntimeAI } from '../BaseAI';
import { createRouterRuntime } from './createRuntime';

const payload: TextToSpeechPayload = {
  input: '你好',
  model: 'tts-1',
  params: { format: 'wav', speed: 1.1 },
  voice: 'nova',
};

describe('createRouterRuntime textToSpeech', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('returns the routed response with format and usage, and forwards onUsage', async () => {
    const usage = { cost: 0.00003, inputCharacters: 2 };
    const textToSpeech = vi.fn(
      async (_payload: TextToSpeechPayload, options?: TextToSpeechOptions) => {
        await options?.onUsage?.(usage);
        return { audio: new ArrayBuffer(4), format: 'wav', usage } as TextToSpeechResponse;
      },
    );

    class MockRuntime implements LobeRuntimeAI {
      textToSpeech = textToSpeech;
    }

    const Runtime = createRouterRuntime({
      id: 'test-runtime',
      routers: [{ apiType: 'openai', models: ['tts-1'], options: {}, runtime: MockRuntime as any }],
    });

    const onUsage = vi.fn();
    const options = { metadata: { trigger: RequestTrigger.Tts }, onUsage };
    const result = await new Runtime().textToSpeech(payload, options);

    expect(textToSpeech).toHaveBeenCalledWith(payload, options);
    expect(result).toMatchObject({ format: 'wav', usage });
    expect(onUsage).toHaveBeenCalledWith(usage);
  });
});
