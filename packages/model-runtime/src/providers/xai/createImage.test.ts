// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CreateImageOptions } from '../../core/openaiCompatibleFactory';
import type { CreateImagePayload } from '../../types/image';
import { createXAIImage } from './createImage';

// Mock the console.error to avoid polluting test output
vi.spyOn(console, 'error').mockImplementation(() => {});

const mockOptions: CreateImageOptions = {
  apiKey: 'test-api-key',
  baseURL: 'https://api.x.ai/v1',
  provider: 'xai',
};

beforeEach(() => {
  // Reset all mocks before each test
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('createXAIImage', () => {
  describe('Success scenarios', () => {
    it('should successfully generate image with basic prompt', async () => {
      const mockImageUrl = 'https://xai-cdn.com/images/generated/test-image.jpg';

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            {
              url: mockImageUrl,
              revised_prompt: 'A beautiful sunset over the mountains',
            },
          ],
        }),
      });

      const payload: CreateImagePayload = {
        model: 'grok-imagine-image',
        params: {
          prompt: 'A beautiful sunset over the mountains',
        },
      };

      const result = await createXAIImage(payload, mockOptions);

      expect(fetch).toHaveBeenCalledWith('https://api.x.ai/v1/images/generations', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer test-api-key',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'grok-imagine-image',
          prompt: 'A beautiful sunset over the mountains',
        }),
      });

      expect(result).toEqual({
        imageUrl: mockImageUrl,
      });
    });

    it('should handle custom aspect ratio', async () => {
      const mockImageUrl = 'https://xai-cdn.com/images/generated/custom-ratio.jpg';

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            {
              url: mockImageUrl,
              revised_prompt: 'Abstract digital art',
            },
          ],
        }),
      });

      const payload: CreateImagePayload = {
        model: 'grok-imagine-image',
        params: {
          prompt: 'Abstract digital art',
          aspectRatio: '16:9',
        },
      };

      const result = await createXAIImage(payload, mockOptions);

      expect(fetch).toHaveBeenCalledWith(
        'https://api.x.ai/v1/images/generations',
        expect.objectContaining({
          body: JSON.stringify({
            model: 'grok-imagine-image',
            prompt: 'Abstract digital art',
            aspect_ratio: '16:9',
          }),
        }),
      );

      expect(result).toEqual({
        imageUrl: mockImageUrl,
      });
    });

    it('should include aspect_ratio when value is auto', async () => {
      const mockImageUrl = 'https://xai-cdn.com/images/generated/auto-ratio.jpg';

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            {
              url: mockImageUrl,
              revised_prompt: 'Abstract digital art',
            },
          ],
        }),
      });

      const payload: CreateImagePayload = {
        model: 'grok-imagine-image',
        params: {
          prompt: 'Abstract digital art',
          aspectRatio: 'auto',
        },
      };

      const result = await createXAIImage(payload, mockOptions);

      expect(fetch).toHaveBeenCalledWith(
        'https://api.x.ai/v1/images/generations',
        expect.objectContaining({
          body: JSON.stringify({
            model: 'grok-imagine-image',
            prompt: 'Abstract digital art',
            aspect_ratio: 'auto',
          }),
        }),
      );

      expect(result).toEqual({
        imageUrl: mockImageUrl,
      });
    });

    it('should handle resolution parameter', async () => {
      const mockImageUrl = 'https://xai-cdn.com/images/generated/2k-image.jpg';

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            {
              url: mockImageUrl,
              revised_prompt: 'An astronaut performing EVA in LEO',
            },
          ],
        }),
      });

      const payload: CreateImagePayload = {
        model: 'grok-imagine-image',
        params: {
          prompt: 'An astronaut performing EVA in LEO',
          resolution: '2k',
        },
      };

      const result = await createXAIImage(payload, mockOptions);

      expect(fetch).toHaveBeenCalledWith(
        'https://api.x.ai/v1/images/generations',
        expect.objectContaining({
          body: JSON.stringify({
            model: 'grok-imagine-image',
            prompt: 'An astronaut performing EVA in LEO',
            resolution: '2k',
          }),
        }),
      );

      expect(result).toEqual({
        imageUrl: mockImageUrl,
      });
    });

    it('should include resolution when value is 1k', async () => {
      const mockImageUrl = 'https://xai-cdn.com/images/generated/1k-res.jpg';

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            {
              url: mockImageUrl,
              revised_prompt: 'Test image',
            },
          ],
        }),
      });

      const payload: CreateImagePayload = {
        model: 'grok-imagine-image',
        params: {
          prompt: 'Test image',
          resolution: '1k',
        },
      };

      const result = await createXAIImage(payload, mockOptions);

      expect(fetch).toHaveBeenCalledWith(
        'https://api.x.ai/v1/images/generations',
        expect.objectContaining({
          body: JSON.stringify({
            model: 'grok-imagine-image',
            prompt: 'Test image',
            resolution: '1k',
          }),
        }),
      );

      expect(result).toEqual({
        imageUrl: mockImageUrl,
      });
    });

    it('should handle image editing mode with imageUrl', async () => {
      const mockImageUrl = 'https://xai-cdn.com/images/generated/edited-image.jpg';

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            {
              url: mockImageUrl,
              revised_prompt: 'Change the landmarks to be New York City landmarks',
            },
          ],
        }),
      });

      const payload: CreateImagePayload = {
        model: 'grok-imagine-image',
        params: {
          prompt: 'Change the landmarks to be New York City landmarks',
          imageUrl: 'https://example.com/landmarks.jpg',
        },
      };

      const result = await createXAIImage(payload, mockOptions);

      expect(fetch).toHaveBeenCalledWith(
        'https://api.x.ai/v1/images/edits',
        expect.objectContaining({
          body: JSON.stringify({
            model: 'grok-imagine-image',
            prompt: 'Change the landmarks to be New York City landmarks',
            image: {
              type: 'image_url',
              url: 'https://example.com/landmarks.jpg',
            },
          }),
        }),
      );

      expect(result).toEqual({
        imageUrl: mockImageUrl,
      });
    });

    it('should not include aspectRatio in image editing mode', async () => {
      const mockImageUrl = 'https://xai-cdn.com/images/generated/edited-no-aspect.jpg';

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            {
              url: mockImageUrl,
              revised_prompt: 'Change the landmarks to be New York City landmarks',
            },
          ],
        }),
      });

      const payload: CreateImagePayload = {
        model: 'grok-imagine-image',
        params: {
          prompt: 'Change the landmarks to be New York City landmarks',
          imageUrl: 'https://example.com/landmarks.jpg',
          aspectRatio: '16:9',
        },
      };

      const result = await createXAIImage(payload, mockOptions);

      expect(fetch).toHaveBeenCalledWith(
        'https://api.x.ai/v1/images/edits',
        expect.objectContaining({
          body: JSON.stringify({
            model: 'grok-imagine-image',
            prompt: 'Change the landmarks to be New York City landmarks',
            image: {
              type: 'image_url',
              url: 'https://example.com/landmarks.jpg',
            },
          }),
        }),
      );

      expect(result).toEqual({
        imageUrl: mockImageUrl,
      });
    });

    it('should handle multiple generated images and return the first one', async () => {
      const mockImageUrls = [
        'https://xai-cdn.com/images/generated/image-1.jpg',
        'https://xai-cdn.com/images/generated/image-2.jpg',
      ];

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            {
              url: mockImageUrls[0],
              revised_prompt: 'Multiple images test',
            },
            {
              url: mockImageUrls[1],
              revised_prompt: 'Multiple images test',
            },
          ],
        }),
      });

      const payload: CreateImagePayload = {
        model: 'grok-imagine-image',
        params: {
          prompt: 'Multiple images test',
        },
      };

      const result = await createXAIImage(payload, mockOptions);

      expect(result).toEqual({
        imageUrl: mockImageUrls[0], // Should return first image
      });
    });

    it('should handle image editing mode with imageUrls', async () => {
      const mockImageUrl = 'https://xai-cdn.com/images/generated/edited-multi-image.jpg';

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            {
              url: mockImageUrl,
              revised_prompt: 'Edit multiple images',
            },
          ],
        }),
      });

      const payload: CreateImagePayload = {
        model: 'grok-imagine-image',
        params: {
          prompt: 'Edit multiple images',
          imageUrls: ['https://example.com/image1.jpg', 'https://example.com/image2.jpg'],
        },
      };

      const result = await createXAIImage(payload, mockOptions);

      expect(fetch).toHaveBeenCalledWith(
        'https://api.x.ai/v1/images/edits',
        expect.objectContaining({
          body: JSON.stringify({
            model: 'grok-imagine-image',
            prompt: 'Edit multiple images',
            images: [
              {
                type: 'image_url',
                url: 'https://example.com/image1.jpg',
              },
              {
                type: 'image_url',
                url: 'https://example.com/image2.jpg',
              },
            ],
          }),
        }),
      );

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
          error: {
            message: 'Invalid prompt format',
          },
        }),
      });

      const payload: CreateImagePayload = {
        model: 'grok-imagine-image',
        params: {
          prompt: 'Invalid prompt',
        },
      };

      await expect(createXAIImage(payload, mockOptions)).rejects.toEqual(
        expect.objectContaining({
          errorType: 'ProviderBizError',
          provider: 'xai',
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
        model: 'grok-imagine-image',
        params: {
          prompt: 'Test prompt',
        },
      };

      await expect(createXAIImage(payload, mockOptions)).rejects.toEqual(
        expect.objectContaining({
          errorType: 'ProviderBizError',
          provider: 'xai',
        }),
      );
    });

    it('should handle empty data array', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [],
        }),
      });

      const payload: CreateImagePayload = {
        model: 'grok-imagine-image',
        params: {
          prompt: 'Empty result test',
        },
      };

      await expect(createXAIImage(payload, mockOptions)).rejects.toEqual(
        expect.objectContaining({
          errorType: 'ProviderBizError',
          provider: 'xai',
        }),
      );
    });

    it('should handle missing data field', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      const payload: CreateImagePayload = {
        model: 'grok-imagine-image',
        params: {
          prompt: 'Missing data test',
        },
      };

      await expect(createXAIImage(payload, mockOptions)).rejects.toEqual(
        expect.objectContaining({
          errorType: 'ProviderBizError',
          provider: 'xai',
        }),
      );
    });

    it('should handle null/empty image URL', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            {
              url: '',
              revised_prompt: 'A beautiful sunset over the mountains',
            },
          ],
        }),
      });

      const payload: CreateImagePayload = {
        model: 'grok-imagine-image',
        params: {
          prompt: 'Empty URL test',
        },
      };

      await expect(createXAIImage(payload, mockOptions)).rejects.toEqual(
        expect.objectContaining({
          errorType: 'ProviderBizError',
          provider: 'xai',
        }),
      );
    });

    it('should handle network errors', async () => {
      global.fetch = vi.fn().mockRejectedValueOnce(new Error('Network connection failed'));

      const payload: CreateImagePayload = {
        model: 'grok-imagine-image',
        params: {
          prompt: 'Network error test',
        },
      };

      await expect(createXAIImage(payload, mockOptions)).rejects.toEqual(
        expect.objectContaining({
          errorType: 'ProviderBizError',
          provider: 'xai',
        }),
      );
    });

    it('should handle unauthorized access', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({
          error: {
            message: 'Invalid API key',
          },
        }),
      });

      const payload: CreateImagePayload = {
        model: 'grok-imagine-image',
        params: {
          prompt: 'Unauthorized test',
        },
      };

      await expect(createXAIImage(payload, mockOptions)).rejects.toEqual(
        expect.objectContaining({
          errorType: 'ProviderBizError',
          provider: 'xai',
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
        model: 'grok-imagine-image',
        params: {
          prompt: 'JSON error test',
        },
      };

      await expect(createXAIImage(payload, mockOptions)).rejects.toEqual(
        expect.objectContaining({
          errorType: 'ProviderBizError',
          provider: 'xai',
        }),
      );
    });
  });
});
