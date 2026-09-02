// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CreateVideoPayload } from '../../types/video';
import { createWaveSpeedVideo, parseInferenceId, pollWaveSpeedVideoStatus } from './createVideo';

global.fetch = vi.fn();
const mockFetch = vi.mocked(fetch);

const options = { apiKey: 'test-api-key', provider: 'wavespeed' };

const jsonResponse = (body: unknown, init?: { ok?: boolean; status?: number }) =>
  ({
    json: async () => body,
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    statusText: 'Error',
  }) as Response;

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.clearAllMocks());

describe('createWaveSpeedVideo', () => {
  it('should submit the mapped body and return a model-qualified inference id', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ code: 200, data: { id: 'pred-1' } }));

    const payload: CreateVideoPayload = {
      model: 'bytedance/seedance-2.5/text-to-video',
      params: {
        aspectRatio: '16:9',
        duration: 5,
        generateAudio: true,
        prompt: 'a dog surfing',
      } as any,
    };

    await expect(createWaveSpeedVideo(payload, options)).resolves.toEqual({
      inferenceId: 'bytedance/seedance-2.5/text-to-video::pred-1',
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.wavespeed.ai/api/v3/bytedance/seedance-2.5/text-to-video',
      expect.objectContaining({
        body: JSON.stringify({
          aspect_ratio: '16:9',
          duration: 5,
          generate_audio: true,
          prompt: 'a dog surfing',
        }),
        method: 'POST',
      }),
    );
  });

  it('should submit exactly once and never retry', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ message: 'boom' }, { ok: false, status: 500 }));

    await expect(
      createWaveSpeedVideo({ model: 'm', params: { prompt: 'x' } as any }, options),
    ).rejects.toMatchObject({ errorType: 'ProviderBizError' });

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('should surface an invalid API key', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ message: 'nope' }, { ok: false, status: 401 }));

    await expect(
      createWaveSpeedVideo({ model: 'm', params: { prompt: 'x' } as any }, options),
    ).rejects.toMatchObject({ errorType: 'InvalidProviderAPIKey' });
  });
});

describe('parseInferenceId', () => {
  it('should split the model prefix from the prediction id', () => {
    expect(parseInferenceId('alibaba/wan-2.6/text-to-video::pred-9')).toEqual({
      id: 'pred-9',
      model: 'alibaba/wan-2.6/text-to-video',
    });
  });

  it('should treat an unprefixed value as a bare prediction id', () => {
    expect(parseInferenceId('pred-9')).toEqual({ id: 'pred-9', model: undefined });
  });
});

describe('pollWaveSpeedVideoStatus', () => {
  it('should poll the prediction id, ignoring the model prefix', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        code: 200,
        data: { id: 'pred-1', outputs: ['https://cdn/v.mp4'], status: 'completed' },
      }),
    );

    await expect(pollWaveSpeedVideoStatus('some/model::pred-1', options)).resolves.toEqual({
      status: 'success',
      videoUrl: 'https://cdn/v.mp4',
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.wavespeed.ai/api/v3/predictions/pred-1/result',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it.each(['created', 'processing'])('should report %s as pending', async (status) => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ code: 200, data: { id: 'pred-1', status } }));

    await expect(pollWaveSpeedVideoStatus('pred-1', options)).resolves.toEqual({
      status: 'pending',
    });
  });

  it.each(['failed', 'cancelled', 'timeout'])('should report %s as failed', async (status) => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ code: 200, data: { error: 'moderation', id: 'pred-1', status } }),
    );

    const result = await pollWaveSpeedVideoStatus('pred-1', options);

    expect(result.status).toBe('failed');
    expect((result as { error: string }).error).toContain('moderation');
  });

  it('should fail when a completed prediction has no output', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ code: 200, data: { id: 'pred-1', outputs: [], status: 'completed' } }),
    );

    expect((await pollWaveSpeedVideoStatus('pred-1', options)).status).toBe('failed');
  });
});
