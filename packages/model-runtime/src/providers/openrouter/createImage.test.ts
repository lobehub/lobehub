// @vitest-environment node
import type * as LobeUtils from '@lobechat/utils';
import { imageUrlToBase64 } from '@lobechat/utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CreateImageOptions } from '../../core/openaiCompatibleFactory';
import type { CreateImagePayload } from '../../types/image';
import { createOpenRouterImage } from './createImage';

vi.mock('@lobechat/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof LobeUtils>()),
  imageUrlToBase64: vi.fn(),
}));

const mockOptions: CreateImageOptions = {
  apiKey: 'test-api-key',
  baseURL: 'https://openrouter.ai/api/v1',
  provider: 'openrouter',
};

// 1x1 transparent PNG
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const mockSuccessResponse = (usage?: Record<string, number>) => ({
  ok: true,
  json: async () => ({
    created: 1_748_372_400,
    data: [{ b64_json: PNG_B64 }],
    ...(usage ? { usage } : {}),
  }),
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('createOpenRouterImage', () => {
  describe('Success scenarios', () => {
    it('should call the dedicated images endpoint with basic prompt', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce(mockSuccessResponse());

      const payload: CreateImagePayload = {
        model: 'bytedance-seed/seedream-4.5',
        params: { prompt: 'A red panda astronaut floating in space' },
      };

      const result = await createOpenRouterImage(payload, mockOptions);

      expect(fetch).toHaveBeenCalledWith(
        'https://openrouter.ai/api/v1/images',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-api-key',
          }),
        }),
      );

      const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
      expect(body).toEqual({
        model: 'bytedance-seed/seedream-4.5',
        prompt: 'A red panda astronaut floating in space',
      });

      expect(result.imageUrl).toBe(`data:image/png;base64,${PNG_B64}`);
    });

    it('should map aspectRatio, resolution and seed params', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce(mockSuccessResponse());

      const payload: CreateImagePayload = {
        model: 'bytedance-seed/seedream-4.5',
        params: {
          aspectRatio: '16:9',
          prompt: 'A sunset',
          resolution: '2K',
          seed: 42,
        },
      };

      await createOpenRouterImage(payload, mockOptions);

      const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
      expect(body).toEqual({
        aspect_ratio: '16:9',
        model: 'bytedance-seed/seedream-4.5',
        prompt: 'A sunset',
        resolution: '2K',
        seed: 42,
      });
    });

    it('should omit auto aspectRatio and auto quality', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce(mockSuccessResponse());

      const payload: CreateImagePayload = {
        model: 'openai/gpt-image-1',
        params: {
          aspectRatio: 'auto',
          prompt: 'A cat',
          quality: 'auto',
        },
      };

      await createOpenRouterImage(payload, mockOptions);

      const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
      expect(body).toEqual({
        model: 'openai/gpt-image-1',
        prompt: 'A cat',
      });
    });

    it('should inline proxy reference URLs to base64 data URLs for image editing', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce(mockSuccessResponse());
      vi.mocked(imageUrlToBase64).mockResolvedValueOnce({
        base64: PNG_B64,
        mimeType: 'image/png',
      });

      const payload: CreateImagePayload = {
        model: 'google/gemini-3.1-flash-image',
        params: {
          imageUrls: ['https://app.example.com/f/abc123'],
          prompt: 'Make it blue',
        },
      };

      await createOpenRouterImage(payload, mockOptions);

      expect(imageUrlToBase64).toHaveBeenCalledWith('https://app.example.com/f/abc123');

      const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
      expect(body.input_references).toEqual([
        { image_url: { url: `data:image/png;base64,${PNG_B64}` }, type: 'image_url' },
      ]);
    });

    it('should pass through data URL references without fetching', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce(mockSuccessResponse());

      const dataUrl = `data:image/png;base64,${PNG_B64}`;
      const payload: CreateImagePayload = {
        model: 'google/gemini-3.1-flash-image',
        params: {
          imageUrls: [dataUrl],
          prompt: 'Make it blue',
        },
      };

      await createOpenRouterImage(payload, mockOptions);

      expect(imageUrlToBase64).not.toHaveBeenCalled();

      const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
      expect(body.input_references).toEqual([{ image_url: { url: dataUrl }, type: 'image_url' }]);
    });

    it('should convert usage to modelUsage with cost', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce(
        mockSuccessResponse({
          completion_tokens: 4175,
          cost: 0.04,
          prompt_tokens: 10,
          total_tokens: 4185,
        }),
      );

      const payload: CreateImagePayload = {
        model: 'bytedance-seed/seedream-4.5',
        params: { prompt: 'A sunset' },
      };

      const result = await createOpenRouterImage(payload, mockOptions);

      expect(result.modelUsage).toEqual({
        cost: 0.04,
        totalInputTokens: 10,
        totalOutputTokens: 4175,
        totalTokens: 4185,
      });
    });

    it('should use media_type from the response when present', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          created: 1_748_372_400,
          data: [{ b64_json: PNG_B64, media_type: 'image/webp' }],
        }),
      });

      const payload: CreateImagePayload = {
        model: 'black-forest-labs/flux.2-pro',
        params: { prompt: 'A sunset' },
      };

      const result = await createOpenRouterImage(payload, mockOptions);

      expect(result.imageUrl.startsWith('data:image/webp;base64,')).toBe(true);
    });

    it('should sniff jpeg magic bytes when media_type is absent', async () => {
      // Minimal JPEG header (FF D8 FF E0)
      const jpegB64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]).toString(
        'base64',
      );

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          created: 1_748_372_400,
          data: [{ b64_json: jpegB64 }],
        }),
      });

      const payload: CreateImagePayload = {
        model: 'black-forest-labs/flux.2-pro',
        params: { prompt: 'A sunset' },
      };

      const result = await createOpenRouterImage(payload, mockOptions);

      expect(result.imageUrl.startsWith('data:image/jpeg;base64,')).toBe(true);
    });

    it('should strip a legacy :image suffix from the model id', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce(mockSuccessResponse());

      const payload: CreateImagePayload = {
        model: 'google/gemini-2.5-flash-image:image',
        params: { prompt: 'A cat' },
      };

      await createOpenRouterImage(payload, mockOptions);

      const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
      expect(body.model).toBe('google/gemini-2.5-flash-image');
    });
  });

  describe('Error scenarios', () => {
    it('should throw on API error response', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 402,
        statusText: 'Payment Required',
        json: async () => ({ error: { message: 'Insufficient credits' } }),
      });

      const payload: CreateImagePayload = {
        model: 'bytedance-seed/seedream-4.5',
        params: { prompt: 'A sunset' },
      };

      await expect(createOpenRouterImage(payload, mockOptions)).rejects.toMatchObject({
        errorType: 'ProviderBizError',
        provider: 'openrouter',
      });
    });

    it('should throw when response has no b64_json', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ created: 1_748_372_400, data: [] }),
      });

      const payload: CreateImagePayload = {
        model: 'bytedance-seed/seedream-4.5',
        params: { prompt: 'A sunset' },
      };

      await expect(createOpenRouterImage(payload, mockOptions)).rejects.toMatchObject({
        errorType: 'ProviderBizError',
      });
    });
  });
});
