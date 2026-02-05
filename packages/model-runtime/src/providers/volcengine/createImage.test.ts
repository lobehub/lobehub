import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CreateImageOptions } from '../../core/openaiCompatibleFactory';
import type { CreateImagePayload } from '../../types/image';
import { createVolcengineImage } from './createImage';

// Mock dependencies
vi.mock('debug', () => ({
  default: vi.fn(() => vi.fn()),
}));

const mockGenerate = vi.fn();
vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    images: {
      generate: mockGenerate,
    },
  })),
}));

describe('createVolcengineImage', () => {
  let payload: CreateImagePayload;
  let options: CreateImageOptions;

  beforeEach(() => {
    vi.clearAllMocks();

    // Default test payload and options
    payload = {
      model: 'doubao-seedream-3-0-t2i',
      params: {
        prompt: 'a beautiful landscape',
      },
    };

    options = {
      apiKey: 'test-api-key',
      provider: 'volcengine',
    };
  });

  describe('successful image generation', () => {
    it('should generate image with URL response format', async () => {
      const mockResponse = {
        data: [
          {
            url: 'https://example.com/generated-image.jpg',
            size: '1024x768',
          },
        ],
      };
      mockGenerate.mockResolvedValue(mockResponse);

      const result = await createVolcengineImage(payload, options);

      expect(result).toEqual({
        imageUrl: 'https://example.com/generated-image.jpg',
        width: 1024,
        height: 768,
      });
    });

    it('should generate image with base64 response format', async () => {
      const mockBase64 =
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
      const mockResponse = {
        data: [
          {
            b64_json: mockBase64,
            size: '512x512',
          },
        ],
      };
      mockGenerate.mockResolvedValue(mockResponse);

      const result = await createVolcengineImage(payload, options);

      expect(result).toEqual({
        imageUrl: `data:image/jpeg;base64,${mockBase64}`,
        width: 512,
        height: 512,
      });
    });

    it('should handle response without size information', async () => {
      const mockResponse = {
        data: [
          {
            url: 'https://example.com/generated-image.jpg',
          },
        ],
      };
      mockGenerate.mockResolvedValue(mockResponse);

      const result = await createVolcengineImage(payload, options);

      expect(result).toEqual({
        imageUrl: 'https://example.com/generated-image.jpg',
        width: undefined,
        height: undefined,
      });
    });
  });

  describe('parameter mapping', () => {
    it('should map cfg parameter to guidance_scale', async () => {
      const mockResponse = {
        data: [{ url: 'https://example.com/test.jpg' }],
      };
      mockGenerate.mockResolvedValue(mockResponse);

      payload.params = {
        prompt: 'test prompt',
        cfg: 7.5,
      };

      await createVolcengineImage(payload, options);

      expect(mockGenerate).toHaveBeenCalledWith({
        model: 'doubao-seedream-3-0-t2i',
        watermark: false,
        prompt: 'test prompt',
        guidance_scale: 7.5,
      });
    });

    it('should map imageUrls parameter to image', async () => {
      const mockResponse = {
        data: [{ url: 'https://example.com/test.jpg' }],
      };
      mockGenerate.mockResolvedValue(mockResponse);

      payload.params = {
        prompt: 'test prompt',
        imageUrls: ['https://example.com/input1.jpg', 'https://example.com/input2.jpg'],
      };

      await createVolcengineImage(payload, options);

      expect(mockGenerate).toHaveBeenCalledWith({
        model: 'doubao-seedream-3-0-t2i',
        watermark: false,
        prompt: 'test prompt',
        image: ['https://example.com/input1.jpg', 'https://example.com/input2.jpg'],
      });
    });

    it('should map imageUrl parameter to image', async () => {
      const mockResponse = {
        data: [{ url: 'https://example.com/test.jpg' }],
      };
      mockGenerate.mockResolvedValue(mockResponse);

      payload.params = {
        prompt: 'test prompt',
        imageUrl: 'https://example.com/input.jpg',
      };

      await createVolcengineImage(payload, options);

      expect(mockGenerate).toHaveBeenCalledWith({
        model: 'doubao-seedream-3-0-t2i',
        watermark: false,
        prompt: 'test prompt',
        image: 'https://example.com/input.jpg',
      });
    });

    it('should preserve unmapped parameters', async () => {
      const mockResponse = {
        data: [{ url: 'https://example.com/test.jpg' }],
      };
      mockGenerate.mockResolvedValue(mockResponse);

      payload.params = {
        prompt: 'test prompt',
        seed: 12345,
        size: '1024x1024',
      };

      await createVolcengineImage(payload, options);

      expect(mockGenerate).toHaveBeenCalledWith({
        model: 'doubao-seedream-3-0-t2i',
        watermark: false,
        prompt: 'test prompt',
        seed: 12345,
        size: '1024x1024',
      });
    });
  });

  describe('image input handling', () => {
    it('should preserve image input when array has items', async () => {
      const mockResponse = {
        data: [{ url: 'https://example.com/test.jpg' }],
      };
      mockGenerate.mockResolvedValue(mockResponse);

      payload.params = {
        prompt: 'test prompt',
        imageUrls: ['https://example.com/input.jpg'],
      };

      await createVolcengineImage(payload, options);

      expect(mockGenerate).toHaveBeenCalledWith(
        expect.objectContaining({
          image: ['https://example.com/input.jpg'],
        }),
      );
    });

    it('should remove image input when array is empty', async () => {
      const mockResponse = {
        data: [{ url: 'https://example.com/test.jpg' }],
      };
      mockGenerate.mockResolvedValue(mockResponse);

      payload.params = {
        prompt: 'test prompt',
        imageUrls: [],
      };

      await createVolcengineImage(payload, options);

      expect(mockGenerate).toHaveBeenCalledWith({
        model: 'doubao-seedream-3-0-t2i',
        watermark: false,
        prompt: 'test prompt',
      });
    });

    it('should remove image input when value is null', async () => {
      const mockResponse = {
        data: [{ url: 'https://example.com/test.jpg' }],
      };
      mockGenerate.mockResolvedValue(mockResponse);

      payload.params = {
        prompt: 'test prompt',
        imageUrl: null,
      };

      await createVolcengineImage(payload, options);

      expect(mockGenerate).toHaveBeenCalledWith({
        model: 'doubao-seedream-3-0-t2i',
        watermark: false,
        prompt: 'test prompt',
      });
    });

    it('should remove image input when value is undefined', async () => {
      const mockResponse = {
        data: [{ url: 'https://example.com/test.jpg' }],
      };
      mockGenerate.mockResolvedValue(mockResponse);

      payload.params = {
        prompt: 'test prompt',
        imageUrl: undefined,
      };

      await createVolcengineImage(payload, options);

      expect(mockGenerate).toHaveBeenCalledWith({
        model: 'doubao-seedream-3-0-t2i',
        watermark: false,
        prompt: 'test prompt',
      });
    });
  });

  describe('client configuration', () => {
    it('should use provided baseURL when specified', async () => {
      const mockResponse = {
        data: [{ url: 'https://example.com/test.jpg' }],
      };
      mockGenerate.mockResolvedValue(mockResponse);

      options.baseURL = 'https://custom-endpoint.com/api/v1';

      await createVolcengineImage(payload, options);

      // Verify OpenAI constructor was called with custom baseURL
      const OpenAI = await import('openai');
      expect(OpenAI.default).toHaveBeenCalledWith({
        apiKey: 'test-api-key',
        baseURL: 'https://custom-endpoint.com/api/v1',
      });
    });

    it('should use default baseURL when not provided', async () => {
      const mockResponse = {
        data: [{ url: 'https://example.com/test.jpg' }],
      };
      mockGenerate.mockResolvedValue(mockResponse);

      await createVolcengineImage(payload, options);

      // Verify OpenAI constructor was called with default baseURL
      const OpenAI = await import('openai');
      expect(OpenAI.default).toHaveBeenCalledWith({
        apiKey: 'test-api-key',
        baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
      });
    });

    it('should set watermark to false by default', async () => {
      const mockResponse = {
        data: [{ url: 'https://example.com/test.jpg' }],
      };
      mockGenerate.mockResolvedValue(mockResponse);

      await createVolcengineImage(payload, options);

      expect(mockGenerate).toHaveBeenCalledWith(
        expect.objectContaining({
          watermark: false,
        }),
      );
    });
  });

  describe('size extraction', () => {
    it('should extract dimensions from size string format', async () => {
      const mockResponse = {
        data: [
          {
            url: 'https://example.com/test.jpg',
            size: '1920x1080',
          },
        ],
      };
      mockGenerate.mockResolvedValue(mockResponse);

      const result = await createVolcengineImage(payload, options);

      expect(result.width).toBe(1920);
      expect(result.height).toBe(1080);
    });

    it('should handle malformed size string', async () => {
      const mockResponse = {
        data: [
          {
            url: 'https://example.com/test.jpg',
            size: 'invalid-size-format',
          },
        ],
      };
      mockGenerate.mockResolvedValue(mockResponse);

      const result = await createVolcengineImage(payload, options);

      expect(result.width).toBeUndefined();
      expect(result.height).toBeUndefined();
    });

    it('should handle missing size property', async () => {
      const mockResponse = {
        data: [
          {
            url: 'https://example.com/test.jpg',
          },
        ],
      };
      mockGenerate.mockResolvedValue(mockResponse);

      const result = await createVolcengineImage(payload, options);

      expect(result.width).toBeUndefined();
      expect(result.height).toBeUndefined();
    });
  });

  describe('error handling', () => {
    it('should throw error when response is null', async () => {
      mockGenerate.mockResolvedValue(null);

      await expect(createVolcengineImage(payload, options)).rejects.toThrow(
        'Invalid response: missing or empty data array',
      );
    });

    it('should throw error when response.data is missing', async () => {
      mockGenerate.mockResolvedValue({});

      await expect(createVolcengineImage(payload, options)).rejects.toThrow(
        'Invalid response: missing or empty data array',
      );
    });

    it('should throw error when response.data is not an array', async () => {
      mockGenerate.mockResolvedValue({
        data: 'not-an-array',
      });

      await expect(createVolcengineImage(payload, options)).rejects.toThrow(
        'Invalid response: missing or empty data array',
      );
    });

    it('should throw error when response.data is empty array', async () => {
      mockGenerate.mockResolvedValue({
        data: [],
      });

      await expect(createVolcengineImage(payload, options)).rejects.toThrow(
        'Invalid response: missing or empty data array',
      );
    });

    it('should throw error when first data item is null', async () => {
      mockGenerate.mockResolvedValue({
        data: [null],
      });

      await expect(createVolcengineImage(payload, options)).rejects.toThrow(
        'Invalid response: first data item is null or undefined',
      );
    });

    it('should throw error when first data item is undefined', async () => {
      mockGenerate.mockResolvedValue({
        data: [undefined],
      });

      await expect(createVolcengineImage(payload, options)).rejects.toThrow(
        'Invalid response: first data item is null or undefined',
      );
    });

    it('should throw error when image data has neither url nor b64_json', async () => {
      mockGenerate.mockResolvedValue({
        data: [
          {
            // Missing both url and b64_json
            metadata: 'some-metadata',
          },
        ],
      });

      await expect(createVolcengineImage(payload, options)).rejects.toThrow(
        'Invalid response: missing both b64_json and url fields',
      );
    });

    it('should throw error when image data has empty url and no b64_json', async () => {
      mockGenerate.mockResolvedValue({
        data: [
          {
            url: '',
            // No b64_json field
          },
        ],
      });

      await expect(createVolcengineImage(payload, options)).rejects.toThrow(
        'Invalid response: missing both b64_json and url fields',
      );
    });
  });

  describe('complex scenarios', () => {
    it('should handle all parameter mappings together', async () => {
      const mockResponse = {
        data: [
          {
            b64_json: 'mock-base64-data',
            size: '2048x1536',
          },
        ],
      };
      mockGenerate.mockResolvedValue(mockResponse);

      payload.params = {
        prompt: 'complex test prompt',
        cfg: 5.5,
        imageUrls: ['https://example.com/input1.jpg', 'https://example.com/input2.jpg'],
        seed: 42,
        size: '1024x1024',
      };

      const result = await createVolcengineImage(payload, options);

      expect(mockGenerate).toHaveBeenCalledWith({
        model: 'doubao-seedream-3-0-t2i',
        watermark: false,
        prompt: 'complex test prompt',
        guidance_scale: 5.5,
        image: ['https://example.com/input1.jpg', 'https://example.com/input2.jpg'],
        seed: 42,
        size: '1024x1024',
      });

      expect(result).toEqual({
        imageUrl: 'data:image/jpeg;base64,mock-base64-data',
        width: 2048,
        height: 1536,
      });
    });

    it('should prioritize b64_json over url when both are present', async () => {
      const mockResponse = {
        data: [
          {
            url: 'https://example.com/should-be-ignored.jpg',
            b64_json: 'base64-data-should-be-used',
            size: '800x600',
          },
        ],
      };
      mockGenerate.mockResolvedValue(mockResponse);

      const result = await createVolcengineImage(payload, options);

      expect(result.imageUrl).toBe('data:image/jpeg;base64,base64-data-should-be-used');
    });
  });
});
