// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CreateImagePayload } from '../../types/image';
import { createBflImage } from './createImage';
import { BflStatusResponse } from './types';

// Mock external dependencies
vi.mock('@lobechat/utils', () => ({
  imageUrlToBase64: vi.fn(),
}));

vi.mock('../../utils/uriParser', () => ({
  parseDataUri: vi.fn(),
}));

vi.mock('../../utils/asyncifyPolling', () => ({
  asyncifyPolling: vi.fn(),
}));

// Mock fetch
global.fetch = vi.fn();
const mockFetch = vi.mocked(fetch);

// Mock the console.error to avoid polluting test output
vi.spyOn(console, 'error').mockImplementation(() => {});

const mockOptions = {
  apiKey: 'test-api-key',
  provider: 'bfl' as const,
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('createBflImage', () => {
  describe('Parameter mapping and defaults', () => {
    it('should map standard parameters to BFL-specific parameters', async () => {
      // Arrange
      const { asyncifyPolling } = await import('../../utils/asyncifyPolling');
      const mockAsyncifyPolling = vi.mocked(asyncifyPolling);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 'task-123',
            polling_url: 'https://api.bfl.ai/v1/get_result?id=task-123',
          }),
      } as Response);

      mockAsyncifyPolling.mockResolvedValue({
        imageUrl: 'https://example.com/result.jpg',
      });

      const payload: CreateImagePayload = {
        model: 'flux-dev',
        params: {
          prompt: 'A beautiful landscape',
          aspectRatio: '16:9',
          cfg: 7.5,
          steps: 20,
          seed: 12345,
        },
      };

      // Act
      await createBflImage(payload, mockOptions);

      // Assert
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.bfl.ai/v1/flux-dev',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-key': 'test-api-key',
          },
          body: JSON.stringify({
            output_format: 'png',
            safety_tolerance: 6,
            prompt: 'A beautiful landscape',
            aspect_ratio: '16:9',
            guidance: 7.5,
            steps: 20,
            seed: 12345,
          }),
        }),
      );
    });

    it('should add raw: true for ultra models', async () => {
      // Arrange
      const { asyncifyPolling } = await import('../../utils/asyncifyPolling');
      const mockAsyncifyPolling = vi.mocked(asyncifyPolling);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 'task-123',
            polling_url: 'https://api.bfl.ai/v1/get_result?id=task-123',
          }),
      } as Response);

      mockAsyncifyPolling.mockResolvedValue({
        imageUrl: 'https://example.com/result.jpg',
      });

      const payload: CreateImagePayload = {
        model: 'flux-pro-1.1-ultra',
        params: {
          prompt: 'Ultra quality image',
        },
      };

      // Act
      await createBflImage(payload, mockOptions);

      // Assert
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.bfl.ai/v1/flux-pro-1.1-ultra',
        expect.objectContaining({
          body: JSON.stringify({
            output_format: 'png',
            safety_tolerance: 6,
            raw: true,
            prompt: 'Ultra quality image',
          }),
        }),
      );
    });

    it('should filter out undefined values', async () => {
      // Arrange
      const { asyncifyPolling } = await import('../../utils/asyncifyPolling');
      const mockAsyncifyPolling = vi.mocked(asyncifyPolling);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 'task-123',
            polling_url: 'https://api.bfl.ai/v1/get_result?id=task-123',
          }),
      } as Response);

      mockAsyncifyPolling.mockResolvedValue({
        imageUrl: 'https://example.com/result.jpg',
      });

      const payload: CreateImagePayload = {
        model: 'flux-dev',
        params: {
          prompt: 'Test image',
          cfg: undefined,
          seed: 12345,
          steps: undefined,
        } as any,
      };

      // Act
      await createBflImage(payload, mockOptions);

      // Assert
      const callArgs = mockFetch.mock.calls[0][1];
      const requestBody = JSON.parse(callArgs?.body as string);

      expect(requestBody).toEqual({
        output_format: 'png',
        safety_tolerance: 6,
        prompt: 'Test image',
        seed: 12345,
      });

      expect(requestBody).not.toHaveProperty('guidance');
      expect(requestBody).not.toHaveProperty('steps');
    });
  });

  describe('Image URL handling', () => {
    it('should convert single imageUrl to image_prompt base64', async () => {
      // Arrange
      const { parseDataUri } = await import('../../utils/uriParser');
      const { imageUrlToBase64 } = await import('@lobechat/utils');
      const { asyncifyPolling } = await import('../../utils/asyncifyPolling');

      const mockParseDataUri = vi.mocked(parseDataUri);
      const mockImageUrlToBase64 = vi.mocked(imageUrlToBase64);
      const mockAsyncifyPolling = vi.mocked(asyncifyPolling);

      mockParseDataUri.mockReturnValue({ type: 'url', base64: null, mimeType: null });
      mockImageUrlToBase64.mockResolvedValue({
        base64: 'base64EncodedImage',
        mimeType: 'image/jpeg',
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 'task-123',
            polling_url: 'https://api.bfl.ai/v1/get_result?id=task-123',
          }),
      } as Response);

      mockAsyncifyPolling.mockResolvedValue({
        imageUrl: 'https://example.com/result.jpg',
      });

      const payload: CreateImagePayload = {
        model: 'flux-pro-1.1',
        params: {
          prompt: 'Transform this image',
          imageUrl: 'https://example.com/input.jpg',
        },
      };

      // Act
      await createBflImage(payload, mockOptions);

      // Assert
      expect(mockParseDataUri).toHaveBeenCalledWith('https://example.com/input.jpg');
      expect(mockImageUrlToBase64).toHaveBeenCalledWith('https://example.com/input.jpg');

      const callArgs = mockFetch.mock.calls[0][1];
      const requestBody = JSON.parse(callArgs?.body as string);

      expect(requestBody).toEqual({
        output_format: 'png',
        safety_tolerance: 6,
        prompt: 'Transform this image',
        image_prompt: 'base64EncodedImage',
      });

      expect(requestBody).not.toHaveProperty('imageUrl');
    });

    it('should handle base64 imageUrl directly', async () => {
      // Arrange
      const { parseDataUri } = await import('../../utils/uriParser');
      const { asyncifyPolling } = await import('../../utils/asyncifyPolling');

      const mockParseDataUri = vi.mocked(parseDataUri);
      const mockAsyncifyPolling = vi.mocked(asyncifyPolling);

      mockParseDataUri.mockReturnValue({
        type: 'base64',
        base64: '/9j/4AAQSkZJRgABAQEAYABgAAD',
        mimeType: 'image/jpeg',
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 'task-123',
            polling_url: 'https://api.bfl.ai/v1/get_result?id=task-123',
          }),
      } as Response);

      mockAsyncifyPolling.mockResolvedValue({
        imageUrl: 'https://example.com/result.jpg',
      });

      const base64Image = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD';
      const payload: CreateImagePayload = {
        model: 'flux-pro-1.1',
        params: {
          prompt: 'Transform this image',
          imageUrl: base64Image,
        },
      };

      // Act
      await createBflImage(payload, mockOptions);

      // Assert
      const callArgs = mockFetch.mock.calls[0][1];
      const requestBody = JSON.parse(callArgs?.body as string);

      expect(requestBody.image_prompt).toBe('/9j/4AAQSkZJRgABAQEAYABgAAD');
    });

    it('should convert multiple imageUrls for Kontext models', async () => {
      // Arrange
      const { parseDataUri } = await import('../../utils/uriParser');
      const { imageUrlToBase64 } = await import('@lobechat/utils');
      const { asyncifyPolling } = await import('../../utils/asyncifyPolling');

      const mockParseDataUri = vi.mocked(parseDataUri);
      const mockImageUrlToBase64 = vi.mocked(imageUrlToBase64);
      const mockAsyncifyPolling = vi.mocked(asyncifyPolling);

      mockParseDataUri.mockReturnValue({ type: 'url', base64: null, mimeType: null });
      mockImageUrlToBase64
        .mockResolvedValueOnce({ base64: 'base64image1', mimeType: 'image/jpeg' })
        .mockResolvedValueOnce({ base64: 'base64image2', mimeType: 'image/jpeg' })
        .mockResolvedValueOnce({ base64: 'base64image3', mimeType: 'image/jpeg' });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 'task-123',
            polling_url: 'https://api.bfl.ai/v1/get_result?id=task-123',
          }),
      } as Response);

      mockAsyncifyPolling.mockResolvedValue({
        imageUrl: 'https://example.com/result.jpg',
      });

      const payload: CreateImagePayload = {
        model: 'flux-kontext-pro',
        params: {
          prompt: 'Create variation of these images',
          imageUrls: [
            'https://example.com/input1.jpg',
            'https://example.com/input2.jpg',
            'https://example.com/input3.jpg',
          ],
        },
      };

      // Act
      await createBflImage(payload, mockOptions);

      // Assert
      const callArgs = mockFetch.mock.calls[0][1];
      const requestBody = JSON.parse(callArgs?.body as string);

      expect(requestBody).toEqual({
        output_format: 'png',
        safety_tolerance: 6,
        prompt: 'Create variation of these images',
        input_image: 'base64image1',
        input_image_2: 'base64image2',
        input_image_3: 'base64image3',
      });

      expect(requestBody).not.toHaveProperty('imageUrls');
    });

    it('should limit imageUrls to maximum 4 images', async () => {
      // Arrange
      const { parseDataUri } = await import('../../utils/uriParser');
      const { imageUrlToBase64 } = await import('@lobechat/utils');
      const { asyncifyPolling } = await import('../../utils/asyncifyPolling');

      const mockParseDataUri = vi.mocked(parseDataUri);
      const mockImageUrlToBase64 = vi.mocked(imageUrlToBase64);
      const mockAsyncifyPolling = vi.mocked(asyncifyPolling);

      mockParseDataUri.mockReturnValue({ type: 'url', base64: null, mimeType: null });
      mockImageUrlToBase64
        .mockResolvedValueOnce({ base64: 'base64image1', mimeType: 'image/jpeg' })
        .mockResolvedValueOnce({ base64: 'base64image2', mimeType: 'image/jpeg' })
        .mockResolvedValueOnce({ base64: 'base64image3', mimeType: 'image/jpeg' })
        .mockResolvedValueOnce({ base64: 'base64image4', mimeType: 'image/jpeg' });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 'task-123',
            polling_url: 'https://api.bfl.ai/v1/get_result?id=task-123',
          }),
      } as Response);

      mockAsyncifyPolling.mockResolvedValue({
        imageUrl: 'https://example.com/result.jpg',
      });

      const payload: CreateImagePayload = {
        model: 'flux-kontext-max',
        params: {
          prompt: 'Create variation of these images',
          imageUrls: [
            'https://example.com/input1.jpg',
            'https://example.com/input2.jpg',
            'https://example.com/input3.jpg',
            'https://example.com/input4.jpg',
            'https://example.com/input5.jpg', // This should be ignored
          ],
        },
      };

      // Act
      await createBflImage(payload, mockOptions);

      // Assert
      expect(mockImageUrlToBase64).toHaveBeenCalledTimes(4);

      const callArgs = mockFetch.mock.calls[0][1];
      const requestBody = JSON.parse(callArgs?.body as string);

      expect(requestBody).toEqual({
        output_format: 'png',
        safety_tolerance: 6,
        prompt: 'Create variation of these images',
        input_image: 'base64image1',
        input_image_2: 'base64image2',
        input_image_3: 'base64image3',
        input_image_4: 'base64image4',
      });

      expect(requestBody).not.toHaveProperty('input_image_5');
    });
  });

  describe('Model endpoint mapping', () => {
    it('should map models to correct endpoints', async () => {
      // Arrange
      const { asyncifyPolling } = await import('../../utils/asyncifyPolling');
      const mockAsyncifyPolling = vi.mocked(asyncifyPolling);

      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 'task-123',
            polling_url: 'https://api.bfl.ai/v1/get_result?id=task-123',
          }),
      } as Response);

      mockAsyncifyPolling.mockResolvedValue({
        imageUrl: 'https://example.com/result.jpg',
      });

      const testCases = [
        { model: 'flux-dev', endpoint: '/v1/flux-dev' },
        { model: 'flux-pro', endpoint: '/v1/flux-pro' },
        { model: 'flux-pro-1.1', endpoint: '/v1/flux-pro-1.1' },
        { model: 'flux-pro-1.1-ultra', endpoint: '/v1/flux-pro-1.1-ultra' },
        { model: 'flux-kontext-pro', endpoint: '/v1/flux-kontext-pro' },
        { model: 'flux-kontext-max', endpoint: '/v1/flux-kontext-max' },
      ];

      // Act & Assert
      for (const { model, endpoint } of testCases) {
        vi.clearAllMocks();

        const payload: CreateImagePayload = {
          model,
          params: {
            prompt: `Test image for ${model}`,
          },
        };

        await createBflImage(payload, mockOptions);

        expect(mockFetch).toHaveBeenCalledWith(`https://api.bfl.ai${endpoint}`, expect.any(Object));
      }
    });

    it('should throw error for unsupported model', async () => {
      // Arrange
      const payload: CreateImagePayload = {
        model: 'unsupported-model',
        params: {
          prompt: 'Test image',
        },
      };

      // Act & Assert
      await expect(createBflImage(payload, mockOptions)).rejects.toMatchObject({
        error: expect.objectContaining({
          message: 'Unsupported BFL model: unsupported-model',
        }),
        errorType: 'ModelNotFound',
        provider: 'bfl',
      });
    });

    it('should use custom baseURL when provided', async () => {
      // Arrange
      const { asyncifyPolling } = await import('../../utils/asyncifyPolling');
      const mockAsyncifyPolling = vi.mocked(asyncifyPolling);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 'task-123',
            polling_url: 'https://custom-api.bfl.ai/v1/get_result?id=task-123',
          }),
      } as Response);

      mockAsyncifyPolling.mockResolvedValue({
        imageUrl: 'https://example.com/result.jpg',
      });

      const customOptions = {
        ...mockOptions,
        baseURL: 'https://custom-api.bfl.ai',
      };

      const payload: CreateImagePayload = {
        model: 'flux-dev',
        params: {
          prompt: 'Test with custom URL',
        },
      };

      // Act
      await createBflImage(payload, customOptions);

      // Assert
      expect(mockFetch).toHaveBeenCalledWith(
        'https://custom-api.bfl.ai/v1/flux-dev',
        expect.any(Object),
      );
    });
  });

  describe('Status handling', () => {
    it('should return success when status is Ready with result', async () => {
      // Arrange
      const { asyncifyPolling } = await import('../../utils/asyncifyPolling');
      const mockAsyncifyPolling = vi.mocked(asyncifyPolling);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 'task-123',
            polling_url: 'https://api.bfl.ai/v1/get_result?id=task-123',
          }),
      } as Response);

      // Mock the asyncifyPolling to call checkStatus with Ready status
      mockAsyncifyPolling.mockImplementation(async ({ checkStatus }) => {
        const result = checkStatus({
          id: 'task-123',
          status: BflStatusResponse.Ready,
          result: {
            sample: 'https://example.com/generated-image.jpg',
          },
        });

        if (result.status === 'success') {
          return result.data;
        }
        throw result.error;
      });

      const payload: CreateImagePayload = {
        model: 'flux-dev',
        params: {
          prompt: 'Test successful generation',
        },
      };

      // Act
      const result = await createBflImage(payload, mockOptions);

      // Assert
      expect(result).toEqual({
        imageUrl: 'https://example.com/generated-image.jpg',
      });
    });

    it('should throw error when status is Ready but no result', async () => {
      // Arrange
      const { asyncifyPolling } = await import('../../utils/asyncifyPolling');
      const mockAsyncifyPolling = vi.mocked(asyncifyPolling);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 'task-123',
            polling_url: 'https://api.bfl.ai/v1/get_result?id=task-123',
          }),
      } as Response);

      mockAsyncifyPolling.mockImplementation(async ({ checkStatus }) => {
        const result = checkStatus({
          id: 'task-123',
          status: BflStatusResponse.Ready,
          result: null,
        });

        if (result.status === 'success') {
          return result.data;
        }
        throw result.error;
      });

      const payload: CreateImagePayload = {
        model: 'flux-dev',
        params: {
          prompt: 'Test no result error',
        },
      };

      // Act & Assert
      await expect(createBflImage(payload, mockOptions)).rejects.toMatchObject({
        error: expect.any(Object),
        errorType: 'ProviderBizError',
        provider: 'bfl',
      });
    });

    it('should handle error statuses', async () => {
      // Arrange
      const { asyncifyPolling } = await import('../../utils/asyncifyPolling');
      const mockAsyncifyPolling = vi.mocked(asyncifyPolling);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 'task-123',
            polling_url: 'https://api.bfl.ai/v1/get_result?id=task-123',
          }),
      } as Response);

      const errorStatuses = [
        BflStatusResponse.Error,
        BflStatusResponse.ContentModerated,
        BflStatusResponse.RequestModerated,
      ];

      for (const status of errorStatuses) {
        mockAsyncifyPolling.mockImplementation(async ({ checkStatus }) => {
          const result = checkStatus({
            id: 'task-123',
            status,
            details: { error: 'Test error details' },
          });

          if (result.status === 'success') {
            return result.data;
          }
          throw result.error;
        });

        const payload: CreateImagePayload = {
          model: 'flux-dev',
          params: {
            prompt: `Test ${status} error`,
          },
        };

        // Act & Assert
        await expect(createBflImage(payload, mockOptions)).rejects.toMatchObject({
          error: expect.any(Object),
          errorType: 'ProviderBizError',
          provider: 'bfl',
        });
      }
    });

    it('should handle TaskNotFound status', async () => {
      // Arrange
      const { asyncifyPolling } = await import('../../utils/asyncifyPolling');
      const mockAsyncifyPolling = vi.mocked(asyncifyPolling);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 'task-123',
            polling_url: 'https://api.bfl.ai/v1/get_result?id=task-123',
          }),
      } as Response);

      mockAsyncifyPolling.mockImplementation(async ({ checkStatus }) => {
        const result = checkStatus({
          id: 'task-123',
          status: BflStatusResponse.TaskNotFound,
        });

        if (result.status === 'success') {
          return result.data;
        }
        throw result.error;
      });

      const payload: CreateImagePayload = {
        model: 'flux-dev',
        params: {
          prompt: 'Test task not found',
        },
      };

      // Act & Assert
      await expect(createBflImage(payload, mockOptions)).rejects.toMatchObject({
        error: expect.any(Object),
        errorType: 'ProviderBizError',
        provider: 'bfl',
      });
    });

    it('should continue polling for Pending status', async () => {
      // Arrange
      const { asyncifyPolling } = await import('../../utils/asyncifyPolling');
      const mockAsyncifyPolling = vi.mocked(asyncifyPolling);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 'task-123',
            polling_url: 'https://api.bfl.ai/v1/get_result?id=task-123',
          }),
      } as Response);

      mockAsyncifyPolling.mockImplementation(async ({ checkStatus }) => {
        // First call - Pending status
        const pendingResult = checkStatus({
          id: 'task-123',
          status: BflStatusResponse.Pending,
        });

        expect(pendingResult.status).toBe('pending');

        // Simulate successful completion
        const successResult = checkStatus({
          id: 'task-123',
          status: BflStatusResponse.Ready,
          result: {
            sample: 'https://example.com/generated-image.jpg',
          },
        });

        return successResult.data;
      });

      const payload: CreateImagePayload = {
        model: 'flux-dev',
        params: {
          prompt: 'Test pending status',
        },
      };

      // Act
      const result = await createBflImage(payload, mockOptions);

      // Assert
      expect(result).toEqual({
        imageUrl: 'https://example.com/generated-image.jpg',
      });
    });
  });

  describe('Error handling', () => {
    it('should handle fetch errors during task submission', async () => {
      // Arrange
      mockFetch.mockRejectedValue(new Error('Network error'));

      const payload: CreateImagePayload = {
        model: 'flux-dev',
        params: {
          prompt: 'Test network error',
        },
      };

      // Act & Assert
      await expect(createBflImage(payload, mockOptions)).rejects.toThrow();
    });

    it('should handle HTTP error responses', async () => {
      // Arrange
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: () =>
          Promise.resolve({
            detail: [{ msg: 'Invalid prompt' }],
          }),
      } as Response);

      const payload: CreateImagePayload = {
        model: 'flux-dev',
        params: {
          prompt: 'Test HTTP error',
        },
      };

      // Act & Assert
      await expect(createBflImage(payload, mockOptions)).rejects.toMatchObject({
        error: expect.any(Object),
        errorType: 'ProviderBizError',
        provider: 'bfl',
      });
    });

    it('should handle HTTP error responses without detail', async () => {
      // Arrange
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.resolve({}),
      } as Response);

      const payload: CreateImagePayload = {
        model: 'flux-dev',
        params: {
          prompt: 'Test HTTP error without detail',
        },
      };

      // Act & Assert
      await expect(createBflImage(payload, mockOptions)).rejects.toMatchObject({
        error: expect.any(Object),
        errorType: 'ProviderBizError',
        provider: 'bfl',
      });
    });

    it('should handle non-JSON error responses', async () => {
      // Arrange
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.reject(new Error('Invalid JSON')),
      } as Response);

      const payload: CreateImagePayload = {
        model: 'flux-dev',
        params: {
          prompt: 'Test non-JSON error',
        },
      };

      // Act & Assert
      await expect(createBflImage(payload, mockOptions)).rejects.toMatchObject({
        error: expect.any(Object),
        errorType: 'ProviderBizError',
        provider: 'bfl',
      });
    });
  });
});
