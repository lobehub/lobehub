// @vitest-environment node
import { AgentRuntimeErrorType } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getModelPricing } from '../../utils/getModelPricing';
import {
  buildGmicloudSpeechRequest,
  createGmicloudSpeech,
  extractGmicloudAudioUrl,
  GMICLOUD_MAX_INPUT_CHARACTERS,
  type GmicloudSpeechOptions,
  modelFamily,
  normalizeGmicloudBaseURL,
  resolveGmicloudOutputFormat,
} from './createSpeech';

vi.mock('../../utils/getModelPricing', () => ({ getModelPricing: vi.fn() }));

const options: GmicloudSpeechOptions = {
  apiKey: 'test-key',  baseURL: 'https://console.gmicloud.ai',
  provider: 'gmicloudspeech',
};

const AUDIO_BYTES = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00]);
const QUEUE_URL = 'https://console.gmicloud.ai/api/v1/ie/requestqueue/apikey/requests';

const audioResponse = () => new Response(AUDIO_BYTES, { status: 200 });

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status,
  });

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  vi.mocked(getModelPricing).mockResolvedValue(undefined);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('modelFamily', () => {
  it('maps ids to request families and defaults to inworld', () => {
    expect(modelFamily('inworld-tts-2')).toBe('inworld');
    expect(modelFamily('minimax-tts-speech-2.8-turbo')).toBe('minimax');
    expect(modelFamily('Chatterbox-tts')).toBe('chatterbox');
    expect(modelFamily('some-future-model')).toBe('inworld');
    expect(modelFamily('')).toBe('inworld');
  });
});

describe('normalizeGmicloudBaseURL', () => {
  it('trims trailing slashes and falls back to the console host', () => {
    expect(normalizeGmicloudBaseURL('https://proxy.example/')).toBe('https://proxy.example');
    expect(normalizeGmicloudBaseURL(null)).toBe('https://console.gmicloud.ai');
    expect(normalizeGmicloudBaseURL('')).toBe('https://console.gmicloud.ai');
  });
});

describe('resolveGmicloudOutputFormat', () => {
  it('accepts wav and mp3 and rejects the rest', () => {
    expect(resolveGmicloudOutputFormat('mp3')).toBe('mp3');
    expect(resolveGmicloudOutputFormat('wav')).toBe('wav');
    expect(() => resolveGmicloudOutputFormat('opus')).toThrow('does not support');
  });
});

describe('buildGmicloudSpeechRequest', () => {
  it('builds the Inworld request shape with a string speed', () => {
    const { body, format } = buildGmicloudSpeechRequest(
      { input: 'hello', model: 'inworld-tts-2', speed: 1.5, voice: 'Dennis' },
      'inworld-tts-2',
    );
    expect(format).toBe('mp3');
    expect(body).toEqual({
      model: 'inworld-tts-2',
      payload: {
        audio_encoding: 'MP3',
        speaking_rate: 1.5,
        text: 'hello',
        voice_id: 'Dennis',
      },
    });
  });

  it('builds the MiniMax request shape with speed as a string', () => {
    const { body, format } = buildGmicloudSpeechRequest(
      { input: 'hello', model: 'minimax-tts-speech-2.8-turbo', voice: 'English_expressive_narrator' },
      'minimax-tts-speech-2.8-turbo',
    );
    expect(format).toBe('mp3');
    expect(body).toEqual({
      model: 'minimax-tts-speech-2.8-turbo',
      payload: {
        format: 'mp3',
        speed: '1',
        text: 'hello',
        voice_id: 'English_expressive_narrator',
      },
    });
  });

  it('sends wav when asked', () => {
    const { body, format } = buildGmicloudSpeechRequest(
      { input: 'hello', model: 'inworld-tts-2', params: { format: 'wav' }, voice: 'Dennis' },
      'inworld-tts-2',
    );
    expect(format).toBe('wav');
    expect((body as any).payload.audio_encoding).toBe('WAV');
  });

  it('rejects a Chatterbox model without a voice uuid', () => {
    expect(() =>
      buildGmicloudSpeechRequest(
        { input: 'hello', model: 'Chatterbox-tts', voice: '' },
        'Chatterbox-tts',
      ),
    ).toThrow('Resemble voice UUID');
  });

  it('builds the Chatterbox request shape with a voice uuid', () => {
    const { body } = buildGmicloudSpeechRequest(
      { input: 'hello', model: 'Chatterbox-tts', voice: 'uuid-123' },
      'Chatterbox-tts',
    );
    expect(body).toEqual({
      model: 'Chatterbox-tts',
      payload: { data: 'hello', output_format: 'mp3', voice_uuid: 'uuid-123' },
    });
  });

  it('swaps a filled-in foreign default voice for the family default', () => {
    const { body } = buildGmicloudSpeechRequest(
      { input: 'hello', model: 'inworld-tts-2', voice: 'alloy', voiceIsDefault: true },
      'inworld-tts-2',
    );
    expect((body as any).payload.voice_id).toBe('Dennis');
  });
});

describe('extractGmicloudAudioUrl', () => {
  it('reads the documented outcome shapes', () => {
    expect(extractGmicloudAudioUrl({ outcome: { audio_url: 'u' } })).toBe('u');
    expect(extractGmicloudAudioUrl({ outcome: { media_urls: [{ url: 'v' }] } })).toBe('v');
    expect(extractGmicloudAudioUrl({ outcome: { medias: [{ url: 'w' }] } })).toBe('w');
    expect(extractGmicloudAudioUrl({ outcome: {} })).toBeUndefined();
    expect(extractGmicloudAudioUrl({})).toBeUndefined();
  });
});

describe('createGmicloudSpeech', () => {
  it('resolves a synchronous inline outcome', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ outcome: { audio_url: 'https://a/x.mp3' }, request_id: 'r', status: 'success' }),
      )
      .mockResolvedValueOnce(audioResponse());

    const result = await createGmicloudSpeech(
      { input: 'hello', model: 'inworld-tts-2', voice: 'Dennis' },
      options,
    );

    expect(result.format).toBe('mp3');
    expect(new Uint8Array(result.audio)).toEqual(AUDIO_BYTES);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(QUEUE_URL);
    expect(init.method).toBe('POST');
    expect((init.headers as any).Authorization).toBe('Bearer test-key');
  });

  it('polls a queued generation until it succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ request_id: 'r', status: 'dispatched' }))
      .mockResolvedValueOnce(jsonResponse({ request_id: 'r', status: 'processing' }))
      .mockResolvedValueOnce(
        jsonResponse({ outcome: { audio_url: 'https://a/x.mp3' }, request_id: 'r', status: 'success' }),
      )
      .mockResolvedValueOnce(audioResponse());

    const promise = createGmicloudSpeech(
      { input: 'hello', model: 'minimax-tts-speech-2.8-turbo', voice: 'English_expressive_narrator' },
      options,
    );
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.audio.byteLength).toBe(AUDIO_BYTES.byteLength);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[1][0]).toBe(`${QUEUE_URL}/r`);
  });

  it('keeps polling transient statuses and stops on a permanent one', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ request_id: 'r', status: 'dispatched' }))
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValueOnce(jsonResponse({}, 429))
      .mockResolvedValueOnce(jsonResponse({ error: 'Invalid API key' }, 401));

    const promise = createGmicloudSpeech(
      { input: 'hello', model: 'minimax-tts-speech-2.8-turbo', voice: 'v' },
      options,
    );
    await vi.runAllTimersAsync();

    await expect(promise).rejects.toMatchObject({ errorType: AgentRuntimeErrorType.InvalidProviderAPIKey });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('fails with a readable error when the generation failed', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ request_id: 'r', status: 'failed' }));

    await expect(
      createGmicloudSpeech({ input: 'hello', model: 'inworld-tts-2', voice: 'Dennis' }, options),
    ).rejects.toMatchObject({ errorType: AgentRuntimeErrorType.ProviderBizError });
  });

  it('maps an HTTP error status onto a runtime error type', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'Invalid API key' }, 401));

    await expect(
      createGmicloudSpeech({ input: 'hello', model: 'inworld-tts-2', voice: 'Dennis' }, options),
    ).rejects.toMatchObject({ errorType: AgentRuntimeErrorType.InvalidProviderAPIKey });
  });

  it('rejects an input over the character limit without a request', async () => {
    await expect(
      createGmicloudSpeech(
        { input: 'x'.repeat(GMICLOUD_MAX_INPUT_CHARACTERS + 1), model: 'inworld-tts-2', voice: 'Dennis' },
        options,
      ),
    ).rejects.toMatchObject({
        error: { message: expect.stringContaining('the limit is') },
      });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an unsupported output format without a request', async () => {
    await expect(
      createGmicloudSpeech(
        { input: 'hello', model: 'inworld-tts-2', params: { format: 'flac' }, voice: 'Dennis' },
        options,
      ),
    ).rejects.toMatchObject({
        error: { message: expect.stringContaining('does not support') },
      });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
