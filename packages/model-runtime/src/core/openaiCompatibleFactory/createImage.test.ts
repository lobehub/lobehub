// @vitest-environment node
import * as imageToBase64Module from '@lobechat/utils';
import OpenAI from 'openai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CreateImagePayload } from '../../types/image';
import * as uriParserModule from '../../utils/uriParser';
import { createOpenAICompatibleImage } from './createImage';

// Mock the console to avoid polluting test output
vi.spyOn(console, 'error').mockImplementation(() => {});

// Polyfill File for Node environment
if (typeof File === 'undefined') {
  // @ts-ignore
  global.File = class MockFile {
    constructor(
      public parts: any[],
      public name: string,
      public opts?: any,
    ) {}
  };
}

describe('createOpenAICompatibleImage', () => {
  let mockClient: OpenAI;

  beforeEach(() => {
    // Create a mock OpenAI client
    mockClient = {
      images: {
        generate: vi.fn(),
        edit: vi.fn(),
      },
      chat: {
        completions: {
          create: vi.fn(),
        },
      },
    } as any;

    vi.clearAllMocks();
  });

  describe('chat model mode (model with :image suffix)', () => {
    describe('processImageUrlForChat function', () => {
      it('should process base64 data URI correctly', async () => {
        const mockImageUrl =
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

        vi.spyOn(uriParserModule, 'parseDataUri').mockReturnValue({
          type: 'base64',
          base64:
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
          mimeType: 'image/png',
        });

        const mockChatResponse = {
          choices: [
            {
              message: {
                images: [
                  {
                    image_url: {
                      url: 'data:image/png;base64,generatedImageData',
                    },
                  },
                ],
              },
            },
          ],
        };

        vi.mocked(mockClient.chat.completions.create).mockResolvedValue(mockChatResponse as any);

        const payload: CreateImagePayload = {
          model: 'gemini-2.0-flash-exp:image',
          params: {
            prompt: 'Edit this image',
            imageUrl: mockImageUrl,
          },
        };

        const result = await createOpenAICompatibleImage(mockClient, payload, 'openrouter');

        expect(result.imageUrl).toBe('data:image/png;base64,generatedImageData');
        expect(mockClient.chat.completions.create).toHaveBeenCalled();
      });

      it('should process base64 data URI without mimeType', async () => {
        const mockImageUrl = 'data:;base64,someBase64Data';

        vi.spyOn(uriParserModule, 'parseDataUri').mockReturnValue({
          type: 'base64',
          base64: 'someBase64Data',
          mimeType: null,
        });

        const mockChatResponse = {
          choices: [
            {
              message: {
                images: [
                  {
                    image_url: {
                      url: 'data:image/png;base64,result',
                    },
                  },
                ],
              },
            },
          ],
        };

        vi.mocked(mockClient.chat.completions.create).mockResolvedValue(mockChatResponse as any);

        const payload: CreateImagePayload = {
          model: 'test-model:image',
          params: {
            prompt: 'Process this',
            imageUrl: mockImageUrl,
          },
        };

        const result = await createOpenAICompatibleImage(mockClient, payload, 'test-provider');

        expect(result.imageUrl).toBe('data:image/png;base64,result');
      });

      it('should throw error when base64 data is missing in data URI', async () => {
        const mockImageUrl = 'data:image/png;base64,';

        vi.spyOn(uriParserModule, 'parseDataUri').mockReturnValue({
          type: 'base64',
          base64: null,
          mimeType: 'image/png',
        });

        const payload: CreateImagePayload = {
          model: 'test-model:image',
          params: {
            prompt: 'Process this',
            imageUrl: mockImageUrl,
          },
        };

        await expect(
          createOpenAICompatibleImage(mockClient, payload, 'test-provider'),
        ).rejects.toThrow(
          "Failed to process image URL: TypeError: Image URL doesn't contain base64 data",
        );
      });

      it('should process URL type by converting to base64', async () => {
        const mockHttpImageUrl = 'https://example.com/image.jpg';

        vi.spyOn(uriParserModule, 'parseDataUri').mockReturnValue({
          type: 'url',
          base64: null,
          mimeType: null,
        });

        vi.spyOn(imageToBase64Module, 'imageUrlToBase64').mockResolvedValue({
          base64: 'convertedBase64Data',
          mimeType: 'image/jpeg',
        });

        const mockChatResponse = {
          choices: [
            {
              message: {
                images: [
                  {
                    image_url: {
                      url: 'data:image/png;base64,output',
                    },
                  },
                ],
              },
            },
          ],
        };

        vi.mocked(mockClient.chat.completions.create).mockResolvedValue(mockChatResponse as any);

        const payload: CreateImagePayload = {
          model: 'vision-model:image',
          params: {
            prompt: 'Convert and process',
            imageUrl: mockHttpImageUrl,
          },
        };

        const result = await createOpenAICompatibleImage(mockClient, payload, 'test-provider');

        expect(imageToBase64Module.imageUrlToBase64).toHaveBeenCalledWith(mockHttpImageUrl);
        expect(result.imageUrl).toBe('data:image/png;base64,output');
      });

      it('should throw error for unsupported image URL type', async () => {
        const mockInvalidUrl = 'file:///local/path/image.png';

        vi.spyOn(uriParserModule, 'parseDataUri').mockReturnValue({
          type: null,
          base64: null,
          mimeType: null,
        });

        const payload: CreateImagePayload = {
          model: 'test-model:image',
          params: {
            prompt: 'Process this',
            imageUrl: mockInvalidUrl,
          },
        };

        await expect(
          createOpenAICompatibleImage(mockClient, payload, 'test-provider'),
        ).rejects.toThrow(
          `Failed to process image URL: TypeError: Currently we don't support image url: ${mockInvalidUrl}`,
        );
      });
    });

    describe('generateByChatModel function', () => {
      it('should generate image without imageUrl parameter', async () => {
        const mockChatResponse = {
          choices: [
            {
              message: {
                images: [
                  {
                    image_url: {
                      url: 'data:image/png;base64,generatedWithoutInputImage',
                    },
                  },
                ],
              },
            },
          ],
        };

        vi.mocked(mockClient.chat.completions.create).mockResolvedValue(mockChatResponse as any);

        const payload: CreateImagePayload = {
          model: 'gemini-2.0-flash:image',
          params: {
            prompt: 'Generate a cat image',
          },
        };

        const result = await createOpenAICompatibleImage(mockClient, payload, 'openrouter');

        expect(result.imageUrl).toBe('data:image/png;base64,generatedWithoutInputImage');
        expect(mockClient.chat.completions.create).toHaveBeenCalledWith({
          messages: [
            {
              content: [
                {
                  text: 'Generate a cat image',
                  type: 'text',
                },
              ],
              role: 'user',
            },
          ],
          model: 'gemini-2.0-flash',
          stream: false,
        });
      });

      it('should handle null imageUrl parameter', async () => {
        const mockChatResponse = {
          choices: [
            {
              message: {
                images: [
                  {
                    image_url: {
                      url: 'data:image/png;base64,generatedImage',
                    },
                  },
                ],
              },
            },
          ],
        };

        vi.mocked(mockClient.chat.completions.create).mockResolvedValue(mockChatResponse as any);

        const payload: CreateImagePayload = {
          model: 'test-model:image',
          params: {
            prompt: 'Generate image',
            imageUrl: null as any,
          },
        };

        const result = await createOpenAICompatibleImage(mockClient, payload, 'test-provider');

        expect(result.imageUrl).toBe('data:image/png;base64,generatedImage');
        // Should not include image in content array
        const callArgs = vi.mocked(mockClient.chat.completions.create).mock.calls[0][0] as any;
        expect(callArgs.messages[0].content).toHaveLength(1);
        expect(callArgs.messages[0].content[0].type).toBe('text');
      });

      it('should throw error when no message in response', async () => {
        const mockChatResponse = {
          choices: [
            {
              // message is missing
            },
          ],
        };

        vi.mocked(mockClient.chat.completions.create).mockResolvedValue(mockChatResponse as any);

        const payload: CreateImagePayload = {
          model: 'test-model:image',
          params: {
            prompt: 'Generate image',
          },
        };

        await expect(
          createOpenAICompatibleImage(mockClient, payload, 'test-provider'),
        ).rejects.toThrow('No message in chat completion response');
      });

      it('should throw error when images array is missing', async () => {
        const mockChatResponse = {
          choices: [
            {
              message: {
                content: 'Some text response',
              },
            },
          ],
        };

        vi.mocked(mockClient.chat.completions.create).mockResolvedValue(mockChatResponse as any);

        const payload: CreateImagePayload = {
          model: 'test-model:image',
          params: {
            prompt: 'Generate image',
          },
        };

        await expect(
          createOpenAICompatibleImage(mockClient, payload, 'test-provider'),
        ).rejects.toThrow('No image generated in chat completion response');
      });

      it('should throw error when images array is empty', async () => {
        const mockChatResponse = {
          choices: [
            {
              message: {
                images: [],
              },
            },
          ],
        };

        vi.mocked(mockClient.chat.completions.create).mockResolvedValue(mockChatResponse as any);

        const payload: CreateImagePayload = {
          model: 'test-model:image',
          params: {
            prompt: 'Generate image',
          },
        };

        await expect(
          createOpenAICompatibleImage(mockClient, payload, 'test-provider'),
        ).rejects.toThrow('No image generated in chat completion response');
      });

      it('should throw error when image_url is missing in images array', async () => {
        const mockChatResponse = {
          choices: [
            {
              message: {
                images: [
                  {
                    // image_url is missing
                    someOtherField: 'value',
                  },
                ],
              },
            },
          ],
        };

        vi.mocked(mockClient.chat.completions.create).mockResolvedValue(mockChatResponse as any);

        const payload: CreateImagePayload = {
          model: 'test-model:image',
          params: {
            prompt: 'Generate image',
          },
        };

        await expect(
          createOpenAICompatibleImage(mockClient, payload, 'test-provider'),
        ).rejects.toThrow('No image generated in chat completion response');
      });

      it('should throw error when url is missing in image_url object', async () => {
        const mockChatResponse = {
          choices: [
            {
              message: {
                images: [
                  {
                    image_url: {
                      // url is missing
                      detail: 'high',
                    },
                  },
                ],
              },
            },
          ],
        };

        vi.mocked(mockClient.chat.completions.create).mockResolvedValue(mockChatResponse as any);

        const payload: CreateImagePayload = {
          model: 'test-model:image',
          params: {
            prompt: 'Generate image',
          },
        };

        await expect(
          createOpenAICompatibleImage(mockClient, payload, 'test-provider'),
        ).rejects.toThrow('No image generated in chat completion response');
      });

      it('should successfully process image with valid imageUrl', async () => {
        const mockImageUrl = 'data:image/jpeg;base64,validBase64Data';

        vi.spyOn(uriParserModule, 'parseDataUri').mockReturnValue({
          type: 'base64',
          base64: 'validBase64Data',
          mimeType: 'image/jpeg',
        });

        const mockChatResponse = {
          choices: [
            {
              message: {
                images: [
                  {
                    image_url: {
                      url: 'data:image/png;base64,processedResult',
                    },
                  },
                ],
              },
            },
          ],
        };

        vi.mocked(mockClient.chat.completions.create).mockResolvedValue(mockChatResponse as any);

        const payload: CreateImagePayload = {
          model: 'vision-model:image',
          params: {
            prompt: 'Edit this image by adding a sunset',
            imageUrl: mockImageUrl,
          },
        };

        const result = await createOpenAICompatibleImage(mockClient, payload, 'openrouter');

        expect(result.imageUrl).toBe('data:image/png;base64,processedResult');

        const callArgs = vi.mocked(mockClient.chat.completions.create).mock.calls[0][0] as any;
        expect(callArgs.messages[0].content).toHaveLength(2);
        expect(callArgs.messages[0].content[0]).toEqual({
          text: 'Edit this image by adding a sunset',
          type: 'text',
        });
        expect(callArgs.messages[0].content[1]).toEqual({
          image_url: {
            url: mockImageUrl,
          },
          type: 'image_url',
        });
      });
    });
  });

  describe('routing logic', () => {
    it('should route to chat model when model ends with :image', async () => {
      const mockChatResponse = {
        choices: [
          {
            message: {
              images: [
                {
                  image_url: {
                    url: 'data:image/png;base64,chatModelResult',
                  },
                },
              ],
            },
          },
        ],
      };

      vi.mocked(mockClient.chat.completions.create).mockResolvedValue(mockChatResponse as any);

      const payload: CreateImagePayload = {
        model: 'some-model:image',
        params: {
          prompt: 'Test routing',
        },
      };

      const result = await createOpenAICompatibleImage(mockClient, payload, 'test-provider');

      expect(result.imageUrl).toBe('data:image/png;base64,chatModelResult');
      expect(mockClient.chat.completions.create).toHaveBeenCalled();
      expect(mockClient.images.generate).not.toHaveBeenCalled();
      expect(mockClient.images.edit).not.toHaveBeenCalled();
    });

    it('should route to image mode when model does not end with :image', async () => {
      const mockImageResponse = {
        data: [
          {
            b64_json: 'imageModelBase64Result',
          },
        ],
      };

      vi.mocked(mockClient.images.generate).mockResolvedValue(mockImageResponse as any);

      const payload: CreateImagePayload = {
        model: 'dall-e-3',
        params: {
          prompt: 'Test traditional image generation',
        },
      };

      const result = await createOpenAICompatibleImage(mockClient, payload, 'openai');

      expect(result.imageUrl).toBe('data:image/png;base64,imageModelBase64Result');
      expect(mockClient.images.generate).toHaveBeenCalled();
      expect(mockClient.chat.completions.create).not.toHaveBeenCalled();
    });
  });

  describe('image mode - parameter mapping', () => {
    it('should map single imageUrl string parameter to image array', async () => {
      const mockImageResponse = {
        data: [
          {
            b64_json: 'editedImageResult',
          },
        ],
      };

      // Mock fetch for image download
      const mockArrayBuffer = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]).buffer;
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () => mockArrayBuffer,
        headers: {
          get: (name: string) => (name === 'content-type' ? 'image/jpeg' : null),
        },
      } as any);

      vi.mocked(mockClient.images.edit).mockResolvedValue(mockImageResponse as any);

      const payload: CreateImagePayload = {
        model: 'dall-e-2',
        params: {
          prompt: 'Edit image',
          imageUrl: 'https://example.com/single-image.jpg',
        },
      };

      const result = await createOpenAICompatibleImage(mockClient, payload, 'openai');

      expect(result.imageUrl).toBe('data:image/png;base64,editedImageResult');
      expect(mockClient.images.edit).toHaveBeenCalled();
    });

    it('should handle imageUrl with empty string by not converting to array', async () => {
      const mockImageResponse = {
        data: [
          {
            b64_json: 'generatedImage',
          },
        ],
      };

      vi.mocked(mockClient.images.generate).mockResolvedValue(mockImageResponse as any);

      const payload: CreateImagePayload = {
        model: 'dall-e-3',
        params: {
          prompt: 'Generate image',
          imageUrl: '',
        },
      };

      const result = await createOpenAICompatibleImage(mockClient, payload, 'openai');

      expect(result.imageUrl).toBe('data:image/png;base64,generatedImage');
      expect(mockClient.images.generate).toHaveBeenCalled();
      expect(mockClient.images.edit).not.toHaveBeenCalled();
    });

    it('should handle imageUrl with whitespace-only string', async () => {
      const mockImageResponse = {
        data: [
          {
            b64_json: 'generatedImage',
          },
        ],
      };

      vi.mocked(mockClient.images.generate).mockResolvedValue(mockImageResponse as any);

      const payload: CreateImagePayload = {
        model: 'dall-e-3',
        params: {
          prompt: 'Generate image',
          imageUrl: '   ',
        },
      };

      const result = await createOpenAICompatibleImage(mockClient, payload, 'openai');

      expect(result.imageUrl).toBe('data:image/png;base64,generatedImage');
      expect(mockClient.images.generate).toHaveBeenCalled();
      expect(mockClient.images.edit).not.toHaveBeenCalled();
    });
  });

  describe('image mode - response format handling', () => {
    it('should handle URL format response instead of base64', async () => {
      const mockImageUrl = 'https://oaidalleapiprodscus.blob.core.windows.net/generated/image.png';
      const mockImageResponse = {
        data: [
          {
            url: mockImageUrl,
          },
        ],
      };

      vi.mocked(mockClient.images.generate).mockResolvedValue(mockImageResponse as any);

      const payload: CreateImagePayload = {
        model: 'dall-e-3',
        params: {
          prompt: 'Generate image with URL response',
        },
      };

      const result = await createOpenAICompatibleImage(mockClient, payload, 'openai');

      expect(result.imageUrl).toBe(mockImageUrl);
      expect(mockClient.images.generate).toHaveBeenCalled();
    });

    it('should throw error when imageData has neither url nor b64_json', async () => {
      const mockImageResponse = {
        data: [
          {
            // Missing both url and b64_json
            revised_prompt: 'some prompt',
          },
        ],
      };

      vi.mocked(mockClient.images.generate).mockResolvedValue(mockImageResponse as any);

      const payload: CreateImagePayload = {
        model: 'dall-e-3',
        params: {
          prompt: 'Test',
        },
      };

      await expect(createOpenAICompatibleImage(mockClient, payload, 'openai')).rejects.toThrow(
        'Invalid image response: missing both b64_json and url fields',
      );
    });

    it('should throw error when response data is not an array', async () => {
      const mockImageResponse = {
        data: 'not an array',
      };

      vi.mocked(mockClient.images.generate).mockResolvedValue(mockImageResponse as any);

      const payload: CreateImagePayload = {
        model: 'dall-e-3',
        params: {
          prompt: 'Test',
        },
      };

      await expect(createOpenAICompatibleImage(mockClient, payload, 'openai')).rejects.toThrow(
        'Invalid image response: missing or empty data array',
      );
    });

    it('should throw error when imageData is undefined in array', async () => {
      const mockImageResponse = {
        data: [undefined],
      };

      vi.mocked(mockClient.images.generate).mockResolvedValue(mockImageResponse as any);

      const payload: CreateImagePayload = {
        model: 'dall-e-3',
        params: {
          prompt: 'Test',
        },
      };

      await expect(createOpenAICompatibleImage(mockClient, payload, 'openai')).rejects.toThrow(
        'Invalid image response: first data item is null or undefined',
      );
    });
  });

  describe('image mode - usage tracking', () => {
    it('should include modelUsage when usage is present in response', async () => {
      const mockImageResponse = {
        data: [
          {
            b64_json: 'imageWithUsage',
          },
        ],
        usage: {
          total_tokens: 1000,
          input_tokens: 100,
          output_tokens: 900,
          input_tokens_details: {
            text_tokens: 50,
            image_tokens: 50,
          },
        },
      };

      vi.mocked(mockClient.images.generate).mockResolvedValue(mockImageResponse as any);

      const payload: CreateImagePayload = {
        model: 'dall-e-3',
        params: {
          prompt: 'Generate image with usage tracking',
        },
      };

      const result = await createOpenAICompatibleImage(mockClient, payload, 'openai');

      expect(result.imageUrl).toBe('data:image/png;base64,imageWithUsage');
      expect(result.modelUsage).toBeDefined();
      expect(result.modelUsage?.inputImageTokens).toBe(50);
      expect(result.modelUsage?.inputTextTokens).toBe(50);
      expect(result.modelUsage?.outputImageTokens).toBe(900);
    });

    it('should not include modelUsage when usage is missing in response', async () => {
      const mockImageResponse = {
        data: [
          {
            b64_json: 'imageWithoutUsage',
          },
        ],
        // No usage field
      };

      vi.mocked(mockClient.images.generate).mockResolvedValue(mockImageResponse as any);

      const payload: CreateImagePayload = {
        model: 'dall-e-3',
        params: {
          prompt: 'Generate image without usage tracking',
        },
      };

      const result = await createOpenAICompatibleImage(mockClient, payload, 'openai');

      expect(result.imageUrl).toBe('data:image/png;base64,imageWithoutUsage');
      expect(result.modelUsage).toBeUndefined();
    });
  });
});
