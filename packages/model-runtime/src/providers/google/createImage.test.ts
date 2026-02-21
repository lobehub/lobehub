// @vitest-environment node
import type { GoogleGenAI } from '@google/genai';
import * as imageToBase64Module from '@lobechat/utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CreateImagePayload } from '../../types/image';
import { createGoogleImage } from './createImage';

const provider = 'google';
const bizErrorType = 'ProviderBizError';
const noImageErrorType = 'ProviderNoImageGenerated';
const invalidErrorType = 'InvalidProviderAPIKey';

// Mock the console.error to avoid polluting test output
vi.spyOn(console, 'error').mockImplementation(() => {});

let mockClient: GoogleGenAI;

beforeEach(() => {
  mockClient = {
    models: {
      generateImages: vi.fn(),
      generateContent: vi.fn(),
    },
  } as any;
});

describe('createGoogleImage', () => {
  describe('Traditional Imagen Models', () => {
    it('should create image successfully with basic parameters', async () => {
      // Arrange - Use real base64 image data (5x5 red pixel PNG)
      const realBase64ImageData =
        'iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GIAXDIBKE0DHxgljNBAAO9TXL0Y4OHwAAAABJRU5ErkJggg==';
      const mockImageResponse = {
        generatedImages: [
          {
            image: {
              imageBytes: realBase64ImageData,
            },
          },
        ],
      };
      vi.spyOn(mockClient.models, 'generateImages').mockResolvedValue(mockImageResponse as any);

      const payload: CreateImagePayload = {
        model: 'imagen-4.0-generate-preview-06-06',
        params: {
          prompt: 'A beautiful landscape with mountains and trees',
          aspectRatio: '1:1',
        },
      };

      // Act
      const result = await createGoogleImage(mockClient, provider, payload);

      // Assert
      expect(mockClient.models.generateImages).toHaveBeenCalledWith({
        model: 'imagen-4.0-generate-preview-06-06',
        prompt: 'A beautiful landscape with mountains and trees',
        config: {
          aspectRatio: '1:1',
          numberOfImages: 1,
        },
      });
      expect(result).toEqual({
        imageUrl: `data:image/png;base64,${realBase64ImageData}`,
      });
    });

    it('should support different aspect ratios like 16:9 for widescreen images', async () => {
      // Arrange - Use real base64 data
      const realBase64Data =
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      const mockImageResponse = {
        generatedImages: [
          {
            image: {
              imageBytes: realBase64Data,
            },
          },
        ],
      };
      vi.spyOn(mockClient.models, 'generateImages').mockResolvedValue(mockImageResponse as any);

      const payload: CreateImagePayload = {
        model: 'imagen-4.0-ultra-generate-preview-06-06',
        params: {
          prompt: 'Cinematic landscape shot with dramatic lighting',
          aspectRatio: '16:9',
        },
      };

      // Act
      await createGoogleImage(mockClient, provider, payload);

      // Assert
      expect(mockClient.models.generateImages).toHaveBeenCalledWith({
        model: 'imagen-4.0-ultra-generate-preview-06-06',
        prompt: 'Cinematic landscape shot with dramatic lighting',
        config: {
          aspectRatio: '16:9',
          numberOfImages: 1,
        },
      });
    });

    it('should work with only prompt when aspect ratio is not specified', async () => {
      // Arrange
      const realBase64Data =
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      const mockImageResponse = {
        generatedImages: [
          {
            image: {
              imageBytes: realBase64Data,
            },
          },
        ],
      };
      vi.spyOn(mockClient.models, 'generateImages').mockResolvedValue(mockImageResponse as any);

      const payload: CreateImagePayload = {
        model: 'imagen-4.0-generate-preview-06-06',
        params: {
          prompt: 'A cute cat sitting in a garden',
        },
      };

      // Act
      await createGoogleImage(mockClient, provider, payload);

      // Assert
      expect(mockClient.models.generateImages).toHaveBeenCalledWith({
        model: 'imagen-4.0-generate-preview-06-06',
        prompt: 'A cute cat sitting in a garden',
        config: {
          aspectRatio: undefined,
          numberOfImages: 1,
        },
      });
    });

    describe('Error handling', () => {
      it('should throw InvalidProviderAPIKey error when API key is invalid', async () => {
        // Arrange - Use real Google AI error format
        const message = `[GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/v1/models/imagen-4.0:generateImages: [400 Bad Request] API key not valid. Please pass a valid API key. [{"@type":"type.googleapis.com/google.rpc.ErrorInfo","reason":"API_KEY_INVALID","domain":"googleapis.com","metadata":{"service":"generativelanguage.googleapis.com"}}]`;
        const apiError = new Error(message);
        vi.spyOn(mockClient.models, 'generateImages').mockRejectedValue(apiError);

        const payload: CreateImagePayload = {
          model: 'imagen-4.0-generate-preview-06-06',
          params: {
            prompt: 'A realistic landscape photo',
          },
        };

        // Act & Assert - Test error type rather than specific text
        await expect(createGoogleImage(mockClient, provider, payload)).rejects.toEqual(
          expect.objectContaining({
            errorType: invalidErrorType,
            provider,
          }),
        );
      });

      it('should throw ProviderBizError for network and API errors', async () => {
        // Arrange
        const apiError = new Error('Network connection failed');
        vi.spyOn(mockClient.models, 'generateImages').mockRejectedValue(apiError);

        const payload: CreateImagePayload = {
          model: 'imagen-4.0-generate-preview-06-06',
          params: {
            prompt: 'A digital art portrait',
          },
        };

        // Act & Assert - Test error type and basic structure
        await expect(createGoogleImage(mockClient, provider, payload)).rejects.toEqual(
          expect.objectContaining({
            errorType: bizErrorType,
            provider,
            error: expect.objectContaining({
              message: expect.any(String),
            }),
          }),
        );
      });

      it('should throw error when API response is malformed - missing generatedImages', async () => {
        // Arrange
        const mockImageResponse = {};
        vi.spyOn(mockClient.models, 'generateImages').mockResolvedValue(mockImageResponse as any);

        const payload: CreateImagePayload = {
          model: 'imagen-4.0-generate-preview-06-06',
          params: {
            prompt: 'Abstract geometric patterns',
          },
        };

        // Act & Assert - Test error behavior rather than specific text
        await expect(createGoogleImage(mockClient, provider, payload)).rejects.toEqual(
          expect.objectContaining({
            errorType: noImageErrorType,
            provider,
          }),
        );
      });

      it('should throw error when API response contains empty image array', async () => {
        // Arrange
        const mockImageResponse = {
          generatedImages: [],
        };
        vi.spyOn(mockClient.models, 'generateImages').mockResolvedValue(mockImageResponse as any);

        const payload: CreateImagePayload = {
          model: 'imagen-4.0-generate-preview-06-06',
          params: {
            prompt: 'Minimalist design poster',
          },
        };

        // Act & Assert
        await expect(createGoogleImage(mockClient, provider, payload)).rejects.toEqual(
          expect.objectContaining({
            errorType: noImageErrorType,
            provider,
          }),
        );
      });

      it('should throw error when generated image lacks required data', async () => {
        // Arrange
        const mockImageResponse = {
          generatedImages: [
            {
              image: {}, // Missing imageBytes
            },
          ],
        };
        vi.spyOn(mockClient.models, 'generateImages').mockResolvedValue(mockImageResponse as any);

        const payload: CreateImagePayload = {
          model: 'imagen-4.0-generate-preview-06-06',
          params: {
            prompt: 'Watercolor painting style',
          },
        };

        // Act & Assert
        await expect(createGoogleImage(mockClient, provider, payload)).rejects.toEqual(
          expect.objectContaining({
            errorType: noImageErrorType,
            provider,
          }),
        );
      });
    });

    describe('Edge cases', () => {
      it('should return first image when API returns multiple generated images', async () => {
        // Arrange - Use two different real base64 image data
        const firstImageData =
          'iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GIAXDIBKE0DHxgljNBAAO9TXL0Y4OHwAAAABJRU5ErkJggg==';
        const secondImageData =
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
        const mockImageResponse = {
          generatedImages: [
            {
              image: {
                imageBytes: firstImageData,
              },
            },
            {
              image: {
                imageBytes: secondImageData,
              },
            },
          ],
        };
        vi.spyOn(mockClient.models, 'generateImages').mockResolvedValue(mockImageResponse as any);

        const payload: CreateImagePayload = {
          model: 'imagen-4.0-generate-preview-06-06',
          params: {
            prompt: 'Generate multiple variations of a sunset',
          },
        };

        // Act
        const result = await createGoogleImage(mockClient, provider, payload);

        // Assert - Should return the first image
        expect(result).toEqual({
          imageUrl: `data:image/png;base64,${firstImageData}`,
        });
      });

      it('should work with custom future Imagen model versions', async () => {
        // Arrange
        const realBase64Data =
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
        const mockImageResponse = {
          generatedImages: [
            {
              image: {
                imageBytes: realBase64Data,
              },
            },
          ],
        };
        vi.spyOn(mockClient.models, 'generateImages').mockResolvedValue(mockImageResponse as any);

        const payload: CreateImagePayload = {
          model: 'imagen-5.0-future-model',
          params: {
            prompt: 'Photorealistic portrait with soft lighting',
            aspectRatio: '4:3',
          },
        };

        // Act
        await createGoogleImage(mockClient, provider, payload);

        // Assert
        expect(mockClient.models.generateImages).toHaveBeenCalledWith({
          model: 'imagen-5.0-future-model',
          prompt: 'Photorealistic portrait with soft lighting',
          config: {
            aspectRatio: '4:3',
            numberOfImages: 1,
          },
        });
      });
    });
  });

  describe('Gemini 2.5 Flash Image Models (:image)', () => {
    it('should create image successfully using generateContent for :image model', async () => {
      // Arrange
      const realBase64ImageData =
        'iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GIAXDIBKE0DHxgljNBAAO9TXL0Y4OHwAAAABJRU5ErkJggg==';
      const mockContentResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  inlineData: {
                    data: realBase64ImageData,
                    mimeType: 'image/png',
                  },
                },
              ],
            },
          },
        ],
      };
      vi.spyOn(mockClient.models, 'generateContent').mockResolvedValue(mockContentResponse as any);

      const payload: CreateImagePayload = {
        model: 'gemini-2.5-flash-image:image',
        params: {
          prompt: 'Create a beautiful sunset landscape',
        },
      };

      // Act
      const result = await createGoogleImage(mockClient, provider, payload);

      // Assert
      expect(mockClient.models.generateContent).toHaveBeenCalledWith({
        contents: [
          {
            role: 'user',
            parts: [{ text: 'Create a beautiful sunset landscape' }],
          },
        ],
        model: 'gemini-2.5-flash-image',
        config: {
          responseModalities: ['Image'],
        },
      });
      expect(result).toEqual({
        imageUrl: `data:image/png;base64,${realBase64ImageData}`,
      });
    });

    it('should support image editing with base64 imageUrl', async () => {
      // Arrange
      const inputImageBase64 =
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      const outputImageBase64 =
        'iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GIAXDIBKE0DHxgljNBAAO9TXL0Y4OHwAAAABJRU5ErkJggg==';

      const mockContentResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  inlineData: {
                    data: outputImageBase64,
                    mimeType: 'image/png',
                  },
                },
              ],
            },
          },
        ],
      };
      vi.spyOn(mockClient.models, 'generateContent').mockResolvedValue(mockContentResponse as any);

      const payload: CreateImagePayload = {
        model: 'gemini-2.5-flash-image:image',
        params: {
          prompt: 'Add a red rose to this image',
          imageUrl: `data:image/png;base64,${inputImageBase64}`,
        },
      };

      // Act
      const result = await createGoogleImage(mockClient, provider, payload);

      // Assert
      expect(mockClient.models.generateContent).toHaveBeenCalledWith({
        contents: [
          {
            role: 'user',
            parts: [
              { text: 'Add a red rose to this image' },
              {
                inlineData: {
                  data: inputImageBase64,
                  mimeType: 'image/png',
                },
              },
            ],
          },
        ],
        model: 'gemini-2.5-flash-image',
        config: {
          responseModalities: ['Image'],
        },
      });
      expect(result).toEqual({
        imageUrl: `data:image/png;base64,${outputImageBase64}`,
      });
    });

    it('should support image editing with URL imageUrl', async () => {
      // Arrange
      const inputImageBase64 =
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      const outputImageBase64 =
        'iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GIAXDIBKE0DHxgljNBAAO9TXL0Y4OHwAAAABJRU5ErkJggg==';

      // Mock imageUrlToBase64 utility
      vi.spyOn(imageToBase64Module, 'imageUrlToBase64').mockResolvedValue({
        base64: inputImageBase64,
        mimeType: 'image/jpeg',
      });

      const mockContentResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  inlineData: {
                    data: outputImageBase64,
                    mimeType: 'image/png',
                  },
                },
              ],
            },
          },
        ],
      };
      vi.spyOn(mockClient.models, 'generateContent').mockResolvedValue(mockContentResponse as any);

      const payload: CreateImagePayload = {
        model: 'gemini-2.5-flash-image:image',
        params: {
          prompt: 'Change the background to blue sky',
          imageUrl: 'https://example.com/image.jpg',
        },
      };

      // Act
      const result = await createGoogleImage(mockClient, provider, payload);

      // Assert
      expect(imageToBase64Module.imageUrlToBase64).toHaveBeenCalledWith(
        'https://example.com/image.jpg',
      );
      expect(mockClient.models.generateContent).toHaveBeenCalledWith({
        contents: [
          {
            role: 'user',
            parts: [
              { text: 'Change the background to blue sky' },
              {
                inlineData: {
                  data: inputImageBase64,
                  mimeType: 'image/jpeg',
                },
              },
            ],
          },
        ],
        model: 'gemini-2.5-flash-image',
        config: {
          responseModalities: ['Image'],
        },
      });
      expect(result).toEqual({
        imageUrl: `data:image/png;base64,${outputImageBase64}`,
      });
    });

    it('should handle null imageUrl as text-only generation', async () => {
      // Arrange
      const outputImageBase64 =
        'iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GIAXDIBKE0DHxgljNBAAO9TXL0Y4OHwAAAABJRU5ErkJggg==';

      const mockContentResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  inlineData: {
                    data: outputImageBase64,
                    mimeType: 'image/png',
                  },
                },
              ],
            },
          },
        ],
      };
      vi.spyOn(mockClient.models, 'generateContent').mockResolvedValue(mockContentResponse as any);

      const payload: CreateImagePayload = {
        model: 'gemini-2.5-flash-image:image',
        params: {
          prompt: 'Generate a colorful abstract pattern',
          imageUrl: null,
        },
      };

      // Act
      const result = await createGoogleImage(mockClient, provider, payload);

      // Assert
      expect(mockClient.models.generateContent).toHaveBeenCalledWith({
        contents: [
          {
            role: 'user',
            parts: [{ text: 'Generate a colorful abstract pattern' }],
          },
        ],
        model: 'gemini-2.5-flash-image',
        config: {
          responseModalities: ['Image'],
        },
      });
      expect(result).toEqual({
        imageUrl: `data:image/png;base64,${outputImageBase64}`,
      });
    });

    describe('Error handling for :image models', () => {
      it('should throw error when no image generated in response', async () => {
        // Arrange
        const mockContentResponse = {
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: 'I cannot generate an image.',
                  },
                ],
              },
            },
          ],
        };
        vi.spyOn(mockClient.models, 'generateContent').mockResolvedValue(
          mockContentResponse as any,
        );

        const payload: CreateImagePayload = {
          model: 'gemini-2.5-flash-image:image',
          params: {
            prompt: 'Create inappropriate content',
          },
        };

        // Act & Assert
        await expect(createGoogleImage(mockClient, provider, payload)).rejects.toEqual(
          expect.objectContaining({
            errorType: noImageErrorType,
            provider,
          }),
        );
      });

      it('should throw error when response is malformed', async () => {
        // Arrange
        const mockContentResponse = {
          candidates: [],
        };
        vi.spyOn(mockClient.models, 'generateContent').mockResolvedValue(
          mockContentResponse as any,
        );

        const payload: CreateImagePayload = {
          model: 'gemini-2.5-flash-image:image',
          params: {
            prompt: 'Generate an image',
          },
        };

        // Act & Assert
        await expect(createGoogleImage(mockClient, provider, payload)).rejects.toEqual(
          expect.objectContaining({
            errorType: noImageErrorType,
            provider,
          }),
        );
      });

      it('should throw error for unsupported image URL format', async () => {
        // Arrange
        const payload: CreateImagePayload = {
          model: 'gemini-2.5-flash-image:image',
          params: {
            prompt: 'Edit this image',
            imageUrl: 'ftp://example.com/image.jpg',
          },
        };

        // Act & Assert
        await expect(createGoogleImage(mockClient, provider, payload)).rejects.toEqual(
          expect.objectContaining({
            errorType: bizErrorType,
            provider,
          }),
        );
      });
    });
  });
});
