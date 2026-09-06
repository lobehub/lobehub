// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CreateSpeechOptions } from '../../core/openaiCompatibleFactory';
import type { TextToSpeechPayload } from '../../types/tts';
import { createMiniMaxSpeech, resolveMiniMaxSpeechEndpoint } from './createSpeech';

const mockOptions: CreateSpeechOptions = {
  apiKey: 'test-api-key',
  baseURL: 'https://api.minimaxi.com/v1',
  provider: 'minimax',
};

const payload: TextToSpeechPayload = {
  input: 'hello world',
  model: 'speech-2.8-hd',
  voice: 'test-voice',
};

// 'ok' encoded as hex
const audioHex = '6f6b';

const mockJsonResponse = (body: unknown) => {
  global.fetch = vi.fn().mockResolvedValueOnce({
    json: async () => body,
    ok: true,
  });
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('resolveMiniMaxSpeechEndpoint', () => {
  it.each([
    ['https://api.minimaxi.com/v1', 'https://api.minimaxi.com/v1/t2a_v2'],
    ['https://api.minimax.io/v1', 'https://api.minimax.io/v1/t2a_v2'],
    ['https://api.minimax.io/anthropic', 'https://api.minimax.io/v1/t2a_v2'],
    ['https://api.minimax.io/anthropic/v1/messages', 'https://api.minimax.io/v1/t2a_v2'],
    ['https://proxy.example.com/minimax/v1/', 'https://proxy.example.com/minimax/v1/t2a_v2'],
  ])('resolves %s to %s', (baseURL, expected) => {
    expect(resolveMiniMaxSpeechEndpoint(baseURL)).toBe(expected);
  });

  it('falls back to the default regional endpoint', () => {
    expect(resolveMiniMaxSpeechEndpoint()).toBe('https://api.minimaxi.com/v1/t2a_v2');
  });
});

describe('createMiniMaxSpeech', () => {
  it('sends the text to audio request and decodes the hex audio', async () => {
    mockJsonResponse({
      base_resp: { status_code: 0, status_msg: 'success' },
      data: { audio: audioHex, status: 2 },
    });

    const result = await createMiniMaxSpeech(payload, mockOptions);

    expect(fetch).toHaveBeenCalledWith('https://api.minimaxi.com/v1/t2a_v2', {
      body: JSON.stringify({
        audio_setting: { format: 'mp3' },
        model: 'speech-2.8-hd',
        output_format: 'hex',
        text: 'hello world',
        voice_setting: { voice_id: 'test-voice' },
      }),
      headers: {
        'Authorization': 'Bearer test-api-key',
        'Content-Type': 'application/json',
      },
      method: 'POST',
      signal: undefined,
    });
    expect(Buffer.from(result).toString()).toBe('ok');
  });

  it('forwards the requested audio format and speed', async () => {
    mockJsonResponse({
      base_resp: { status_code: 0, status_msg: 'success' },
      data: { audio: audioHex, status: 2 },
    });

    await createMiniMaxSpeech(
      { ...payload, response_format: 'flac', speed: 1.5 } as TextToSpeechPayload,
      mockOptions,
    );

    const body = JSON.parse((fetch as any).mock.calls[0][1].body);

    expect(body.audio_setting).toEqual({ format: 'flac' });
    expect(body.voice_setting).toEqual({ speed: 1.5, voice_id: 'test-voice' });
  });

  it('ignores an audio format the speech endpoint does not support', async () => {
    mockJsonResponse({
      base_resp: { status_code: 0, status_msg: 'success' },
      data: { audio: audioHex },
    });

    await createMiniMaxSpeech(
      { ...payload, response_format: 'aac' } as TextToSpeechPayload,
      mockOptions,
    );

    const body = JSON.parse((fetch as any).mock.calls[0][1].body);

    expect(body.audio_setting).toEqual({ format: 'mp3' });
  });

  it('applies the model id mapping', async () => {
    mockJsonResponse({
      base_resp: { status_code: 0, status_msg: 'success' },
      data: { audio: audioHex },
    });

    await createMiniMaxSpeech(payload, {
      ...mockOptions,
      modelIdMapping: { 'speech-2.8-hd': 'mapped-speech-model' },
    });

    const body = JSON.parse((fetch as any).mock.calls[0][1].body);

    expect(body.model).toBe('mapped-speech-model');
  });

  it('forwards per-request headers and the abort signal', async () => {
    mockJsonResponse({
      base_resp: { status_code: 0, status_msg: 'success' },
      data: { audio: audioHex },
    });

    const signal = new AbortController().signal;

    await createMiniMaxSpeech(payload, mockOptions, { headers: { 'X-Trace': 'trace-1' }, signal });

    const requestInit = (fetch as any).mock.calls[0][1];

    expect(requestInit.headers['X-Trace']).toBe('trace-1');
    expect(requestInit.signal).toBe(signal);
  });

  it('throws when the HTTP request fails', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => 'invalid api key',
    });

    await expect(createMiniMaxSpeech(payload, mockOptions)).rejects.toThrow(
      'MiniMax API error (401): invalid api key',
    );
  });

  it('throws when the response reports a business error', async () => {
    mockJsonResponse({
      base_resp: { status_code: 1004, status_msg: 'authentication failed' },
      data: null,
    });

    await expect(createMiniMaxSpeech(payload, mockOptions)).rejects.toThrow(
      'MiniMax API error: authentication failed',
    );
  });

  it('throws when the response carries no audio', async () => {
    mockJsonResponse({ base_resp: { status_code: 0, status_msg: 'success' }, data: {} });

    await expect(createMiniMaxSpeech(payload, mockOptions)).rejects.toThrow(
      'No audio data in text to audio response',
    );
  });

  it('throws when the audio payload is not valid hex', async () => {
    mockJsonResponse({
      base_resp: { status_code: 0, status_msg: 'success' },
      data: { audio: 'not-hex' },
    });

    await expect(createMiniMaxSpeech(payload, mockOptions)).rejects.toThrow(
      'MiniMax returned a malformed hex audio payload',
    );
  });
});
