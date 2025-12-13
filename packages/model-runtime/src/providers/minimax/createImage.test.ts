// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CreateImageOptions } from '../../core/openaiCompatibleFactory';
import { CreateImagePayload } from '../../types/image';
import { createMiniMaxImage } from './createImage';

// Mock the console.error to avoid polluting test output
vi.spyOn(console, 'error').mockImplementation(() => {});

const mockOptions: CreateImageOptions = {
  apiKey: 'test-api-key',
  baseURL: 'https://api.minimaxi.com/v1',
  provider: 'minimax',
};

beforeEach(() => {
  // Reset all mocks before each test
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('createMiniMaxImage', () => {
  describe('Success scenarios', () => {
    it('should successfully generate image with basic prompt', async () => {
      const mockImageUrl = 'https://minimax-cdn.com/images/generated/test-image.jpg';

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          base_resp: {
            status_code: 0,
            status_msg: 'success',
          },
          data: {
            image_urls: [mockImageUrl],
          },
          id: 'img-123456',
          metadata: {
            failed_count: '0',
            success_count: '1',
          },
        }),
      });

      const payload: CreateImagePayload = {
        model: 'image-01',
        params: {
          prompt: 'A beautiful sunset over the mountains',
        },
      };

      const result = await createMiniMaxImage(payload, mockOptions);

      expect(fetch).toHaveBeenCalledWith('https://api.minimaxi.com/v1/image_generation', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer test-api-key',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          aspect_ratio: undefined,
          model: 'image-01',
          n: 1,
          prompt: 'A beautiful sunset over the mountains',
        }),
      });

      expect(result).toEqual({
        imageUrl: mockImageUrl,
      });
    });

    it('should handle custom aspect ratio', async () => {
      const mockImageUrl = 'https://minimax-cdn.com/images/generated/custom-ratio.jpg';

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          base_resp: {
            status_code: 0,
            status_msg: 'success',
          },
          data: {
            image_urls: [mockImageUrl],
          },
          id: 'img-custom-ratio',
          metadata: {
            failed_count: '0',
            success_count: '1',
          },
        }),
      });

      const payload: CreateImagePayload = {
        model: 'image-01',
        params: {
          prompt: 'Abstract digital art',
          aspectRatio: '16:9',
        },
      };

      const result = await createMiniMaxImage(payload, mockOptions);

      expect(fetch).toHaveBeenCalledWith(
        'https://api.minimaxi.com/v1/image_generation',
        expect.objectContaining({
          body: JSON.stringify({
            aspect_ratio: '16:9',
            model: 'image-01',
            n: 1,
            prompt: 'Abstract digital art',
          }),
        }),
      );

      expect(result).toEqual({
        imageUrl: mockImageUrl,
      });
    });

    it('should handle seed value correctly', async () => {
      const mockImageUrl = 'https://minimax-cdn.com/images/generated/seeded-image.jpg';

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          base_resp: {
            status_code: 0,
            status_msg: 'success',
          },
          data: {
            image_urls: [mockImageUrl],
          },
          id: 'img-seeded',
          metadata: {
            failed_count: '0',
            success_count: '1',
          },
        }),
      });

      const payload: CreateImagePayload = {
        model: 'image-01',
        params: {
          prompt: 'Reproducible image with seed',
          seed: 42,
        },
      };

      const result = await createMiniMaxImage(payload, mockOptions);

      expect(fetch).toHaveBeenCalledWith(
        'https://api.minimaxi.com/v1/image_generation',
        expect.objectContaining({
          body: JSON.stringify({
            aspect_ratio: undefined,
            model: 'image-01',
            n: 1,
            prompt: 'Reproducible image with seed',
            seed: 42,
          }),
        }),
      );

      expect(result).toEqual({
        imageUrl: mockImageUrl,
      });
    });

    it('should handle seed value of 0 correctly', async () => {
      const mockImageUrl = 'https://minimax-cdn.com/images/generated/zero-seed.jpg';

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          base_resp: {
            status_code: 0,
            status_msg: 'success',
          },
          data: {
            image_urls: [mockImageUrl],
          },
          id: 'img-zero-seed',
          metadata: {
            failed_count: '0',
            success_count: '1',
          },
        }),
      });

      const payload: CreateImagePayload = {
        model: 'image-01',
        params: {
          prompt: 'Image with seed 0',
          seed: 0,
        },
      };

      await createMiniMaxImage(payload, mockOptions);

      // Verify that seed: 0 is included in the request
      expect(fetch).toHaveBeenCalledWith(
        'https://api.minimaxi.com/v1/image_generation',
        expect.objectContaining({
          body: JSON.stringify({
            aspect_ratio: undefined,
            model: 'image-01',
            n: 1,
            prompt: 'Image with seed 0',
            seed: 0,
          }),
        }),
      );
    });

    it('should handle multiple generated images and return the first one', async () => {
      const mockImageUrls = [
        'https://minimax-cdn.com/images/generated/image-1.jpg',
        'https://minimax-cdn.com/images/generated/image-2.jpg',
      ];

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          base_resp: {
            status_code: 0,
            status_msg: 'success',
          },
          data: {
            image_urls: mockImageUrls,
          },
          id: 'img-multiple',
          metadata: {
            failed_count: '0',
            success_count: '2',
          },
        }),
      });

      const payload: CreateImagePayload = {
        model: 'image-01',
        params: {
          prompt: 'Multiple images test',
        },
      };

      const result = await createMiniMaxImage(payload, mockOptions);

      expect(result).toEqual({
        imageUrl: mockImageUrls[0], // Should return the first image
      });
    });

    it('should handle partial failures gracefully', async () => {
      const mockImageUrl = 'https://minimax-cdn.com/images/generated/partial-success.jpg';

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          base_resp: {
            status_code: 0,
            status_msg: 'success',
          },
          data: {
            image_urls: [mockImageUrl],
          },
          id: 'img-partial',
          metadata: {
            failed_count: '2',
            success_count: '1',
          },
        }),
      });

      const payload: CreateImagePayload = {
        model: 'image-01',
        params: {
          prompt: 'Test partial failure',
        },
      };

      const result = await createMiniMaxImage(payload, mockOptions);

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
          base_resp: {
            status_code: 1001,
            status_msg: 'Invalid prompt format',
          },
        }),
      });

      const payload: CreateImagePayload = {
        model: 'image-01',
        params: {
          prompt: 'Invalid prompt',
        },
      };

      await expect(createMiniMaxImage(payload, mockOptions)).rejects.toEqual(
        expect.objectContaining({
          errorType: 'ProviderBizError',
          provider: 'minimax',
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
        model: 'image-01',
        params: {
          prompt: 'Test prompt',
        },
      };

      await expect(createMiniMaxImage(payload, mockOptions)).rejects.toEqual(
        expect.objectContaining({
          errorType: 'ProviderBizError',
          provider: 'minimax',
        }),
      );
    });

    it('should handle API error status codes', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          base_resp: {
            status_code: 1002,
            status_msg: 'Content policy violation',
          },
          data: {
            image_urls: [],
          },
          id: 'img-error',
          metadata: {
            failed_count: '1',
            success_count: '0',
          },
        }),
      });

      const payload: CreateImagePayload = {
        model: 'image-01',
        params: {
          prompt: 'Inappropriate content',
        },
      };

      await expect(createMiniMaxImage(payload, mockOptions)).rejects.toEqual(
        expect.objectContaining({
          errorType: 'ProviderBizError',
          provider: 'minimax',
        }),
      );
    });

    it('should handle empty image URLs array', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          base_resp: {
            status_code: 0,
            status_msg: 'success',
          },
          data: {
            image_urls: [],
          },
          id: 'img-empty',
          metadata: {
            failed_count: '1',
            success_count: '0',
          },
        }),
      });

      const payload: CreateImagePayload = {
        model: 'image-01',
        params: {
          prompt: 'Empty result test',
        },
      };

      await expect(createMiniMaxImage(payload, mockOptions)).rejects.toEqual(
        expect.objectContaining({
          errorType: 'ProviderBizError',
          provider: 'minimax',
        }),
      );
    });

    it('should handle missing data field', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          base_resp: {
            status_code: 0,
            status_msg: 'success',
          },
          id: 'img-no-data',
          metadata: {
            failed_count: '0',
            success_count: '1',
          },
        }),
      });

      const payload: CreateImagePayload = {
        model: 'image-01',
        params: {
          prompt: 'Missing data test',
        },
      };

      await expect(createMiniMaxImage(payload, mockOptions)).rejects.toEqual(
        expect.objectContaining({
          errorType: 'ProviderBizError',
          provider: 'minimax',
        }),
      );
    });

    it('should handle null/empty image URL', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          base_resp: {
            status_code: 0,
            status_msg: 'success',
          },
          data: {
            image_urls: [''], // Empty string URL
          },
          id: 'img-empty-url',
          metadata: {
            failed_count: '0',
            success_count: '1',
          },
        }),
      });

      const payload: CreateImagePayload = {
        model: 'image-01',
        params: {
          prompt: 'Empty URL test',
        },
      };

      await expect(createMiniMaxImage(payload, mockOptions)).rejects.toEqual(
        expect.objectContaining({
          errorType: 'ProviderBizError',
          provider: 'minimax',
        }),
      );
    });

    it('should handle network errors', async () => {
      global.fetch = vi.fn().mockRejectedValueOnce(new Error('Network connection failed'));

      const payload: CreateImagePayload = {
        model: 'image-01',
        params: {
          prompt: 'Network error test',
        },
      };

      await expect(createMiniMaxImage(payload, mockOptions)).rejects.toEqual(
        expect.objectContaining({
          errorType: 'ProviderBizError',
          provider: 'minimax',
        }),
      );
    });

    it('should handle unauthorized access', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({
          base_resp: {
            status_code: 1003,
            status_msg: 'Invalid API key',
          },
        }),
      });

      const payload: CreateImagePayload = {
        model: 'image-01',
        params: {
          prompt: 'Unauthorized test',
        },
      };

      await expect(createMiniMaxImage(payload, mockOptions)).rejects.toEqual(
        expect.objectContaining({
          errorType: 'ProviderBizError',
          provider: 'minimax',
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
        model: 'image-01',
        params: {
          prompt: 'JSON error test',
        },
      };

      await expect(createMiniMaxImage(payload, mockOptions)).rejects.toEqual(
        expect.objectContaining({
          errorType: 'ProviderBizError',
          provider: 'minimax',
        }),
      );
    });
  });
});
