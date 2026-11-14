// @vitest-environment node
import type { Pricing } from 'model-bank';
import type OpenAI from 'openai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getModelPricing } from '../../utils/getModelPricing';
import {
  createOpenAICompatibleSpeech,
  type CreateOpenAICompatibleSpeechContext,
} from './textToSpeech';

vi.mock('../../utils/getModelPricing', () => ({ getModelPricing: vi.fn() }));

const characterPricing: Pricing = {
  units: [{ name: 'textInput', rate: 15, strategy: 'fixed', unit: 'millionCharacters' }],
};
const tokenPricing: Pricing = {
  units: [
    { name: 'textInput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
    { name: 'audioOutput', rate: 12, strategy: 'fixed', unit: 'millionTokens' },
  ],
};

const audioResponse = (bytes: number[]) =>
  new Response(new Uint8Array(bytes), { headers: { 'content-type': 'audio/mpeg' } });

const sseResponse = (events: object[]) =>
  new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream' },
  });

const context: CreateOpenAICompatibleSpeechContext = {
  handleError: (error: unknown) => ({ error, errorType: 'ProviderBizError', provider: 'openai' }),
  logPrefix: 'test',
  provider: 'openai',
  requestModel: 'tts-1',
};

describe('createOpenAICompatibleSpeech', () => {
  let create: ReturnType<typeof vi.fn>;
  let client: OpenAI;

  beforeEach(() => {
    create = vi.fn();
    client = { audio: { speech: { create } } } as unknown as OpenAI;
    vi.mocked(getModelPricing).mockResolvedValue(characterPricing);
  });

  it('maps standard params onto /audio/speech and prices by characters', async () => {
    create.mockResolvedValue(audioResponse([1, 2, 3]));
    const onUsage = vi.fn();

    const result = await createOpenAICompatibleSpeech(
      client,
      {
        input: 'hello',
        model: 'tts-1',
        params: { emotion: 'happy', format: 'wav', pitch: 2, speed: 1.25 },
        voice: 'nova',
      },
      { onUsage, user: 'u1' },
      context,
    );

    expect(create).toHaveBeenCalledWith(
      { input: 'hello', model: 'tts-1', response_format: 'wav', speed: 1.25, voice: 'nova' },
      { headers: undefined, signal: undefined },
    );
    expect(new Uint8Array(result.audio)).toEqual(new Uint8Array([1, 2, 3]));
    expect(result.format).toBe('wav');
    // 5 chars × $15/1M rounds up to the smallest credit
    expect(result.usage).toEqual({ cost: 0.000075, inputCharacters: 5 });
    expect(onUsage).toHaveBeenCalledWith(result.usage);
  });

  it('defaults to mp3 and still reads the legacy top-level speed', async () => {
    create.mockResolvedValue(audioResponse([0]));

    const result = await createOpenAICompatibleSpeech(
      client,
      { input: 'hi', model: 'tts-1', speed: 0.5, voice: 'alloy' },
      undefined,
      context,
    );

    expect(create.mock.calls[0][0]).toMatchObject({ response_format: 'mp3', speed: 0.5 });
    expect(result.format).toBe('mp3');
  });

  it('sends the mapped upstream model id', async () => {
    create.mockResolvedValue(audioResponse([0]));

    await createOpenAICompatibleSpeech(
      client,
      { input: 'hi', model: 'tts-1', voice: 'alloy' },
      undefined,
      { ...context, requestModel: 'openai/tts-1' },
    );

    expect(create.mock.calls[0][0].model).toBe('openai/tts-1');
  });

  it('bills a gateway MiniMax speech model by MiniMax characters (a Chinese character is 2)', async () => {
    create.mockResolvedValue(audioResponse([0]));

    const result = await createOpenAICompatibleSpeech(
      client,
      { input: '你好, hi', model: 'speech-2.8-hd', voice: 'female-shaonv' },
      undefined,
      { ...context, provider: 'lobehub', requestModel: 'minimax/speech-2.8-hd' },
    );

    // 2 Han × 2 + ", hi" (4) = 8 billed characters
    expect(result.usage?.inputCharacters).toBe(8);
  });

  it('recognizes a MiniMax speech model by its gateway id alone', async () => {
    create.mockResolvedValue(audioResponse([0]));

    const result = await createOpenAICompatibleSpeech(
      client,
      { input: '你好', model: 'custom-voice', voice: 'female-shaonv' },
      undefined,
      { ...context, requestModel: 'minimax/speech-2.8-turbo' },
    );

    expect(result.usage?.inputCharacters).toBe(4);
  });

  it('leaves a token-billed MiniMax speech model without token counts unpriced', async () => {
    vi.mocked(getModelPricing).mockResolvedValue(tokenPricing);
    create.mockResolvedValue(audioResponse([0]));

    const result = await createOpenAICompatibleSpeech(
      client,
      { input: '你好', model: 'speech-2.8-hd', voice: 'female-shaonv' },
      undefined,
      { ...context, requestModel: 'minimax/speech-2.8-hd' },
    );

    expect(result.usage).toEqual({ inputCharacters: 2 });
  });

  it('omits the Fish Audio default voice and bills a gateway Fish model by UTF-8 bytes', async () => {
    create.mockResolvedValue(audioResponse([0]));

    const result = await createOpenAICompatibleSpeech(
      client,
      { input: '你好, hi', model: 's2.1-pro', params: { speed: 1.2 }, voice: 'default' },
      undefined,
      { ...context, provider: 'lobehub', requestModel: 'fish-audio/s2.1-pro' },
    );

    expect(create).toHaveBeenCalledWith(
      { input: '你好, hi', model: 'fish-audio/s2.1-pro', response_format: 'mp3', speed: 1.2 },
      { headers: undefined, signal: undefined },
    );
    // 2 Han × 3 bytes + ", hi" (4) = 10 billed bytes; 10 × $15/1M
    expect(result.usage).toEqual({ cost: 0.00015, inputCharacters: 10 });
  });

  it('sends a Fish Audio reference voice and recognizes Fish by its gateway id alone', async () => {
    create.mockResolvedValue(audioResponse([0]));
    const voice = '0123456789abcdef0123456789abcdef';

    const result = await createOpenAICompatibleSpeech(
      client,
      { input: '语音', model: 'custom-fish', voice },
      undefined,
      { ...context, requestModel: 'fish-audio/drama-3' },
    );

    expect(create.mock.calls[0][0]).toMatchObject({ model: 'fish-audio/drama-3', voice });
    expect(result.usage?.inputCharacters).toBe(6);
  });

  it('bills the instructions a gateway writes in front of a Fish Audio input', async () => {
    create.mockResolvedValue(audioResponse([0]));

    const result = await createOpenAICompatibleSpeech(
      client,
      { input: '你好', model: 's2.1-pro', params: { instructions: 'whisper' }, voice: 'default' },
      undefined,
      { ...context, requestModel: 'fish-audio/s2.1-pro' },
    );

    expect(create.mock.calls[0][0]).toMatchObject({ instructions: 'whisper' });
    // "[whisper] " (10) + 2 Han × 3 bytes = 16 billed bytes
    expect(result.usage?.inputCharacters).toBe(16);
  });

  it("treats a bare Fish-like id on a custom provider as that provider's own model", async () => {
    create.mockResolvedValue(audioResponse([0]));

    const result = await createOpenAICompatibleSpeech(
      client,
      { input: 'a'.repeat(5000) + '你好', model: 's1', voice: 'default' },
      undefined,
      { ...context, provider: 'my-custom-tts', requestModel: 's1' },
    );

    // No Fish cap, the caller's voice is kept, and usage counts code points, not bytes.
    expect(create.mock.calls[0][0]).toMatchObject({ model: 's1', voice: 'default' });
    expect(result.usage?.inputCharacters).toBe(5002);
  });

  it('prices a qualified gateway Fish id by the Fish Audio catalog card', async () => {
    create.mockResolvedValue(audioResponse([0]));
    vi.mocked(getModelPricing).mockImplementation(async (model, provider) =>
      model === 's2.1-pro' && provider === 'fishaudio' ? characterPricing : undefined,
    );

    const result = await createOpenAICompatibleSpeech(
      client,
      { input: 'hi', model: 'fish-audio/s2.1-pro', voice: 'default' },
      undefined,
      { ...context, provider: 'openrouter', requestModel: 'fish-audio/s2.1-pro' },
    );

    expect(getModelPricing).toHaveBeenCalledWith('fish-audio/s2.1-pro', 'openrouter', undefined);
    expect(getModelPricing).toHaveBeenCalledWith('s2.1-pro', 'fishaudio', undefined);
    // 2 bytes × $15/1M
    expect(result.usage).toEqual({ cost: 0.00003, inputCharacters: 2 });
  });

  it('prices an alias mapped to a Fish route by the mapped model card', async () => {
    create.mockResolvedValue(audioResponse([0]));
    vi.mocked(getModelPricing).mockImplementation(async (model, provider) =>
      model === 'drama-3' && provider === 'fishaudio' ? characterPricing : undefined,
    );

    const result = await createOpenAICompatibleSpeech(
      client,
      { input: 'hi', model: 'custom-fish', voice: 'default' },
      undefined,
      { ...context, provider: 'my-gateway', requestModel: 'fish-audio/drama-3' },
    );

    expect(getModelPricing).toHaveBeenCalledWith('drama-3', 'fishaudio', undefined);
    expect(result.usage).toEqual({ cost: 0.00003, inputCharacters: 2 });
  });

  it('validates gateway Fish params against the Fish catalog card before the request', async () => {
    await expect(
      createOpenAICompatibleSpeech(
        client,
        {
          input: 'Hi',
          model: 'fish-audio/s1',
          params: { instructions: 'whisper' },
          voice: 'default',
        },
        undefined,
        { ...context, provider: 'openrouter', requestModel: 'fish-audio/s1' },
      ),
    ).rejects.toMatchObject({
      error: { message: expect.stringContaining('params.instructions') },
      errorType: 'ProviderBizError',
      provider: 'openrouter',
    });

    await expect(
      createOpenAICompatibleSpeech(
        client,
        { input: 'Hi', model: 'custom-fish', params: { speed: 3 }, voice: 'default' },
        undefined,
        { ...context, provider: 'my-gateway', requestModel: 'fish-audio/s2.1-pro' },
      ),
    ).rejects.toMatchObject({ error: { message: expect.stringContaining('params.speed') } });
    expect(create).not.toHaveBeenCalled();

    // `/audio/speech` cannot carry a sample rate, so a gateway Fish route refuses it.
    await expect(
      createOpenAICompatibleSpeech(
        client,
        {
          input: 'Hi',
          model: 'fish-audio/s2.1-pro',
          params: { sampleRate: 44_100 },
          voice: 'default',
        },
        undefined,
        { ...context, provider: 'openrouter', requestModel: 'fish-audio/s2.1-pro' },
      ),
    ).rejects.toMatchObject({ error: { message: expect.stringContaining('params.sampleRate') } });
    expect(create).not.toHaveBeenCalled();

    // s2.1-pro-free follows the S2.1 Pro schema, and a refused sample rate is a clean error.
    for (const params of [{ speed: 3 }, { sampleRate: 44_100 }]) {
      await expect(
        createOpenAICompatibleSpeech(
          client,
          { input: 'Hi', model: 'fish-audio/s2.1-pro-free', params, voice: 'default' },
          undefined,
          { ...context, provider: 'openrouter', requestModel: 'fish-audio/s2.1-pro-free' },
        ),
      ).rejects.toMatchObject({
        error: { message: expect.stringContaining('Fish Audio s2.1-pro-free: params.') },
        errorType: 'ProviderBizError',
      });
    }
    expect(create).not.toHaveBeenCalled();

    // The directed S2 family accepts instructions through the gateway.
    create.mockResolvedValue(audioResponse([0]));
    await createOpenAICompatibleSpeech(
      client,
      {
        input: 'Hi',
        model: 'fish-audio/s2.1-pro',
        params: { instructions: 'calm' },
        voice: 'default',
      },
      undefined,
      { ...context, provider: 'openrouter', requestModel: 'fish-audio/s2.1-pro' },
    );
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('refuses a gateway Fish Audio input over the per-request cap before the request', async () => {
    await expect(
      createOpenAICompatibleSpeech(
        client,
        { input: 'a'.repeat(4097), model: 'fish-audio/s2.1-pro', voice: 'default' },
        undefined,
        { ...context, provider: 'openrouter', requestModel: 'fish-audio/s2.1-pro' },
      ),
    ).rejects.toMatchObject({
      error: { message: expect.stringContaining('the limit is 4096 per request') },
      errorType: 'ProviderBizError',
      provider: 'openrouter',
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('lets a gateway Fish Audio input at the cap through', async () => {
    create.mockResolvedValue(audioResponse([0]));

    await createOpenAICompatibleSpeech(
      client,
      { input: 'a'.repeat(4096), model: 'fish-audio/s2.1-pro', voice: 'default' },
      undefined,
      { ...context, requestModel: 'fish-audio/s2.1-pro' },
    );

    expect(create).toHaveBeenCalledTimes(1);
  });

  it('omits a service fallback voice for a fully qualified gateway Fish model', async () => {
    create.mockResolvedValue(audioResponse([0]));

    await createOpenAICompatibleSpeech(
      client,
      { input: 'hi', model: 'fish-audio/s2.1-pro', voice: 'alloy', voiceIsDefault: true },
      undefined,
      { ...context, provider: 'openrouter', requestModel: 'fish-audio/s2.1-pro' },
    );

    expect(create.mock.calls[0][0]).not.toHaveProperty('voice');
  });

  it('keeps a fallback voice for non-Fish models', async () => {
    create.mockResolvedValue(audioResponse([0]));

    await createOpenAICompatibleSpeech(
      client,
      { input: 'hi', model: 'tts-1', voice: 'alloy', voiceIsDefault: true },
      undefined,
      context,
    );

    expect(create.mock.calls[0][0]).toMatchObject({ voice: 'alloy' });
  });

  it('keeps a voice named "default" for non-Fish models', async () => {
    create.mockResolvedValue(audioResponse([0]));

    await createOpenAICompatibleSpeech(
      client,
      { input: 'hi', model: 'tts-1', voice: 'default' },
      undefined,
      context,
    );

    expect(create.mock.calls[0][0]).toMatchObject({ voice: 'default' });
  });

  it('keeps counting code points for non-MiniMax models', async () => {
    create.mockResolvedValue(audioResponse([0]));

    const result = await createOpenAICompatibleSpeech(
      client,
      { input: '你好', model: 'tts-1', voice: 'alloy' },
      undefined,
      context,
    );

    expect(result.usage?.inputCharacters).toBe(2);
  });

  it('requests SSE for token-billed models and reads audio and token usage from events', async () => {
    vi.mocked(getModelPricing).mockResolvedValue(tokenPricing);
    create.mockResolvedValue(
      sseResponse([
        { audio: Buffer.from([1, 2]).toString('base64'), type: 'speech.audio.delta' },
        { audio: Buffer.from([3]).toString('base64'), type: 'speech.audio.delta' },
        {
          type: 'speech.audio.done',
          usage: { input_tokens: 1000, output_tokens: 10_000, total_tokens: 11_000 },
        },
      ]),
    );

    const result = await createOpenAICompatibleSpeech(
      client,
      {
        input: 'hello',
        model: 'gpt-4o-mini-tts',
        params: { instructions: 'Speak cheerfully' },
        voice: 'marin',
      },
      undefined,
      { ...context, requestModel: 'gpt-4o-mini-tts' },
    );

    expect(create.mock.calls[0][0]).toEqual({
      input: 'hello',
      instructions: 'Speak cheerfully',
      model: 'gpt-4o-mini-tts',
      response_format: 'mp3',
      stream_format: 'sse',
      voice: 'marin',
    });
    expect(new Uint8Array(result.audio)).toEqual(new Uint8Array([1, 2, 3]));
    expect(result.usage).toMatchObject({
      cost: 0.1206,
      inputCharacters: 5,
      inputTextTokens: 1000,
      outputAudioTokens: 10_000,
    });
  });

  it.each([
    [
      'ends without audio',
      [{ type: 'speech.audio.done', usage: { input_tokens: 1, output_tokens: 1 } }],
    ],
    ['carries an error event', [{ error: { message: 'quota' }, type: 'error' }]],
    [
      'closes before speech.audio.done',
      [{ audio: Buffer.from([1]).toString('base64'), type: 'speech.audio.delta' }],
    ],
  ])('fails instead of reporting usage when the SSE stream %s', async (_label, events) => {
    vi.mocked(getModelPricing).mockResolvedValue(tokenPricing);
    create.mockResolvedValue(sseResponse(events));
    const onUsage = vi.fn();

    await expect(
      createOpenAICompatibleSpeech(
        client,
        { input: 'hello', model: 'gpt-4o-mini-tts', voice: 'alloy' },
        { onUsage },
        context,
      ),
    ).rejects.toMatchObject({ errorType: 'ProviderBizError' });
    expect(onUsage).not.toHaveBeenCalled();
  });

  it('falls back to the raw body when a gateway ignores stream_format', async () => {
    vi.mocked(getModelPricing).mockResolvedValue(tokenPricing);
    create.mockResolvedValue(audioResponse([9, 9]));

    const result = await createOpenAICompatibleSpeech(
      client,
      { input: 'hello', model: 'gpt-4o-mini-tts', voice: 'alloy' },
      undefined,
      context,
    );

    expect(new Uint8Array(result.audio)).toEqual(new Uint8Array([9, 9]));
    // No token counts: cost stays unset instead of pricing to 0
    expect(result.usage).toEqual({ inputCharacters: 5 });
  });

  it('normalizes provider errors through handleError and reports no usage', async () => {
    const upstream = Object.assign(new Error('bad voice'), { status: 400 });
    create.mockRejectedValue(upstream);
    const onUsage = vi.fn();

    await expect(
      createOpenAICompatibleSpeech(
        client,
        { input: 'hi', model: 'tts-1', voice: 'nope' },
        { onUsage },
        context,
      ),
    ).rejects.toEqual({ error: upstream, errorType: 'ProviderBizError', provider: 'openai' });
    expect(onUsage).not.toHaveBeenCalled();
  });
});
