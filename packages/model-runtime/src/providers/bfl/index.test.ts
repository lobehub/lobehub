// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CreateImagePayload } from '../../types/image';
import { LobeBflAI } from './index';

// Mock the createBflImage function
vi.mock('./createImage', () => ({
  createBflImage: vi.fn(),
}));

// Mock the console.error to avoid polluting test output
vi.spyOn(console, 'error').mockImplementation(() => {});

const bizErrorType = 'ProviderBizError';
const invalidErrorType = 'InvalidProviderAPIKey';

let instance: LobeBflAI;

beforeEach(() => {
  vi.clearAllMocks();
  instance = new LobeBflAI({ apiKey: 'test-api-key' });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('LobeBflAI', () => {
  describe('init', () => {
    it('should correctly initialize with an API key', () => {
      const instance = new LobeBflAI({ apiKey: 'test_api_key' });
      expect(instance).toBeInstanceOf(LobeBflAI);
    });

    it('should initialize with custom baseURL', () => {
      const customBaseURL = 'https://custom-api.bfl.ai';
      const instance = new LobeBflAI({
        apiKey: 'test_api_key',
        baseURL: customBaseURL,
      });
      expect(instance).toBeInstanceOf(LobeBflAI);
    });

    it('should throw InvalidProviderAPIKey if no apiKey is provided', () => {
      expect(() => {
        new LobeBflAI({});
      }).toThrow();
    });

    it('should throw InvalidProviderAPIKey if apiKey is undefined', () => {
      expect(() => {
        new LobeBflAI({ apiKey: undefined });
      }).toThrow();
    });
  });

  describe('createImage', () => {
    let mockCreateBflImage: any;

    beforeEach(async () => {
      const { createBflImage } = await import('./createImage');
      mockCreateBflImage = vi.mocked(createBflImage);
    });

    it('should create image successfully with basic parameters', async () => {
      // Arrange
      const mockImageResponse = {
        imageUrl: 'https://example.com/generated-image.jpg',
      };
      mockCreateBflImage.mockResolvedValue(mockImageResponse);

      const payload: CreateImagePayload = {
        model: 'flux-dev',
        params: {
          prompt: 'A beautiful landscape with mountains',
          width: 1024,
          height: 1024,
        },
      };

      // Act
      const result = await instance.createImage(payload);

      // Assert
      expect(mockCreateBflImage).toHaveBeenCalledWith(payload, {
        apiKey: 'test-api-key',
        baseURL: undefined,
        provider: 'bfl',
      });
      expect(result).toEqual(mockImageResponse);
    });

    it('should pass custom baseURL to createBflImage', async () => {
      // Arrange
      const customBaseURL = 'https://custom-api.bfl.ai';
      const customInstance = new LobeBflAI({
        apiKey: 'test-api-key',
        baseURL: customBaseURL,
      });

      const mockImageResponse = {
        imageUrl: 'https://example.com/generated-image.jpg',
      };
      mockCreateBflImage.mockResolvedValue(mockImageResponse);

      const payload: CreateImagePayload = {
        model: 'flux-pro',
        params: {
          prompt: 'Test image',
        },
      };

      // Act
      await customInstance.createImage(payload);

      // Assert
      expect(mockCreateBflImage).toHaveBeenCalledWith(payload, {
        apiKey: 'test-api-key',
        baseURL: customBaseURL,
        provider: 'bfl',
      });
    });

    describe('Error handling', () => {
      it('should throw InvalidProviderAPIKey on 401 error', async () => {
        // Arrange
        const apiError = new Error('Unauthorized') as Error & { status: number };
        apiError.status = 401;
        mockCreateBflImage.mockRejectedValue(apiError);

        const payload: CreateImagePayload = {
          model: 'flux-dev',
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
        mockCreateBflImage.mockRejectedValue(apiError);

        const payload: CreateImagePayload = {
          model: 'flux-dev',
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
        mockCreateBflImage.mockRejectedValue(apiError);

        const payload: CreateImagePayload = {
          model: 'flux-dev',
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

      it('should throw ProviderBizError on errors without status property', async () => {
        // Arrange
        const apiError = new Error('Network error');
        mockCreateBflImage.mockRejectedValue(apiError);

        const payload: CreateImagePayload = {
          model: 'flux-pro-1.1',
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

    describe('Edge cases', () => {
      it('should handle different model types', async () => {
        // Arrange
        const mockImageResponse = {
          imageUrl: 'https://example.com/generated-image.jpg',
        };
        mockCreateBflImage.mockResolvedValue(mockImageResponse);

        const models = [
          'flux-dev',
          'flux-pro',
          'flux-pro-1.1',
          'flux-pro-1.1-ultra',
          'flux-kontext-pro',
          'flux-kontext-max',
        ];

        // Act & Assert
        for (const model of models) {
          const payload: CreateImagePayload = {
            model,
            params: {
              prompt: `Test image for ${model}`,
            },
          };

          await instance.createImage(payload);

          expect(mockCreateBflImage).toHaveBeenCalledWith(payload, {
            apiKey: 'test-api-key',
            baseURL: undefined,
            provider: 'bfl',
          });
        }
      });

      it('should handle empty params object', async () => {
        // Arrange
        const mockImageResponse = {
          imageUrl: 'https://example.com/generated-image.jpg',
        };
        mockCreateBflImage.mockResolvedValue(mockImageResponse);

        const payload: CreateImagePayload = {
          model: 'flux-dev',
          params: {
            prompt: 'Empty params test',
          },
        };

        // Act
        const result = await instance.createImage(payload);

        // Assert
        expect(mockCreateBflImage).toHaveBeenCalledWith(payload, {
          apiKey: 'test-api-key',
          baseURL: undefined,
          provider: 'bfl',
        });
        expect(result).toEqual(mockImageResponse);
      });
    });
  });
});
