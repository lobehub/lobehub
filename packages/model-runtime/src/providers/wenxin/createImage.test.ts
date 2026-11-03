// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CreateImageOptions } from '../../core/openaiCompatibleFactory';
import type { CreateImagePayload } from '../../types/image';
import { createWenxinImage } from './createImage';

// Mock the console.error to avoid polluting test output
vi.spyOn(console, 'error').mockImplementation(() => {});

const mockOptions: CreateImageOptions = {
  apiKey: 'test-api-key',
  baseURL: 'https://qianfan.baidubce.com/v2',
  provider: 'wenxin',
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('createWenxinImage', () => {
  describe('Success scenarios for musesteamer models', () => {
    it('should successfully generate image with basic prompt', async () => {
      const mockImageUrl =
        'https://qianfan.baidubce.com/musesteamer-air-image/images/test-image.jpeg';

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'as-test123',
          created: 1764665123,
          data: [
            {
              url: mockImageUrl,
            },
          ],
        }),
      });

      const payload: CreateImagePayload = {
        model: 'musesteamer-air-image',
        params: {
          prompt: '画一个西瓜',
        },
      };

      const result = await createWenxinImage(payload, mockOptions);

      const fetchCall = (fetch as any).mock.calls[0];
      expect(fetchCall[0]).toBe('https://qianfan.baidubce.com/v2/musesteamer/images/generations');
      const requestBody = JSON.parse(fetchCall[1].body);
      expect(requestBody).toEqual({
        model: 'musesteamer-air-image',
        prompt: '画一个西瓜',
      });

      expect(result).toEqual({
        imageUrl: mockImageUrl,
      });
    });

    it('should handle custom size', async () => {
      const mockImageUrl =
        'https://qianfan.baidubce.com/musesteamer-air-image/images/custom-size.jpeg';

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'as-custom456',
          created: 1764665123,
          data: [
            {
              url: mockImageUrl,
            },
          ],
        }),
      });

      const payload: CreateImagePayload = {
        model: 'musesteamer-air-image',
        params: {
          prompt: 'Abstract digital art',
          size: '1280x720',
        },
      };

      const result = await createWenxinImage(payload, mockOptions);

      const fetchCall = (fetch as any).mock.calls[0];
      const requestBody = JSON.parse(fetchCall[1].body);
      expect(requestBody).toEqual({
        model: 'musesteamer-air-image',
        prompt: 'Abstract digital art',
        size: '1280x720',
      });

      expect(result).toEqual({
        imageUrl: mockImageUrl,
      });
    });

    it('should handle seed value correctly', async () => {
      const mockImageUrl =
        'https://qianfan.baidubce.com/musesteamer-air-image/images/seeded-image.jpeg';

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'as-seeded',
          created: 1764665123,
          data: [
            {
              url: mockImageUrl,
            },
          ],
        }),
      });

      const payload: CreateImagePayload = {
        model: 'musesteamer-air-image',
        params: {
          prompt: 'Reproducible image with seed',
          seed: 42949672,
        },
      };

      const result = await createWenxinImage(payload, mockOptions);

      const fetchCall = (fetch as any).mock.calls[0];
      const requestBody = JSON.parse(fetchCall[1].body);
      expect(requestBody).toEqual({
        model: 'musesteamer-air-image',
        prompt: 'Reproducible image with seed',
        seed: 42949672,
      });

      expect(result).toEqual({
        imageUrl: mockImageUrl,
      });
    });

    it('should handle seed value of 0 correctly', async () => {
      const mockImageUrl =
        'https://qianfan.baidubce.com/musesteamer-air-image/images/zero-seed.jpeg';

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'as-zero-seed',
          created: 1764665123,
          data: [
            {
              url: mockImageUrl,
            },
          ],
        }),
      });

      const payload: CreateImagePayload = {
        model: 'musesteamer-air-image',
        params: {
          prompt: 'Image with seed 0',
          seed: 0,
        },
      };

      await createWenxinImage(payload, mockOptions);

      const fetchCall = (fetch as any).mock.calls[0];
      const requestBody = JSON.parse(fetchCall[1].body);
      expect(requestBody).toEqual({
        model: 'musesteamer-air-image',
        prompt: 'Image with seed 0',
        seed: 0,
      });
    });

    it('should handle multiple generated images and return first one', async () => {
      const mockImageUrls = [
        'https://qianfan.baidubce.com/musesteamer-air-image/images/image-1.jpeg',
        'https://qianfan.baidubce.com/musesteamer-air-image/images/image-2.jpeg',
      ];

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'as-multiple',
          created: 1764665123,
          data: [{ url: mockImageUrls[0] }, { url: mockImageUrls[1] }],
        }),
      });

      const payload: CreateImagePayload = {
        model: 'musesteamer-air-image',
        params: {
          prompt: 'Multiple images test',
        },
      };

      const result = await createWenxinImage(payload, mockOptions);

      expect(result).toEqual({
        imageUrl: mockImageUrls[0],
      });
    });

    it('should handle both size and seed', async () => {
      const mockImageUrl =
        'https://qianfan.baidubce.com/musesteamer-air-image/images/combined.jpeg';

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'as-combined',
          created: 1764665123,
          data: [
            {
              url: mockImageUrl,
            },
          ],
        }),
      });

      const payload: CreateImagePayload = {
        model: 'musesteamer-air-image',
        params: {
          prompt: 'Combined parameters test',
          size: '1024x1024',
          seed: 12345,
        },
      };

      const result = await createWenxinImage(payload, mockOptions);

      const fetchCall = (fetch as any).mock.calls[0];
      const requestBody = JSON.parse(fetchCall[1].body);
      expect(requestBody).toEqual({
        model: 'musesteamer-air-image',
        prompt: 'Combined parameters test',
        size: '1024x1024',
        seed: 12345,
      });

      expect(result).toEqual({
        imageUrl: mockImageUrl,
      });
    });

    it('should support other musesteamer models using startsWith', async () => {
      const mockImageUrl = 'https://qianfan.baidubce.com/musesteamer-pro-image/images/test.jpeg';

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'as-musesteamer-pro',
          created: 1764665123,
          data: [
            {
              url: mockImageUrl,
            },
          ],
        }),
      });

      const payload: CreateImagePayload = {
        model: 'musesteamer-pro-image',
        params: {
          prompt: 'Test with pro model',
        },
      };

      const result = await createWenxinImage(payload, mockOptions);

      const fetchCall = (fetch as any).mock.calls[0];
      expect(fetchCall[0]).toBe('https://qianfan.baidubce.com/v2/musesteamer/images/generations');
      const requestBody = JSON.parse(fetchCall[1].body);
      expect(requestBody).toEqual({
        model: 'musesteamer-pro-image',
        prompt: 'Test with pro model',
      });

      expect(result).toEqual({
        imageUrl: mockImageUrl,
      });
    });

    it('should handle custom width and height', async () => {
      const mockImageUrl =
        'https://qianfan.baidubce.com/musesteamer-air-image/images/custom-dims.jpeg';

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'as-custom-dims',
          created: 1764665123,
          data: [
            {
              url: mockImageUrl,
            },
          ],
        }),
      });

      const payload: CreateImagePayload = {
        model: 'musesteamer-air-image',
        params: {
          prompt: 'Abstract digital art',
          width: 1280,
          height: 720,
        },
      };

      const result = await createWenxinImage(payload, mockOptions);

      const fetchCall = (fetch as any).mock.calls[0];
      const requestBody = JSON.parse(fetchCall[1].body);
      expect(requestBody).toEqual({
        model: 'musesteamer-air-image',
        prompt: 'Abstract digital art',
        size: '1280x720',
      });

      expect(result).toEqual({
        imageUrl: mockImageUrl,
      });
    });

    it('should prefer width and height over size when both are provided', async () => {
      const mockImageUrl =
        'https://qianfan.baidubce.com/musesteamer-air-image/images/precedence.jpeg';

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'as-precedence',
          created: 1764665123,
          data: [
            {
              url: mockImageUrl,
            },
          ],
        }),
      });

      const payload: CreateImagePayload = {
        model: 'musesteamer-air-image',
        params: {
          prompt: 'Precedence test',
          width: 1024,
          height: 1024,
          size: '1280x720',
        },
      };

      const result = await createWenxinImage(payload, mockOptions);

      const fetchCall = (fetch as any).mock.calls[0];
      const requestBody = JSON.parse(fetchCall[1].body);
      expect(requestBody).toEqual({
        model: 'musesteamer-air-image',
        prompt: 'Precedence test',
        size: '1024x1024',
      });

      expect(result).toEqual({
        imageUrl: mockImageUrl,
      });
    });

    it('should handle width, height, and seed together', async () => {
      const mockImageUrl =
        'https://qianfan.baidubce.com/musesteamer-air-image/images/all-params.jpeg';

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'as-all-params',
          created: 1764665123,
          data: [
            {
              url: mockImageUrl,
            },
          ],
        }),
      });

      const payload: CreateImagePayload = {
        model: 'musesteamer-air-image',
        params: {
          prompt: 'All parameters test',
          width: 1024,
          height: 768,
          seed: 42,
        },
      };

      const result = await createWenxinImage(payload, mockOptions);

      const fetchCall = (fetch as any).mock.calls[0];
      const requestBody = JSON.parse(fetchCall[1].body);
      expect(requestBody).toEqual({
        model: 'musesteamer-air-image',
        prompt: 'All parameters test',
        size: '1024x768',
        seed: 42,
      });

      expect(result).toEqual({
        imageUrl: mockImageUrl,
      });
    });
  });

  describe('Success scenarios for qwen-image', () => {
    it('should successfully generate image with qwen-image model', async () => {
      const mockImageUrl = 'https://qianfan-img-gen.bj.bcebos.com/qwen-image/test-image.png';

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'as-p5vuu9vgsn',
          created: 1735264326,
          data: [
            {
              url: mockImageUrl,
            },
          ],
        }),
      });

      const payload: CreateImagePayload = {
        model: 'qwen-image',
        params: {
          prompt: '画一只小狗',
        },
      };

      const result = await createWenxinImage(payload, mockOptions);

      const fetchCall = (fetch as any).mock.calls[0];
      expect(fetchCall[0]).toBe('https://qianfan.baidubce.com/v2/images/generations');
      const requestBody = JSON.parse(fetchCall[1].body);
      expect(requestBody).toEqual({
        model: 'qwen-image',
        prompt: '画一只小狗',
      });

      expect(result).toEqual({
        imageUrl: mockImageUrl,
      });
    });

    it('should handle qwen-image with size and seed', async () => {
      const mockImageUrl = 'https://qianfan-img-gen.bj.bcebos.com/qwen-image/test-image-2.png';

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'as-qwen-custom',
          created: 1735264326,
          data: [
            {
              url: mockImageUrl,
            },
          ],
        }),
      });

      const payload: CreateImagePayload = {
        model: 'qwen-image',
        params: {
          prompt: 'A beautiful sunset',
          size: '1024x768',
          seed: 42,
        },
      };

      const result = await createWenxinImage(payload, mockOptions);

      const fetchCall = (fetch as any).mock.calls[0];
      const requestBody = JSON.parse(fetchCall[1].body);
      expect(requestBody).toEqual({
        model: 'qwen-image',
        prompt: 'A beautiful sunset',
        size: '1024x768',
        seed: 42,
      });

      expect(result).toEqual({
        imageUrl: mockImageUrl,
      });
    });
  });

  describe('Success scenarios for qwen-image-edit', () => {
    it('should successfully edit image with qwen-image-edit model when imageUrl exists', async () => {
      const mockImageUrl = 'https://qianfan-img-gen.bj.bcebos.com/qwen-image-edit/edited-image.png';

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'as-qwen-edit',
          created: 1735264326,
          data: [
            {
              url: mockImageUrl,
            },
          ],
        }),
      });

      const payload: CreateImagePayload = {
        model: 'qwen-image-edit',
        params: {
          prompt: 'Add a red car',
          imageUrl: 'https://example.com/source-image.jpg',
          size: '1024x1024',
        },
      };

      const result = await createWenxinImage(payload, mockOptions);

      const fetchCall = (fetch as any).mock.calls[0];
      expect(fetchCall[0]).toBe('https://qianfan.baidubce.com/v2/images/edits');
      const requestBody = JSON.parse(fetchCall[1].body);
      expect(requestBody).toEqual({
        model: 'qwen-image-edit',
        prompt: 'Add a red car',
        image: 'https://example.com/source-image.jpg',
        size: '1024x1024',
      });

      expect(result).toEqual({
        imageUrl: mockImageUrl,
      });
    });

    it('should use generations endpoint for qwen-image-edit when imageUrl is not present', async () => {
      const mockImageUrl =
        'https://qianfan-img-gen.bj.bcebos.com/qwen-image-edit/generated-image.png';

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'as-qwen-gen',
          created: 1735264326,
          data: [
            {
              url: mockImageUrl,
            },
          ],
        }),
      });

      const payload: CreateImagePayload = {
        model: 'qwen-image-edit',
        params: {
          prompt: 'Generate an image',
          size: '1024x1024',
        },
      };

      const result = await createWenxinImage(payload, mockOptions);

      const fetchCall = (fetch as any).mock.calls[0];
      expect(fetchCall[0]).toBe('https://qianfan.baidubce.com/v2/images/generations');
      const requestBody = JSON.parse(fetchCall[1].body);
      expect(requestBody).toEqual({
        model: 'qwen-image-edit',
        prompt: 'Generate an image',
        size: '1024x1024',
      });

      expect(result).toEqual({
        imageUrl: mockImageUrl,
      });
    });

    it('should use imageUrls array when imageUrls exists', async () => {
      const mockImageUrl =
        'https://qianfan-img-gen.bj.bcebos.com/qwen-image-edit/edited-image-2.png';

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'as-qwen-edit-urls',
          created: 1735264326,
          data: [
            {
              url: mockImageUrl,
            },
          ],
        }),
      });

      const payload: CreateImagePayload = {
        model: 'qwen-image-edit',
        params: {
          prompt: 'Edit this image',
          imageUrls: [
            'https://example.com/source-image.jpg',
            'https://example.com/second-image.jpg',
          ],
          size: '1024x1024',
        },
      };

      const result = await createWenxinImage(payload, mockOptions);

      const fetchCall = (fetch as any).mock.calls[0];
      expect(fetchCall[0]).toBe('https://qianfan.baidubce.com/v2/images/edits');
      const requestBody = JSON.parse(fetchCall[1].body);
      expect(requestBody).toEqual({
        model: 'qwen-image-edit',
        prompt: 'Edit this image',
        image: ['https://example.com/source-image.jpg', 'https://example.com/second-image.jpg'],
        size: '1024x1024',
      });

      expect(result).toEqual({
        imageUrl: mockImageUrl,
      });
    });
  });

  describe('Success scenarios for ernie-irag-edit', () => {
    it('should use edits endpoint for ernie-irag-edit when imageUrl exists', async () => {
      const mockImageUrl = 'https://qianfan-model.bj.bcebos.com/ernie-irag-edit/edited-image.jpg';

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'as-iwjxy4gpyc',
          created: 1744787581,
          data: [
            {
              url: mockImageUrl,
            },
          ],
        }),
      });

      const payload: CreateImagePayload = {
        model: 'ernie-irag-edit',
        params: {
          prompt: '',
          imageUrl: 'https://sdc-def.example.com/image.jpg',
        },
      };

      const result = await createWenxinImage(payload, mockOptions);

      const fetchCall = (fetch as any).mock.calls[0];
      expect(fetchCall[0]).toBe('https://qianfan.baidubce.com/v2/images/edits');
      const requestBody = JSON.parse(fetchCall[1].body);
      expect(requestBody).toEqual({
        model: 'ernie-irag-edit',
        prompt: '',
        image: 'https://sdc-def.example.com/image.jpg',
        feature: 'variation',
      });

      expect(result).toEqual({
        imageUrl: mockImageUrl,
      });
    });

    it('should use edits endpoint for ernie-irag-edit when imageUrls exists', async () => {
      const mockImageUrl = 'https://qianfan-model.bj.bcebos.com/ernie-irag-edit/edited-image-2.jpg';

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'as-irag-edit-urls',
          created: 1744787581,
          data: [
            {
              url: mockImageUrl,
            },
          ],
        }),
      });

      const payload: CreateImagePayload = {
        model: 'ernie-irag-edit',
        params: {
          prompt: '',
          imageUrls: ['https://example.com/image.jpg', 'https://example.com/second.jpg'],
        },
      };

      const result = await createWenxinImage(payload, mockOptions);

      const fetchCall = (fetch as any).mock.calls[0];
      expect(fetchCall[0]).toBe('https://qianfan.baidubce.com/v2/images/edits');
      const requestBody = JSON.parse(fetchCall[1].body);
      expect(requestBody).toEqual({
        model: 'ernie-irag-edit',
        prompt: '',
        image: ['https://example.com/image.jpg', 'https://example.com/second.jpg'],
        feature: 'variation',
      });

      expect(result).toEqual({
        imageUrl: mockImageUrl,
      });
    });
  });

  describe('Error scenarios', () => {
    it('should handle HTTP error responses', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({
          error: 'Invalid prompt format',
        }),
      });

      const payload: CreateImagePayload = {
        model: 'musesteamer-air-image',
        params: {
          prompt: 'Invalid prompt',
        },
      };

      await expect(createWenxinImage(payload, mockOptions)).rejects.toEqual(
        expect.objectContaining({
          errorType: 'ProviderBizError',
          provider: 'wenxin',
        }),
      );
    });

    it('should handle non-JSON error responses', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => {
          throw new Error('Failed to parse JSON');
        },
      });

      const payload: CreateImagePayload = {
        model: 'qwen-image',
        params: {
          prompt: 'Test prompt',
        },
      };

      await expect(createWenxinImage(payload, mockOptions)).rejects.toEqual(
        expect.objectContaining({
          errorType: 'ProviderBizError',
          provider: 'wenxin',
        }),
      );
    });

    it('should handle empty data array', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'as-empty',
          created: 1764665123,
          data: [],
        }),
      });

      const payload: CreateImagePayload = {
        model: 'musesteamer-air-image',
        params: {
          prompt: 'Empty result test',
        },
      };

      await expect(createWenxinImage(payload, mockOptions)).rejects.toEqual(
        expect.objectContaining({
          errorType: 'ProviderBizError',
          provider: 'wenxin',
        }),
      );
    });

    it('should handle missing data field', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'as-no-data',
          created: 1764665123,
        }),
      });

      const payload: CreateImagePayload = {
        model: 'qwen-image',
        params: {
          prompt: 'Missing data test',
        },
      };

      await expect(createWenxinImage(payload, mockOptions)).rejects.toEqual(
        expect.objectContaining({
          errorType: 'ProviderBizError',
          provider: 'wenxin',
        }),
      );
    });

    it('should handle null/empty image URL', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'as-empty-url',
          created: 1764665123,
          data: [
            {
              url: '',
            },
          ],
        }),
      });

      const payload: CreateImagePayload = {
        model: 'ernie-irag-edit',
        params: {
          prompt: '',
          imageUrl: 'https://example.com/image.jpg',
        },
      };

      await expect(createWenxinImage(payload, mockOptions)).rejects.toEqual(
        expect.objectContaining({
          errorType: 'ProviderBizError',
          provider: 'wenxin',
        }),
      );
    });

    it('should handle network errors', async () => {
      global.fetch = vi.fn().mockRejectedValueOnce(new Error('Network connection failed'));

      const payload: CreateImagePayload = {
        model: 'musesteamer-air-image',
        params: {
          prompt: 'Network error test',
        },
      };

      await expect(createWenxinImage(payload, mockOptions)).rejects.toEqual(
        expect.objectContaining({
          errorType: 'ProviderBizError',
          provider: 'wenxin',
        }),
      );
    });

    it('should handle unauthorized access', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({
          error: 'Invalid API key',
        }),
      });

      const payload: CreateImagePayload = {
        model: 'qwen-image',
        params: {
          prompt: 'Unauthorized test',
        },
      };

      await expect(createWenxinImage(payload, mockOptions)).rejects.toEqual(
        expect.objectContaining({
          errorType: 'ProviderBizError',
          provider: 'wenxin',
        }),
      );
    });

    it('should handle malformed JSON response', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => {
          throw new Error('Unexpected token in JSON');
        },
      });

      const payload: CreateImagePayload = {
        model: 'musesteamer-air-image',
        params: {
          prompt: 'JSON error test',
        },
      };

      await expect(createWenxinImage(payload, mockOptions)).rejects.toEqual(
        expect.objectContaining({
          errorType: 'ProviderBizError',
          provider: 'wenxin',
        }),
      );
    });
  });
});
