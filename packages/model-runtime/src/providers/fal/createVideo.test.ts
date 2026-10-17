// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildFalVideoRequest, parseFalVideoInferenceId } from './createVideo';
import { LobeFalAI } from './index';

const { queue } = vi.hoisted(() => ({
  queue: { result: vi.fn(), status: vi.fn(), submit: vi.fn() },
}));

vi.mock('@fal-ai/client', () => ({
  createFalClient: vi.fn(() => ({ queue })),
  fal: { config: vi.fn(), subscribe: vi.fn() },
}));

const MODEL = 'minimax/h3-max';

describe('buildFalVideoRequest', () => {
  it('routes prompt-only requests to text-to-video', () => {
    expect(
      buildFalVideoRequest(MODEL, {
        aspectRatio: '9:16',
        duration: 10,
        prompt: 'a cat',
        promptExtend: 'quality',
        resolution: '1080P',
        seed: 7,
      }),
    ).toEqual({
      endpoint: 'minimax/h3-max/text-to-video',
      input: {
        aspect_ratio: '9:16',
        duration: 10,
        enable_safety_checker: false,
        prompt: 'a cat',
        prompt_expansion_mode: 'quality',
        resolution: '1080P',
        seed: 7,
      },
    });
  });

  it('routes first/last frames to image-to-video without an aspect ratio', () => {
    const { endpoint, input } = buildFalVideoRequest(MODEL, {
      aspectRatio: '16:9',
      endImageUrl: 'https://img/last.png',
      imageUrl: 'https://img/first.png',
      prompt: 'morph',
    });

    expect(endpoint).toBe('minimax/h3-max/image-to-video');
    expect(input).toMatchObject({
      end_image_url: 'https://img/last.png',
      image_url: 'https://img/first.png',
      prompt_expansion_mode: 'balanced',
    });
    // The output follows the first frame's aspect ratio; the endpoint takes none.
    expect(input).not.toHaveProperty('aspect_ratio');
  });

  it('routes a last frame alone to image-to-video', () => {
    expect(
      buildFalVideoRequest(MODEL, { endImageUrl: 'https://img/last.png', prompt: 'p' }).endpoint,
    ).toBe('minimax/h3-max/image-to-video');
  });

  it('routes reference images to reference-to-video and folds frames into the pool', () => {
    const { endpoint, input } = buildFalVideoRequest(MODEL, {
      aspectRatio: '1:1',
      endImageUrl: 'https://img/last.png',
      imageUrl: 'https://img/first.png',
      imageUrls: ['https://img/a.png', 'https://img/b.png'],
      prompt: 'Image 1 walks with Image 2',
    });

    expect(endpoint).toBe('minimax/h3-max/reference-to-video');
    expect(input).toMatchObject({
      aspect_ratio: '1:1',
      reference_image_urls: [
        'https://img/first.png',
        'https://img/a.png',
        'https://img/b.png',
        'https://img/last.png',
      ],
    });
    expect(input).not.toHaveProperty('image_url');
    expect(input).not.toHaveProperty('end_image_url');
  });

  it('keeps a last frame as a reference when reference images are present', () => {
    const { endpoint, input } = buildFalVideoRequest(MODEL, {
      endImageUrl: 'https://img/last.png',
      imageUrls: ['https://img/a.png'],
      prompt: 'p',
    });

    expect(endpoint).toBe('minimax/h3-max/reference-to-video');
    expect(input.reference_image_urls).toEqual(['https://img/a.png', 'https://img/last.png']);
  });

  describe('Seedance 2.5', () => {
    const SEEDANCE = 'bytedance/seedance-2.5';

    it('sends audio and a string duration without H3-only fields', () => {
      expect(
        buildFalVideoRequest(SEEDANCE, {
          aspectRatio: '21:9',
          duration: 12,
          generateAudio: false,
          prompt: 'a kite',
          resolution: '480p',
        }),
      ).toEqual({
        endpoint: 'bytedance/seedance-2.5/text-to-video',
        input: {
          aspect_ratio: '21:9',
          duration: '12',
          generate_audio: false,
          prompt: 'a kite',
          resolution: '480p',
        },
      });
    });

    it('sends reference images as image_urls', () => {
      const { endpoint, input } = buildFalVideoRequest(SEEDANCE, {
        aspectRatio: '16:9',
        imageUrls: ['https://img/a.png'],
        prompt: '@Image1 on a beach',
      });

      expect(endpoint).toBe('bytedance/seedance-2.5/reference-to-video');
      expect(input).toMatchObject({ aspect_ratio: '16:9', image_urls: ['https://img/a.png'] });
      expect(input).not.toHaveProperty('reference_image_urls');
    });
  });

  it('rejects a model without a fal video spec', () => {
    expect(() => buildFalVideoRequest('unknown/model', { prompt: 'p' })).toThrow(
      'Unsupported fal video model',
    );
  });

  it('skips an unset random seed', () => {
    expect(buildFalVideoRequest(MODEL, { prompt: 'p', seed: null }).input).not.toHaveProperty(
      'seed',
    );
  });
});

describe('LobeFalAI video', () => {
  let runtime: LobeFalAI;

  beforeEach(() => {
    vi.clearAllMocks();
    runtime = new LobeFalAI({ apiKey: 'test-key' });
  });

  it('submits to the task endpoint and returns the fal request path as inference id', async () => {
    queue.submit.mockResolvedValue({ request_id: 'req-1' });

    const result = await runtime.createVideo({
      model: MODEL,
      params: { imageUrl: 'https://img/first.png', prompt: 'p' },
    });

    expect(queue.submit).toHaveBeenCalledWith('minimax/h3-max/image-to-video', {
      input: expect.objectContaining({ image_url: 'https://img/first.png' }),
    });
    expect(result).toEqual({ inferenceId: 'minimax/h3-max/requests/req-1' });
    expect(parseFalVideoInferenceId(result.inferenceId)).toEqual({
      appId: MODEL,
      requestId: 'req-1',
    });
  });

  it('resolves mapped model ids before routing', async () => {
    queue.submit.mockResolvedValue({ request_id: 'req-2' });
    const mapped = new LobeFalAI({ apiKey: 'k', modelIdMapping: { 'h3-max': MODEL } });

    await mapped.createVideo({ model: 'h3-max', params: { prompt: 'p' } });

    expect(queue.submit).toHaveBeenCalledWith('minimax/h3-max/text-to-video', expect.anything());
  });

  it('rejects models without a video endpoint', async () => {
    await expect(
      runtime.createVideo({ model: 'fal-ai/qwen-image', params: { prompt: 'p' } }),
    ).rejects.toMatchObject({ errorType: 'ProviderBizError' });
    expect(queue.submit).not.toHaveBeenCalled();
  });

  it('maps a 401 submit error to InvalidProviderAPIKey', async () => {
    queue.submit.mockRejectedValue(Object.assign(new Error('Unauthorized'), { status: 401 }));

    await expect(
      runtime.createVideo({ model: MODEL, params: { prompt: 'p' } }),
    ).rejects.toMatchObject({ errorType: 'InvalidProviderAPIKey' });
  });

  it('only declares polling completion', () => {
    expect(runtime.getVideoGenerationCapabilities()).toEqual({ completionModes: ['polling'] });
  });

  describe('handlePollVideoStatus', () => {
    const inferenceId = 'minimax/h3-max/requests/req-1';

    it('stays pending until the request completes', async () => {
      queue.status.mockResolvedValue({ status: 'IN_PROGRESS' });

      await expect(runtime.handlePollVideoStatus(inferenceId)).resolves.toEqual({
        status: 'pending',
      });
      expect(queue.status).toHaveBeenCalledWith(MODEL, { logs: false, requestId: 'req-1' });
      expect(queue.result).not.toHaveBeenCalled();
    });

    it('returns the video url on success', async () => {
      queue.status.mockResolvedValue({ status: 'COMPLETED' });
      queue.result.mockResolvedValue({ data: { video: { url: 'https://v.fal.media/out.mp4' } } });

      await expect(runtime.handlePollVideoStatus(inferenceId)).resolves.toEqual({
        status: 'success',
        videoUrl: 'https://v.fal.media/out.mp4',
      });
      expect(queue.result).toHaveBeenCalledWith(MODEL, { requestId: 'req-1' });
    });

    it('fails with the provider detail when the completed request errored', async () => {
      queue.status.mockResolvedValue({ status: 'COMPLETED' });
      queue.result.mockRejectedValue(
        Object.assign(new Error('Unprocessable Entity'), {
          body: { detail: [{ msg: 'Image aspect ratio is out of range' }] },
          status: 422,
        }),
      );

      await expect(runtime.handlePollVideoStatus(inferenceId)).resolves.toEqual({
        error: 'Image aspect ratio is out of range',
        status: 'failed',
      });
    });

    it('fails when the result has no video', async () => {
      queue.status.mockResolvedValue({ status: 'COMPLETED' });
      queue.result.mockResolvedValue({ data: {} });

      await expect(runtime.handlePollVideoStatus(inferenceId)).resolves.toMatchObject({
        status: 'failed',
      });
    });
  });
});
