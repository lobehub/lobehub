// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CreateImagePayload } from '../../types/image';
import type { TaskResult } from '../../utils/asyncifyPolling';
import { createWaveSpeedImage } from './createImage';

vi.mock('../../utils/asyncifyPolling', () => ({ asyncifyPolling: vi.fn() }));

global.fetch = vi.fn();
const mockFetch = vi.mocked(fetch);

const options = { apiKey: 'test-api-key', provider: 'wavespeed' };

const submitOk = (id = 'pred-1') =>
  mockFetch.mockResolvedValueOnce({
    json: async () => ({ code: 200, data: { id } }),
    ok: true,
    status: 200,
  } as Response);

/** Run the `checkStatus` callback the implementation handed to asyncifyPolling. */
const captureCheckStatus = async () => {
  const { asyncifyPolling } = await import('../../utils/asyncifyPolling');
  const call = vi.mocked(asyncifyPolling).mock.calls.at(-1)?.[0];
  return call!.checkStatus as (r: any) => TaskResult<{ imageUrl: string }>;
};

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.clearAllMocks());

describe('createWaveSpeedImage', () => {
  it('should submit the mapped body and return the generated image url', async () => {
    const { asyncifyPolling } = await import('../../utils/asyncifyPolling');
    vi.mocked(asyncifyPolling).mockResolvedValue({ imageUrl: 'https://cdn/img.png' });
    submitOk();

    const payload: CreateImagePayload = {
      model: 'bytedance/seedream-v5.0-pro',
      params: { aspectRatio: '16:9', prompt: 'a cat', resolution: '2k' } as any,
    };

    await expect(createWaveSpeedImage(payload, options)).resolves.toEqual({
      imageUrl: 'https://cdn/img.png',
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.wavespeed.ai/api/v3/bytedance/seedream-v5.0-pro',
      expect.objectContaining({
        body: JSON.stringify({ aspect_ratio: '16:9', prompt: 'a cat', resolution: '2k' }),
        method: 'POST',
      }),
    );
  });

  it('should submit exactly once', async () => {
    const { asyncifyPolling } = await import('../../utils/asyncifyPolling');
    vi.mocked(asyncifyPolling).mockResolvedValue({ imageUrl: 'https://cdn/img.png' });
    submitOk();

    await createWaveSpeedImage({ model: 'm', params: { prompt: 'x' } as any }, options);

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  describe('status handling', () => {
    beforeEach(async () => {
      const { asyncifyPolling } = await import('../../utils/asyncifyPolling');
      vi.mocked(asyncifyPolling).mockResolvedValue({ imageUrl: 'x' });
      submitOk();
      await createWaveSpeedImage({ model: 'm', params: { prompt: 'x' } as any }, options);
    });

    it.each(['created', 'processing'])('should keep polling while %s', async (status) => {
      const checkStatus = await captureCheckStatus();
      expect(checkStatus({ data: { status } })).toEqual({ status: 'pending' });
    });

    it('should resolve with the first output on completion', async () => {
      const checkStatus = await captureCheckStatus();
      expect(
        checkStatus({ data: { outputs: ['https://cdn/a.png'], status: 'completed' } }),
      ).toEqual({ data: { imageUrl: 'https://cdn/a.png' }, status: 'success' });
    });

    it('should fail when a completed prediction has no output', async () => {
      const checkStatus = await captureCheckStatus();
      expect(checkStatus({ data: { outputs: [], status: 'completed' } }).status).toBe('failed');
    });

    it.each(['failed', 'cancelled', 'timeout'])('should fail on %s', async (status) => {
      const checkStatus = await captureCheckStatus();
      const result = checkStatus({ data: { error: 'nsfw', id: 'pred-1', status } });

      expect(result.status).toBe('failed');
      expect(result.error.message).toContain(status);
      expect(result.error.message).toContain('nsfw');
    });
  });

  it('should surface an invalid API key', async () => {
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ message: 'unauthorized' }),
      ok: false,
      status: 401,
    } as Response);

    await expect(
      createWaveSpeedImage({ model: 'm', params: { prompt: 'x' } as any }, options),
    ).rejects.toMatchObject({ errorType: 'InvalidProviderAPIKey' });
  });

  it('should wrap other failures as a provider business error', async () => {
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ message: 'bad request' }),
      ok: false,
      status: 400,
    } as Response);

    await expect(
      createWaveSpeedImage({ model: 'm', params: { prompt: 'x' } as any }, options),
    ).rejects.toMatchObject({ errorType: 'ProviderBizError' });
  });
});
