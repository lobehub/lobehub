// @vitest-environment node
import { fal } from '@fal-ai/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CreateImagePayload } from '../../types';
import { LobeFalAI } from './index';

// Mock the fal client
vi.mock('@fal-ai/client', () => ({
  fal: {
    config: vi.fn(),
    subscribe: vi.fn(),
  },
}));

// Get the mocked fal instance
const mockFal = vi.mocked(fal);

// Mock the console.error to avoid polluting test output
vi.spyOn(console, 'error').mockImplementation(() => {});

const provider = 'fal';
const bizErrorType = 'ProviderBizError';
const invalidErrorType = 'InvalidProviderAPIKey';

let instance: LobeFalAI;

beforeEach(() => {
  vi.clearAllMocks();
  instance = new LobeFalAI({ apiKey: 'test-api-key' });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('LobeFalAI', () => {
  describe('init', () => {
    it('should correctly initialize with an API key', () => {
      const instance = new LobeFalAI({ apiKey: 'test_api_key' });
      expect(instance).toBeInstanceOf(LobeFalAI);
      expect(mockFal.config).toHaveBeenCalledWith({
        credentials: 'test_api_key',
      });
    });

    it('should throw InvalidProviderAPIKey if no apiKey is provided', () => {
      expect(() => {
        new LobeFalAI({});
      }).toThrow();
    });

    it('should throw InvalidProviderAPIKey if apiKey is undefined', () => {
      expect(() => {
        new LobeFalAI({ apiKey: undefined });
      }).toThrow();
    });
  });

  describe('createImage', () => {
    it('should create image successfully with basic parameters', async () => {
      // Arrange
      const mockImageResponse = {
        requestId: 'test-request-id',
        data: {
          images: [
            {
              url: 'https://example.com/image.jpg',
              width: 1024,
              height: 1024,
            },
          ],
        },
      };
      mockFal.subscribe.mockResolvedValue(mockImageResponse as any);

      const payload: CreateImagePayload = {
        model: 'flux/dev',
        params: {
          prompt: 'A beautiful landscape',
          width: 1024,
          height: 1024,
        },
      };

      // Act
      const result = await instance.createImage(payload);

      // Assert
      expect(mockFal.subscribe).toHaveBeenCalledWith('fal-ai/flux/dev', {
        input: {
          enable_safety_checker: false,
          num_images: 1,
          prompt: 'A beautiful landscape',
          image_size: {
            width: 1024,
            height: 1024,
          },
        },
      });
      expect(result).toEqual({
        imageUrl: 'https://example.com/image.jpg',
        width: 1024,
        height: 1024,
      });
    });

    it('should map standard parameters to fal-specific parameters', async () => {
      // Arrange
      const mockImageResponse = {
        requestId: 'test-request-id',
        data: {
          images: [
            {
              url: 'https://example.com/image.jpg',
              width: 512,
              height: 512,
            },
          ],
        },
      };
      mockFal.subscribe.mockResolvedValue(mockImageResponse as any);

      const payload: CreateImagePayload = {
        model: 'flux/dev',
        params: {
          prompt: 'Test image',
          width: 512,
          height: 512,
          steps: 20,
          cfg: 7.5,
          imageUrl: 'https://example.com/input.jpg',
        },
      };

      // Act
      await instance.createImage(payload);

      // Assert
      expect(mockFal.subscribe).toHaveBeenCalledWith('fal-ai/flux/dev', {
        input: {
          enable_safety_checker: false,
          num_images: 1,
          prompt: 'Test image',
          image_size: {
            width: 512,
            height: 512,
          },
          num_inference_steps: 20,
          guidance_scale: 7.5,
          image_url: 'https://example.com/input.jpg',
        },
      });
    });

    it('should map imageUrls parameter to image_urls', async () => {
      // Arrange
      const mockImageResponse = {
        requestId: 'test-request-id',
        data: {
          images: [
            {
              url: 'https://example.com/image.jpg',
              width: 512,
              height: 512,
            },
          ],
        },
      };
      mockFal.subscribe.mockResolvedValue(mockImageResponse as any);

      const payload: CreateImagePayload = {
        model: 'flux/dev',
        params: {
          prompt: 'Test with multiple images',
          imageUrls: ['https://example.com/input1.jpg', 'https://example.com/input2.jpg'],
        },
      };

      // Act
      await instance.createImage(payload);

      // Assert
      expect(mockFal.subscribe).toHaveBeenCalledWith('fal-ai/flux/dev', {
        input: {
          enable_safety_checker: false,
          num_images: 1,
          prompt: 'Test with multiple images',
          image_urls: ['https://example.com/input1.jpg', 'https://example.com/input2.jpg'],
        },
      });
    });

    it('should handle parameters without width and height', async () => {
      // Arrange
      const mockImageResponse = {
        requestId: 'test-request-id',
        data: {
          images: [
            {
              url: 'https://example.com/image.jpg',
              width: 1024,
              height: 1024,
            },
          ],
        },
      };
      mockFal.subscribe.mockResolvedValue(mockImageResponse as any);

      const payload: CreateImagePayload = {
        model: 'flux/schnell',
        params: {
          prompt: 'Simple test',
          steps: 10,
        },
      };

      // Act
      await instance.createImage(payload);

      // Assert
      expect(mockFal.subscribe).toHaveBeenCalledWith('fal-ai/flux/schnell', {
        input: {
          enable_safety_checker: false,
          num_images: 1,
          prompt: 'Simple test',
          num_inference_steps: 10,
        },
      });
    });

    it('should handle custom parameters that are not in the mapping', async () => {
      // Arrange
      const mockImageResponse = {
        requestId: 'test-request-id',
        data: {
          images: [
            {
              url: 'https://example.com/image.jpg',
              width: 768,
              height: 768,
            },
          ],
        },
      };
      mockFal.subscribe.mockResolvedValue(mockImageResponse as any);

      const payload: CreateImagePayload = {
        model: 'flux/dev',
        params: {
          prompt: 'Custom test',
          width: 768,
          height: 768,
          seed: 12345,
        } as any, // Use any to allow custom parameters
      };

      // Act
      await instance.createImage(payload);

      // Assert
      expect(mockFal.subscribe).toHaveBeenCalledWith('fal-ai/flux/dev', {
        input: {
          enable_safety_checker: false,
          num_images: 1,
          prompt: 'Custom test',
          image_size: {
            width: 768,
            height: 768,
          },
          seed: 12345,
        },
      });
    });

    it('should return only imageUrl when width and height are not provided in response', async () => {
      // Arrange
      const mockImageResponse = {
        requestId: 'test-request-id',
        data: {
          images: [
            {
              url: 'https://example.com/image.jpg',
            },
          ],
        },
      };
      mockFal.subscribe.mockResolvedValue(mockImageResponse as any);

      const payload: CreateImagePayload = {
        model: 'flux/dev',
        params: {
          prompt: 'Test without dimensions',
        },
      };

      // Act
      const result = await instance.createImage(payload);

      // Assert
      expect(result).toEqual({
        imageUrl: 'https://example.com/image.jpg',
      });
    });

    describe('Error handling', () => {
      it('should throw InvalidProviderAPIKey on 401 error', async () => {
        // Arrange
        const apiError = new Error('Unauthorized') as Error & { status: number };
        apiError.status = 401;
        mockFal.subscribe.mockRejectedValue(apiError);

        const payload: CreateImagePayload = {
          model: 'flux/dev',
          params: {
            prompt: 'Test image',
          },
        };

        // Act & Assert
        await expect(instance.createImage(payload)).rejects.toEqual({
          error: { error: apiError },
          errorType: invalidErrorType,
        });
      });

      it('should throw ProviderBizError on other errors', async () => {
        // Arrange
        const apiError = new Error('Some other error');
        mockFal.subscribe.mockRejectedValue(apiError);

        const payload: CreateImagePayload = {
          model: 'flux/dev',
          params: {
            prompt: 'Test image',
          },
        };

        // Act & Assert
        await expect(instance.createImage(payload)).rejects.toEqual({
          error: { error: apiError },
          errorType: bizErrorType,
        });
      });

      it('should throw ProviderBizError on non-401 status errors', async () => {
        // Arrange
        const apiError = new Error('Server error') as Error & { status: number };
        apiError.status = 500;
        mockFal.subscribe.mockRejectedValue(apiError);

        const payload: CreateImagePayload = {
          model: 'flux/dev',
          params: {
            prompt: 'Test image',
          },
        };

        // Act & Assert
        await expect(instance.createImage(payload)).rejects.toEqual({
          error: { error: apiError },
          errorType: bizErrorType,
        });
      });
    });

    describe('Parameter filtering', () => {
      it('should filter out null values', async () => {
        // Arrange
        const mockImageResponse = {
          requestId: 'test-request-id',
          data: {
            images: [
              {
                url: 'https://example.com/image.jpg',
              },
            ],
          },
        };
        mockFal.subscribe.mockResolvedValue(mockImageResponse as any);

        const payload: CreateImagePayload = {
          model: 'flux/dev',
          params: {
            prompt: 'Test with null values',
            imageUrl: null,
            steps: null,
            cfg: 7.5,
          } as any,
        };

        // Act
        await instance.createImage(payload);

        // Assert
        expect(mockFal.subscribe).toHaveBeenCalledWith('fal-ai/flux/dev', {
          input: {
            enable_safety_checker: false,
            num_images: 1,
            prompt: 'Test with null values',
            guidance_scale: 7.5,
          },
        });
      });

      it('should filter out undefined values', async () => {
        // Arrange
        const mockImageResponse = {
          requestId: 'test-request-id',
          data: {
            images: [
              {
                url: 'https://example.com/image.jpg',
              },
            ],
          },
        };
        mockFal.subscribe.mockResolvedValue(mockImageResponse as any);

        const payload: CreateImagePayload = {
          model: 'flux/dev',
          params: {
            prompt: 'Test with undefined values',
            imageUrl: undefined,
            steps: undefined,
            cfg: 5,
          } as any,
        };

        // Act
        await instance.createImage(payload);

        // Assert
        expect(mockFal.subscribe).toHaveBeenCalledWith('fal-ai/flux/dev', {
          input: {
            enable_safety_checker: false,
            num_images: 1,
            prompt: 'Test with undefined values',
            guidance_scale: 5,
          },
        });
      });

      it('should filter out empty arrays', async () => {
        // Arrange
        const mockImageResponse = {
          requestId: 'test-request-id',
          data: {
            images: [
              {
                url: 'https://example.com/image.jpg',
              },
            ],
          },
        };
        mockFal.subscribe.mockResolvedValue(mockImageResponse as any);

        const payload: CreateImagePayload = {
          model: 'flux/dev',
          params: {
            prompt: 'Test with empty arrays',
            imageUrls: [],
            steps: 20,
          } as any,
        };

        // Act
        await instance.createImage(payload);

        // Assert
        expect(mockFal.subscribe).toHaveBeenCalledWith('fal-ai/flux/dev', {
          input: {
            enable_safety_checker: false,
            num_images: 1,
            prompt: 'Test with empty arrays',
            num_inference_steps: 20,
          },
        });
      });
    });

    describe('Seedream and Hunyuan special endpoints', () => {
      it('should use text-to-image endpoint when no imageUrls provided', async () => {
        // Arrange
        const mockImageResponse = {
          requestId: 'test-request-id',
          data: {
            images: [
              {
                url: 'https://example.com/generated.jpg',
                width: 1024,
                height: 1024,
              },
            ],
          },
        };
        mockFal.subscribe.mockResolvedValue(mockImageResponse as any);

        const payload: CreateImagePayload = {
          model: 'bytedance/seedream/v4',
          params: {
            prompt: 'A beautiful landscape',
            width: 1024,
            height: 1024,
          },
        };

        // Act
        await instance.createImage(payload);

        // Assert
        expect(mockFal.subscribe).toHaveBeenCalledWith(
          'fal-ai/bytedance/seedream/v4/text-to-image',
          {
            input: {
              enable_safety_checker: false,
              num_images: 1,
              prompt: 'A beautiful landscape',
              image_size: {
                width: 1024,
                height: 1024,
              },
            },
          },
        );
      });

      it('should use edit endpoint when imageUrls is provided', async () => {
        // Arrange
        const mockImageResponse = {
          requestId: 'test-request-id',
          data: {
            images: [
              {
                url: 'https://example.com/edited.jpg',
                width: 1024,
                height: 1024,
              },
            ],
          },
        };
        mockFal.subscribe.mockResolvedValue(mockImageResponse as any);

        const payload: CreateImagePayload = {
          model: 'bytedance/seedream/v4',
          params: {
            prompt: 'Edit this image to add a sunset',
            imageUrls: ['https://example.com/input.jpg'],
            width: 1024,
            height: 1024,
          },
        };

        // Act
        await instance.createImage(payload);

        // Assert
        expect(mockFal.subscribe).toHaveBeenCalledWith('fal-ai/bytedance/seedream/v4/edit', {
          input: {
            enable_safety_checker: false,
            num_images: 1,
            prompt: 'Edit this image to add a sunset',
            image_urls: ['https://example.com/input.jpg'],
            image_size: {
              width: 1024,
              height: 1024,
            },
          },
        });
      });

      it('should use edit endpoint when multiple imageUrls are provided', async () => {
        // Arrange
        const mockImageResponse = {
          requestId: 'test-request-id',
          data: {
            images: [
              {
                url: 'https://example.com/edited.jpg',
                width: 1024,
                height: 1024,
              },
            ],
          },
        };
        mockFal.subscribe.mockResolvedValue(mockImageResponse as any);

        const payload: CreateImagePayload = {
          model: 'bytedance/seedream/v4',
          params: {
            prompt: 'Combine these images',
            imageUrls: ['https://example.com/input1.jpg', 'https://example.com/input2.jpg'],
            width: 1024,
            height: 1024,
          },
        };

        // Act
        await instance.createImage(payload);

        // Assert
        expect(mockFal.subscribe).toHaveBeenCalledWith('fal-ai/bytedance/seedream/v4/edit', {
          input: {
            enable_safety_checker: false,
            num_images: 1,
            prompt: 'Combine these images',
            image_urls: ['https://example.com/input1.jpg', 'https://example.com/input2.jpg'],
            image_size: {
              width: 1024,
              height: 1024,
            },
          },
        });
      });

      it('should use text-to-image endpoint when imageUrls is empty array', async () => {
        // Arrange
        const mockImageResponse = {
          requestId: 'test-request-id',
          data: {
            images: [
              {
                url: 'https://example.com/generated.jpg',
                width: 1024,
                height: 1024,
              },
            ],
          },
        };
        mockFal.subscribe.mockResolvedValue(mockImageResponse as any);

        const payload: CreateImagePayload = {
          model: 'bytedance/seedream/v4',
          params: {
            prompt: 'Generate new image',
            imageUrls: [],
            width: 1024,
            height: 1024,
          } as any,
        };

        // Act
        await instance.createImage(payload);

        // Assert
        expect(mockFal.subscribe).toHaveBeenCalledWith(
          'fal-ai/bytedance/seedream/v4/text-to-image',
          {
            input: {
              enable_safety_checker: false,
              num_images: 1,
              prompt: 'Generate new image',
              image_size: {
                width: 1024,
                height: 1024,
              },
            },
          },
        );
      });

      it('should handle seedream v4 with other parameters', async () => {
        // Arrange
        const mockImageResponse = {
          requestId: 'test-request-id',
          data: {
            images: [
              {
                url: 'https://example.com/edited.jpg',
              },
            ],
          },
        };
        mockFal.subscribe.mockResolvedValue(mockImageResponse as any);

        const payload: CreateImagePayload = {
          model: 'bytedance/seedream/v4',
          params: {
            prompt: 'Edit with custom settings',
            imageUrls: ['https://example.com/input.jpg'],
            steps: 30,
            cfg: 8,
          },
        };

        // Act
        await instance.createImage(payload);

        // Assert
        expect(mockFal.subscribe).toHaveBeenCalledWith('fal-ai/bytedance/seedream/v4/edit', {
          input: {
            enable_safety_checker: false,
            num_images: 1,
            prompt: 'Edit with custom settings',
            image_urls: ['https://example.com/input.jpg'],
            num_inference_steps: 30,
            guidance_scale: 8,
          },
        });
      });

      it('should use text-to-image endpoint for seedream v4.5 when no imageUrls provided', async () => {
        // Arrange
        const mockImageResponse = {
          requestId: 'test-request-id',
          data: {
            images: [
              {
                url: 'https://example.com/generated.jpg',
                width: 2048,
                height: 2048,
              },
            ],
          },
        };
        mockFal.subscribe.mockResolvedValue(mockImageResponse as any);

        const payload: CreateImagePayload = {
          model: 'bytedance/seedream/v4.5',
          params: {
            prompt: 'A beautiful landscape',
            width: 2048,
            height: 2048,
          },
        };

        // Act
        await instance.createImage(payload);

        // Assert
        expect(mockFal.subscribe).toHaveBeenCalledWith(
          'fal-ai/bytedance/seedream/v4.5/text-to-image',
          {
            input: {
              enable_safety_checker: false,
              num_images: 1,
              prompt: 'A beautiful landscape',
              image_size: {
                width: 2048,
                height: 2048,
              },
            },
          },
        );
      });

      it('should use edit endpoint for seedream v4.5 when imageUrls is provided', async () => {
        // Arrange
        const mockImageResponse = {
          requestId: 'test-request-id',
          data: {
            images: [
              {
                url: 'https://example.com/edited.jpg',
                width: 2048,
                height: 2048,
              },
            ],
          },
        };
        mockFal.subscribe.mockResolvedValue(mockImageResponse as any);

        const payload: CreateImagePayload = {
          model: 'bytedance/seedream/v4.5',
          params: {
            prompt: 'Edit this image',
            imageUrls: ['https://example.com/input.jpg'],
            width: 2048,
            height: 2048,
          },
        };

        // Act
        await instance.createImage(payload);

        // Assert
        expect(mockFal.subscribe).toHaveBeenCalledWith('fal-ai/bytedance/seedream/v4.5/edit', {
          input: {
            enable_safety_checker: false,
            num_images: 1,
            prompt: 'Edit this image',
            image_urls: ['https://example.com/input.jpg'],
            image_size: {
              width: 2048,
              height: 2048,
            },
          },
        });
      });

      it('should use text-to-image endpoint for hunyuan-image v3 when no imageUrls provided', async () => {
        // Arrange
        const mockImageResponse = {
          requestId: 'test-request-id',
          data: {
            images: [
              {
                url: 'https://example.com/generated.jpg',
                width: 1024,
                height: 1024,
              },
            ],
          },
        };
        mockFal.subscribe.mockResolvedValue(mockImageResponse as any);

        const payload: CreateImagePayload = {
          model: 'hunyuan-image/v3',
          params: {
            prompt: 'A scenic mountain view',
            width: 1024,
            height: 1024,
          },
        };

        // Act
        await instance.createImage(payload);

        // Assert
        expect(mockFal.subscribe).toHaveBeenCalledWith('fal-ai/hunyuan-image/v3/text-to-image', {
          input: {
            enable_safety_checker: false,
            num_images: 1,
            prompt: 'A scenic mountain view',
            image_size: {
              width: 1024,
              height: 1024,
            },
          },
        });
      });

      it('should use edit endpoint for hunyuan-image v3 when imageUrls is provided', async () => {
        // Arrange
        const mockImageResponse = {
          requestId: 'test-request-id',
          data: {
            images: [
              {
                url: 'https://example.com/edited.jpg',
                width: 1024,
                height: 1024,
              },
            ],
          },
        };
        mockFal.subscribe.mockResolvedValue(mockImageResponse as any);

        const payload: CreateImagePayload = {
          model: 'hunyuan-image/v3',
          params: {
            prompt: 'Edit this image',
            imageUrls: ['https://example.com/input.jpg'],
            width: 1024,
            height: 1024,
          },
        };

        // Act
        await instance.createImage(payload);

        // Assert
        expect(mockFal.subscribe).toHaveBeenCalledWith('fal-ai/hunyuan-image/v3/edit', {
          input: {
            enable_safety_checker: false,
            num_images: 1,
            prompt: 'Edit this image',
            image_urls: ['https://example.com/input.jpg'],
            image_size: {
              width: 1024,
              height: 1024,
            },
          },
        });
      });
    });

    describe('Edge cases', () => {
      it('should handle empty params object', async () => {
        // Arrange
        const mockImageResponse = {
          requestId: 'test-request-id',
          data: {
            images: [
              {
                url: 'https://example.com/image.jpg',
              },
            ],
          },
        };
        mockFal.subscribe.mockResolvedValue(mockImageResponse as any);

        const payload: CreateImagePayload = {
          model: 'flux/dev',
          params: {
            prompt: 'Empty params test',
          },
        };

        // Act
        const result = await instance.createImage(payload);

        // Assert
        expect(mockFal.subscribe).toHaveBeenCalledWith('fal-ai/flux/dev', {
          input: {
            enable_safety_checker: false,
            num_images: 1,
            prompt: 'Empty params test',
          },
        });
        expect(result).toEqual({
          imageUrl: 'https://example.com/image.jpg',
        });
      });

      it('should handle model with different format', async () => {
        // Arrange
        const mockImageResponse = {
          requestId: 'test-request-id',
          data: {
            images: [
              {
                url: 'https://example.com/image.jpg',
              },
            ],
          },
        };
        mockFal.subscribe.mockResolvedValue(mockImageResponse as any);

        const payload: CreateImagePayload = {
          model: 'some-custom-model',
          params: {
            prompt: 'Test with custom model',
          },
        };

        // Act
        await instance.createImage(payload);

        // Assert
        expect(mockFal.subscribe).toHaveBeenCalledWith('fal-ai/some-custom-model', {
          input: {
            enable_safety_checker: false,
            num_images: 1,
            prompt: 'Test with custom model',
          },
        });
      });

      it('should handle response with multiple images (take first one)', async () => {
        // Arrange
        const mockImageResponse = {
          requestId: 'test-request-id',
          data: {
            images: [
              {
                url: 'https://example.com/image1.jpg',
                width: 1024,
                height: 1024,
              },
              {
                url: 'https://example.com/image2.jpg',
                width: 512,
                height: 512,
              },
            ],
          },
        };
        mockFal.subscribe.mockResolvedValue(mockImageResponse as any);

        const payload: CreateImagePayload = {
          model: 'flux/dev',
          params: {
            prompt: 'Multiple images test',
          },
        };

        // Act
        const result = await instance.createImage(payload);

        // Assert
        expect(result).toEqual({
          imageUrl: 'https://example.com/image1.jpg',
          width: 1024,
          height: 1024,
        });
      });
    });
  });
});
