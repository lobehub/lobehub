// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LobeDeAPIAI, params } from './index';

vi.mock('debug', () => ({
  default: vi.fn(() => vi.fn()),
}));

const BASE_URL = 'https://oai.deapi.ai/v1';

describe('LobeDeAPIAI', () => {
  let instance: InstanceType<typeof LobeDeAPIAI>;

  beforeEach(() => {
    instance = new LobeDeAPIAI({ apiKey: 'test_api_key' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should target the deAPI OpenAI-compatible gateway', () => {
    expect(params.provider).toBe(ModelProvider.DeAPI);
    expect(instance.baseURL).toBe(BASE_URL);
  });

  describe('createImage', () => {
    it('should send the selected size and quality to images/generations', async () => {
      const generate = vi
        .spyOn(instance['client'].images, 'generate')
        .mockResolvedValue({ created: 1, data: [{ url: 'https://results.deapi.ai/1/a.png' }] });

      const result = await instance.createImage({
        model: 'Flux1schnell',
        params: { prompt: 'a red fox in snow', quality: 'low', size: '512x512' },
      });

      expect(generate).toHaveBeenCalledWith({
        model: 'Flux1schnell',
        prompt: 'a red fox in snow',
        quality: 'low',
        size: '512x512',
      });
      expect(result).toEqual({ imageUrl: 'https://results.deapi.ai/1/a.png' });
    });

    it('should return base64 output as a PNG data URL', async () => {
      vi.spyOn(instance['client'].images, 'generate').mockResolvedValue({
        created: 1,
        data: [{ b64_json: 'iVBORw0KGgo' }],
      });

      const result = await instance.createImage({
        model: 'ZImageTurbo_INT8',
        params: { prompt: 'a lighthouse' },
      });

      expect(result.imageUrl).toBe('data:image/png;base64,iVBORw0KGgo');
    });
  });

  describe('createVideo', () => {
    it('should create a job on /videos with Sora-style seconds and size', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        json: async () => ({ id: 'job-1', status: 'queued' }),
        ok: true,
      });
      vi.stubGlobal('fetch', fetchMock);

      const result = await instance.createVideo({
        model: 'Ltxv_13B_0_9_8_Distilled_FP8',
        params: {
          duration: 2,
          imageUrl: 'https://example.com/first-frame.png',
          prompt: 'a paper boat on a rainy street',
          size: '768x512',
        },
      });

      expect(result).toEqual({ inferenceId: 'job-1' });
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(`${BASE_URL}/videos`);
      expect(init.headers.Authorization).toBe('Bearer test_api_key');
      expect(JSON.parse(init.body)).toEqual({
        input_reference: { image_url: 'https://example.com/first-frame.png' },
        model: 'Ltxv_13B_0_9_8_Distilled_FP8',
        prompt: 'a paper boat on a rainy street',
        seconds: '2',
        size: '768x512',
      });

      vi.unstubAllGlobals();
    });

    it('should download a finished video from the key-gated content endpoint', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          json: async () => ({ id: 'job-1', progress: 100, status: 'completed' }),
          ok: true,
        }),
      );

      const result = await instance.handlePollVideoStatus('job-1');

      expect(result).toEqual({
        headers: { Authorization: 'Bearer test_api_key' },
        status: 'success',
        videoUrl: `${BASE_URL}/videos/job-1/content`,
      });

      vi.unstubAllGlobals();
    });

    it('should surface the job error when rendering fails', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          json: async () => ({
            error: { code: 'job_failed', message: 'Job failed during rendering.' },
            id: 'job-1',
            status: 'failed',
          }),
          ok: true,
        }),
      );

      const result = await instance.handlePollVideoStatus('job-1');

      expect(result).toEqual({ error: 'Job failed during rendering.', status: 'failed' });

      vi.unstubAllGlobals();
    });
  });
});
