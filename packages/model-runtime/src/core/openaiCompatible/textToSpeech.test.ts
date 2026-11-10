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
