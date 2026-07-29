// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CreateVideoPayload } from '../../types/video';
import { createGoogleVideo, pollGoogleVideoOperation } from './createVideo';

vi.mock('debug', () => ({
  default: vi.fn(() => vi.fn()),
}));

vi.mock('../../utils/googleErrorParser', () => ({
  parseGoogleErrorMessage: vi.fn((message) => ({
    error: message,
    errorType: 'GoogleAPIError',
  })),
}));

vi.mock('../../utils/uriParser', () => ({
  parseDataUri: vi.fn((url) => {
    if (url.startsWith('data:')) {
      const matches = url.match(/^data:(image\/\w+);base64,(.+)$/);
      if (matches) {
        return { base64: matches[2], mimeType: matches[1], type: 'base64' };
      }
      return { base64: null, mimeType: null, type: 'base64' };
    }
    return { base64: null, mimeType: null, type: 'url' };
  }),
}));

vi.mock('@lobechat/utils', () => ({
  imageUrlToBase64: vi.fn(async (_url) => ({
    base64: 'mock-base64-data',
    mimeType: 'image/jpeg',
  })),
}));

vi.mock('@google/genai', () => ({
  GenerateVideosOperation: class {
    name: string = '';
  },
}));

describe('createGoogleVideo', () => {
  const mockClient = {
    interactions: {
      create: vi.fn(),
    },
    models: {
      generateVideos: vi.fn(),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('successful creation', () => {
    it('should create a background Gemini Omni interaction with a dynamic webhook', async () => {
      mockClient.interactions.create.mockResolvedValueOnce({ id: 'interactions/omni-123' });

      const payload: CreateVideoPayload = {
        callbackUrl: 'https://app.example.com/api/webhooks/video/google?token=secret',
        model: 'gemini-omni-flash-preview',
        params: {
          aspectRatio: '9:16',
          prompt: 'A cat playing guitar',
        },
      };

      const result = await createGoogleVideo(mockClient as any, 'google', payload);

      expect(mockClient.interactions.create).toHaveBeenCalledWith({
        api_version: 'v1beta',
        background: true,
        generation_config: { video_config: { task: 'text_to_video' } },
        input: 'A cat playing guitar',
        model: 'gemini-omni-flash-preview',
        response_format: {
          aspect_ratio: '9:16',
          delivery: 'uri',
          type: 'video',
        },
        store: true,
        webhook_config: {
          uris: ['https://app.example.com/api/webhooks/video/google?token=secret'],
        },
      });
      expect(result).toEqual({ inferenceId: 'interactions/omni-123' });
    });

    it('should continue a Gemini Omni interaction with only the new edit instruction', async () => {
      mockClient.interactions.create.mockResolvedValueOnce({ id: 'interactions/edit-456' });

      await createGoogleVideo(mockClient as any, 'google', {
        model: 'gemini-omni-flash-preview',
        params: {
          imageUrl: 'https://example.com/stale-start-frame.jpg',
          imageUrls: ['https://example.com/stale-reference.jpg'],
          prompt: 'Make the camera move more slowly',
        },
        previousInteractionId: 'interactions/source-123',
      });

      const request = mockClient.interactions.create.mock.calls[0][0];
      expect(request).toMatchObject({
        input: 'Make the camera move more slowly',
        previous_interaction_id: 'interactions/source-123',
      });
      expect(request).not.toHaveProperty('generation_config');
    });

    it('should infer image-to-video when a stale text task is sent with media', async () => {
      mockClient.interactions.create.mockResolvedValueOnce({ id: 'interactions/image-456' });

      await createGoogleVideo(mockClient as any, 'google', {
        model: 'gemini-omni-flash-preview',
        params: {
          imageUrls: ['https://example.com/reference.jpg'],
          prompt: 'Animate this image',
          task: 'text_to_video',
        },
      });

      expect(mockClient.interactions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          generation_config: { video_config: { task: 'image_to_video' } },
        }),
      );
    });

    it('should preserve all frame inputs and select reference-to-video', async () => {
      mockClient.interactions.create.mockResolvedValueOnce({ id: 'interactions/reference-789' });

      await createGoogleVideo(mockClient as any, 'google', {
        model: 'gemini-omni-flash-preview',
        params: {
          endImageUrl: 'https://example.com/end.jpg',
          imageUrl: 'https://example.com/start.jpg',
          imageUrls: ['https://example.com/one.jpg', 'https://example.com/two.jpg'],
          prompt: 'Put both characters in the same scene',
        },
      });

      expect(mockClient.interactions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          generation_config: { video_config: { task: 'reference_to_video' } },
          input: [
            { data: 'mock-base64-data', mime_type: 'image/jpeg', type: 'image' },
            { data: 'mock-base64-data', mime_type: 'image/jpeg', type: 'image' },
            { data: 'mock-base64-data', mime_type: 'image/jpeg', type: 'image' },
            { data: 'mock-base64-data', mime_type: 'image/jpeg', type: 'image' },
            { text: 'Put both characters in the same scene', type: 'text' },
          ],
        }),
      );
    });

    it('should create video with basic prompt', async () => {
      const mockOperation = { name: 'operations/test-op-123' };
      mockClient.models.generateVideos.mockResolvedValueOnce(mockOperation);

      const payload: CreateVideoPayload = {
        model: 'veo-2.0-generate-001',
        params: {
          prompt: 'A cat playing guitar',
        },
      };

      const result = await createGoogleVideo(mockClient as any, 'google', payload);

      expect(mockClient.models.generateVideos).toHaveBeenCalledWith({
        model: 'veo-2.0-generate-001',
        prompt: 'A cat playing guitar',
        config: {},
      });

      expect(result).toEqual({ inferenceId: 'operations/test-op-123' });
    });

    it('should return inferenceId from operation name', async () => {
      const mockOperation = { name: 'operations/custom-op-456' };
      mockClient.models.generateVideos.mockResolvedValueOnce(mockOperation);

      const payload: CreateVideoPayload = {
        model: 'veo-2.0-generate-001',
        params: { prompt: 'Test' },
      };

      const result = await createGoogleVideo(mockClient as any, 'google', payload);

      expect(result.inferenceId).toBe('operations/custom-op-456');
    });

    it('should return empty string when operation name is undefined', async () => {
      const mockOperation = { name: undefined };
      mockClient.models.generateVideos.mockResolvedValueOnce(mockOperation);

      const payload: CreateVideoPayload = {
        model: 'veo-2.0-generate-001',
        params: { prompt: 'Test' },
      };

      const result = await createGoogleVideo(mockClient as any, 'google', payload);

      expect(result.inferenceId).toBe('');
    });
  });

  describe('optional parameters', () => {
    it('should include aspectRatio in config', async () => {
      const mockOperation = { name: 'operations/test-op-aspect' };
      mockClient.models.generateVideos.mockResolvedValueOnce(mockOperation);

      const payload: CreateVideoPayload = {
        model: 'veo-2.0-generate-001',
        params: {
          prompt: 'Landscape video',
          aspectRatio: '16:9',
        },
      };

      await createGoogleVideo(mockClient as any, 'google', payload);

      const callArgs = mockClient.models.generateVideos.mock.calls[0][0];
      expect(callArgs.config).toEqual({ aspectRatio: '16:9' });
    });

    it('should include resolution in config', async () => {
      const mockOperation = { name: 'operations/test-op-res' };
      mockClient.models.generateVideos.mockResolvedValueOnce(mockOperation);

      const payload: CreateVideoPayload = {
        model: 'veo-2.0-generate-001',
        params: {
          prompt: 'High quality video',
          resolution: '4k',
        },
      };

      await createGoogleVideo(mockClient as any, 'google', payload);

      const callArgs = mockClient.models.generateVideos.mock.calls[0][0];
      expect(callArgs.config.resolution).toBe('4k');
    });

    it('should include both aspectRatio and resolution in config', async () => {
      const mockOperation = { name: 'operations/test-op-both' };
      mockClient.models.generateVideos.mockResolvedValueOnce(mockOperation);

      const payload: CreateVideoPayload = {
        model: 'veo-2.0-generate-001',
        params: {
          prompt: 'Full options',
          aspectRatio: '21:9',
          resolution: '1080p',
        },
      };

      await createGoogleVideo(mockClient as any, 'google', payload);

      const callArgs = mockClient.models.generateVideos.mock.calls[0][0];
      expect(callArgs.config).toEqual({
        aspectRatio: '21:9',
        resolution: '1080p',
      });
    });

    it('should include imageUrl as image at root level', async () => {
      const mockOperation = { name: 'operations/image-to-video' };
      mockClient.models.generateVideos.mockResolvedValueOnce(mockOperation);

      const payload: CreateVideoPayload = {
        model: 'veo-2.0-generate-001',
        params: {
          prompt: 'Animate this',
          imageUrl: 'https://example.com/first.jpg',
        },
      };

      await createGoogleVideo(mockClient as any, 'google', payload);

      const callArgs = mockClient.models.generateVideos.mock.calls[0][0];
      expect(callArgs.image).toBeDefined();
      expect(callArgs.image.mimeType).toBe('image/jpeg');
      expect(callArgs.image.imageBytes).toBe('mock-base64-data');
    });

    it('should include endImageUrl as lastFrame in config', async () => {
      const mockOperation = { name: 'operations/transformer' };
      mockClient.models.generateVideos.mockResolvedValueOnce(mockOperation);

      const payload: CreateVideoPayload = {
        model: 'veo-2.0-generate-001',
        params: {
          prompt: 'Transform first to last',
          imageUrl: 'https://example.com/first.jpg',
          endImageUrl: 'https://example.com/last.jpg',
        },
      };

      await createGoogleVideo(mockClient as any, 'google', payload);

      const callArgs = mockClient.models.generateVideos.mock.calls[0][0];
      expect(callArgs.image).toBeDefined();
      expect(callArgs.config.lastFrame).toBeDefined();
      expect(callArgs.config.lastFrame.mimeType).toBe('image/jpeg');
      expect(callArgs.config.lastFrame.imageBytes).toBe('mock-base64-data');
    });

    it('should include duration as durationSeconds in config', async () => {
      const mockOperation = { name: 'operations/duration-test' };
      mockClient.models.generateVideos.mockResolvedValueOnce(mockOperation);

      const payload: CreateVideoPayload = {
        model: 'veo-2.0-generate-001',
        params: {
          prompt: 'Short clip',
          duration: 5,
        },
      };

      await createGoogleVideo(mockClient as any, 'google', payload);

      const callArgs = mockClient.models.generateVideos.mock.calls[0][0];
      expect(callArgs.config.durationSeconds).toBe(5);
    });

    it('should include generateAudio in config when true', async () => {
      const mockOperation = { name: 'operations/audio-test' };
      mockClient.models.generateVideos.mockResolvedValueOnce(mockOperation);

      const payload: CreateVideoPayload = {
        model: 'veo-2.0-generate-001',
        params: {
          prompt: 'Video with audio',
          generateAudio: true,
        },
      };

      await createGoogleVideo(mockClient as any, 'google', payload);

      const callArgs = mockClient.models.generateVideos.mock.calls[0][0];
      expect(callArgs.config.generateAudio).toBe(true);
    });

    it('should not include generateAudio when undefined or false', async () => {
      const mockOperation = { name: 'operations/no-audio' };
      mockClient.models.generateVideos.mockResolvedValueOnce(mockOperation);

      const payload: CreateVideoPayload = {
        model: 'veo-2.0-generate-001',
        params: {
          prompt: 'Silent video',
          generateAudio: false,
        },
      };

      await createGoogleVideo(mockClient as any, 'google', payload);

      const callArgs = mockClient.models.generateVideos.mock.calls[0][0];
      expect(callArgs.config.generateAudio).toBeUndefined();
    });

    it('should include seed in config', async () => {
      const mockOperation = { name: 'operations/seed-test' };
      mockClient.models.generateVideos.mockResolvedValueOnce(mockOperation);

      const payload: CreateVideoPayload = {
        model: 'veo-2.0-generate-001',
        params: {
          prompt: 'Reproducible video',
          seed: 42,
        },
      };

      await createGoogleVideo(mockClient as any, 'google', payload);

      const callArgs = mockClient.models.generateVideos.mock.calls[0][0];
      expect(callArgs.config.seed).toBe(42);
    });

    it('should not include seed when undefined', async () => {
      const mockOperation = { name: 'operations/no-seed' };
      mockClient.models.generateVideos.mockResolvedValueOnce(mockOperation);

      const payload: CreateVideoPayload = {
        model: 'veo-2.0-generate-001',
        params: {
          prompt: 'Random video',
        },
      };

      await createGoogleVideo(mockClient as any, 'google', payload);

      const callArgs = mockClient.models.generateVideos.mock.calls[0][0];
      expect(callArgs.config.seed).toBeUndefined();
    });

    it('should include different seed values', async () => {
      const mockOperation = { name: 'operations/seed-123' };
      mockClient.models.generateVideos.mockResolvedValueOnce(mockOperation);

      const payload: CreateVideoPayload = {
        model: 'veo-2.0-generate-001',
        params: {
          prompt: 'Specific seed',
          seed: 999999,
        },
      };

      await createGoogleVideo(mockClient as any, 'google', payload);

      const callArgs = mockClient.models.generateVideos.mock.calls[0][0];
      expect(callArgs.config.seed).toBe(999999);
    });

    it('should not include duration when undefined', async () => {
      const mockOperation = { name: 'operations/no-duration' };
      mockClient.models.generateVideos.mockResolvedValueOnce(mockOperation);

      const payload: CreateVideoPayload = {
        model: 'veo-2.0-generate-001',
        params: {
          prompt: 'No duration specified',
        },
      };

      await createGoogleVideo(mockClient as any, 'google', payload);

      const callArgs = mockClient.models.generateVideos.mock.calls[0][0];
      expect(callArgs.config.durationSeconds).toBeUndefined();
    });

    it('should include all optional parameters together', async () => {
      const mockOperation = { name: 'operations/full-params' };
      mockClient.models.generateVideos.mockResolvedValueOnce(mockOperation);

      const payload: CreateVideoPayload = {
        model: 'veo-2.0-generate-001',
        params: {
          prompt: 'Full featured video',
          imageUrl: 'https://example.com/start.jpg',
          endImageUrl: 'https://example.com/end.jpg',
          aspectRatio: '16:9',
          resolution: '4k',
          duration: 10,
          generateAudio: true,
          seed: 12345,
        },
      };

      await createGoogleVideo(mockClient as any, 'google', payload);

      const callArgs = mockClient.models.generateVideos.mock.calls[0][0];
      expect(callArgs).toEqual({
        model: 'veo-2.0-generate-001',
        prompt: 'Full featured video',
        config: {
          aspectRatio: '16:9',
          resolution: '4k',
          lastFrame: {
            imageBytes: 'mock-base64-data',
            mimeType: 'image/jpeg',
          },
          durationSeconds: 10,
          generateAudio: true,
          seed: 12345,
        },
        image: {
          imageBytes: 'mock-base64-data',
          mimeType: 'image/jpeg',
        },
      });
    });

    it('should handle base64 image URL', async () => {
      const mockOperation = { name: 'operations/base64-image' };
      mockClient.models.generateVideos.mockResolvedValueOnce(mockOperation);

      const base64Url =
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

      const payload: CreateVideoPayload = {
        model: 'veo-2.0-generate-001',
        params: {
          prompt: 'Video from base64',
          imageUrl: base64Url,
        },
      };

      await createGoogleVideo(mockClient as any, 'google', payload);

      const callArgs = mockClient.models.generateVideos.mock.calls[0][0];
      expect(callArgs.image).toEqual({
        imageBytes:
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        mimeType: 'image/png',
      });
    });
  });

  describe('error handling', () => {
    it('should handle Google API errors', async () => {
      mockClient.models.generateVideos.mockRejectedValueOnce(
        new Error('Invalid value for parameter'),
      );

      const payload: CreateVideoPayload = {
        model: 'veo-2.0-generate-001',
        params: { prompt: 'Test' },
      };

      await expect(createGoogleVideo(mockClient as any, 'google', payload)).rejects.toMatchObject({
        errorType: 'GoogleAPIError',
        provider: 'google',
      });
    });

    it('should throw error with parsed Google error message', async () => {
      mockClient.models.generateVideos.mockRejectedValueOnce(
        new Error('[GoogleGenerativeAI Error]: Invalid request'),
      );

      const payload: CreateVideoPayload = {
        model: 'veo-2.0-generate-001',
        params: { prompt: 'Test' },
      };

      await expect(createGoogleVideo(mockClient as any, 'google', payload)).rejects.toThrow();
    });

    it('should pass through errors that already have errorType', async () => {
      const customError = new Error('Custom error');
      (customError as any).errorType = 'AgentRuntimeError';
      mockClient.models.generateVideos.mockRejectedValueOnce(customError);

      const payload: CreateVideoPayload = {
        model: 'veo-2.0-generate-001',
        params: { prompt: 'Test' },
      };

      await expect(createGoogleVideo(mockClient as any, 'google', payload)).rejects.toBe(
        customError,
      );
    });

    it('should include provider in error payload', async () => {
      mockClient.models.generateVideos.mockRejectedValueOnce(new Error('API quota exceeded'));

      const payload: CreateVideoPayload = {
        model: 'veo-2.0-generate-001',
        params: { prompt: 'Test' },
      };

      try {
        await createGoogleVideo(mockClient as any, 'google', payload);
        expect.fail('Should have thrown');
      } catch (error: any) {
        expect(error.provider).toBe('google');
      }
    });
  });

  describe('logging', () => {
    it('should log video creation request params', async () => {
      const mockOperation = { name: 'operations/test-log' };
      mockClient.models.generateVideos.mockResolvedValueOnce(mockOperation);

      const payload: CreateVideoPayload = {
        model: 'veo-2.0-generate-001',
        params: { prompt: 'Test logging' },
      };

      await createGoogleVideo(mockClient as any, 'google', payload);

      expect(mockClient.models.generateVideos).toHaveBeenCalled();
    });
  });
});

describe('pollGoogleVideoOperation', () => {
  const mockClient = {
    files: {
      get: vi.fn(),
    },
    interactions: {
      get: vi.fn(),
    },
    operations: {
      getVideosOperation: vi.fn(),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('successful completion', () => {
    it('should return inline Gemini Omni video data', async () => {
      mockClient.interactions.get.mockResolvedValueOnce({
        id: 'v1_omni-inline',
        output_video: {
          data: 'base64-video',
          mime_type: 'video/mp4',
        },
        status: 'completed',
        usage: {
          total_output_tokens: 28_960,
          total_tokens: 29_120,
        },
      });

      const result = await pollGoogleVideoOperation(
        mockClient as any,
        'v1_omni-inline',
        'google',
        'test-api-key',
      );

      expect(mockClient.interactions.get).toHaveBeenCalledWith('v1_omni-inline', {
        api_version: 'v1beta',
      });

      expect(result).toEqual({
        status: 'success',
        usage: {
          completionTokens: 28_960,
          totalTokens: 29_120,
        },
        videoUrl: 'data:video/mp4;base64,base64-video',
      });
    });

    it('should wait for a Gemini file and return its authenticated download URI', async () => {
      mockClient.interactions.get.mockResolvedValueOnce({
        id: 'interactions/omni-uri',
        output_video: { type: 'video', uri: 'files/generated-video' },
        status: 'completed',
      });
      mockClient.files.get.mockResolvedValueOnce({
        downloadUri: 'https://generativelanguage.googleapis.com/download/video',
        state: 'ACTIVE',
      });

      const result = await pollGoogleVideoOperation(
        mockClient as any,
        'interactions/omni-uri',
        'google',
        'test-api-key',
      );

      expect(mockClient.files.get).toHaveBeenCalledWith({ name: 'files/generated-video' });
      expect(result).toEqual({
        headers: { 'x-goog-api-key': 'test-api-key' },
        status: 'success',
        videoUrl: 'https://generativelanguage.googleapis.com/download/video',
      });
    });

    it('should return success when operation is done', async () => {
      const mockOperation = {
        done: true,
        response: {
          generatedVideos: [
            {
              video: {
                uri: 'https://storage.googleapis.com/video.mp4',
              },
            },
          ],
        },
      };
      mockClient.operations.getVideosOperation.mockResolvedValueOnce(mockOperation);

      const result = await pollGoogleVideoOperation(
        mockClient as any,
        'operations/test-123',
        'google',
        'test-api-key',
      );

      expect(result).toEqual({
        status: 'success',
        videoUrl: 'https://storage.googleapis.com/video.mp4',
        headers: {
          'x-goog-api-key': 'test-api-key',
        },
      });
    });

    it('should include x-goog-api-key header for authenticated download', async () => {
      const mockOperation = {
        done: true,
        response: {
          generatedVideos: [{ video: { uri: 'https://example.com/video.mp4' } }],
        },
      };
      mockClient.operations.getVideosOperation.mockResolvedValueOnce(mockOperation);

      const result = await pollGoogleVideoOperation(
        mockClient as any,
        'operations/test-123',
        'google',
        'custom-api-key',
      );

      if (result.status === 'success') {
        expect(result.headers).toEqual({
          'x-goog-api-key': 'custom-api-key',
        });
      }
    });

    it('should handle operation with multiple generated videos', async () => {
      const mockOperation = {
        done: true,
        response: {
          generatedVideos: [
            { video: { uri: 'https://example.com/video1.mp4' } },
            { video: { uri: 'https://example.com/video2.mp4' } },
          ],
        },
      };
      mockClient.operations.getVideosOperation.mockResolvedValueOnce(mockOperation);

      const result = await pollGoogleVideoOperation(
        mockClient as any,
        'operations/test-123',
        'google',
        'test-api-key',
      );

      if (result.status === 'success') {
        expect(result.videoUrl).toBe('https://example.com/video1.mp4');
      }
    });
  });

  describe('error scenarios', () => {
    it('should return failed when operation has error', async () => {
      const mockOperation = {
        done: true,
        error: {
          message: 'Quota exceeded',
        },
      };
      mockClient.operations.getVideosOperation.mockResolvedValueOnce(mockOperation);

      const result = await pollGoogleVideoOperation(
        mockClient as any,
        'operations/test-123',
        'google',
        'test-api-key',
      );

      expect(result).toEqual({
        status: 'failed',
        error: 'Quota exceeded',
      });
    });

    it('should return failed when no video in response', async () => {
      const mockOperation = {
        done: true,
        response: {},
      };
      mockClient.operations.getVideosOperation.mockResolvedValueOnce(mockOperation);

      const result = await pollGoogleVideoOperation(
        mockClient as any,
        'operations/test-123',
        'google',
        'test-api-key',
      );

      expect(result).toEqual({
        status: 'failed',
        error: 'No video generated',
      });
    });

    it('should return failed when raiMediaFilteredReasons present', async () => {
      const mockOperation = {
        done: true,
        response: {
          raiMediaFilteredReasons: ['Content policy violation'],
        },
      };
      mockClient.operations.getVideosOperation.mockResolvedValueOnce(mockOperation);

      const result = await pollGoogleVideoOperation(
        mockClient as any,
        'operations/test-123',
        'google',
        'test-api-key',
      );

      expect(result).toEqual({
        status: 'failed',
        error: 'Content policy violation',
      });
    });

    it('should return failed when raiMediaFilteredReasons has multiple reasons', async () => {
      const mockOperation = {
        done: true,
        response: {
          raiMediaFilteredReasons: ['Content policy violation', 'Unsafe content'],
        },
      };
      mockClient.operations.getVideosOperation.mockResolvedValueOnce(mockOperation);

      const result = await pollGoogleVideoOperation(
        mockClient as any,
        'operations/test-123',
        'google',
        'test-api-key',
      );

      expect(result).toEqual({
        status: 'failed',
        error: 'Content policy violation',
      });
    });

    it('should return failed when video object is missing uri', async () => {
      const mockOperation = {
        done: true,
        response: {
          generatedVideos: [{ video: {} }],
        },
      };
      mockClient.operations.getVideosOperation.mockResolvedValueOnce(mockOperation);

      const result = await pollGoogleVideoOperation(
        mockClient as any,
        'operations/test-123',
        'google',
        'test-api-key',
      );

      expect(result).toEqual({
        status: 'failed',
        error: 'Video URL is empty',
      });
    });

    it('should return failed when generatedVideos array is empty', async () => {
      const mockOperation = {
        done: true,
        response: {
          generatedVideos: [],
        },
      };
      mockClient.operations.getVideosOperation.mockResolvedValueOnce(mockOperation);

      const result = await pollGoogleVideoOperation(
        mockClient as any,
        'operations/test-123',
        'google',
        'test-api-key',
      );

      expect(result).toEqual({
        status: 'failed',
        error: 'No video generated',
      });
    });

    it('should return failed when video uri is empty string', async () => {
      const mockOperation = {
        done: true,
        response: {
          generatedVideos: [{ video: { uri: '' } }],
        },
      };
      mockClient.operations.getVideosOperation.mockResolvedValueOnce(mockOperation);

      const result = await pollGoogleVideoOperation(
        mockClient as any,
        'operations/test-123',
        'google',
        'test-api-key',
      );

      expect(result).toEqual({
        status: 'failed',
        error: 'Video URL is empty',
      });
    });

    it('should return failed when error message is missing', async () => {
      const mockOperation = {
        done: true,
        error: {},
      };
      mockClient.operations.getVideosOperation.mockResolvedValueOnce(mockOperation);

      const result = await pollGoogleVideoOperation(
        mockClient as any,
        'operations/test-123',
        'google',
        'test-api-key',
      );

      expect(result).toEqual({
        status: 'failed',
        error: 'Video generation failed',
      });
    });
  });

  describe('pending state', () => {
    it('should poll a qualified Veo operation resource', async () => {
      const qualifiedOperation =
        'projects/test/locations/us-central1/publishers/google/models/veo/operations/test-123';
      mockClient.operations.getVideosOperation.mockResolvedValueOnce({ done: false });

      const result = await pollGoogleVideoOperation(
        mockClient as any,
        qualifiedOperation,
        'google',
        'test-api-key',
      );

      expect(result).toEqual({ status: 'pending' });
      expect(mockClient.operations.getVideosOperation).toHaveBeenCalledWith({
        operation: expect.objectContaining({ name: qualifiedOperation }),
      });
      expect(mockClient.interactions.get).not.toHaveBeenCalled();
    });

    it('should return pending while a Gemini Omni interaction is in progress', async () => {
      mockClient.interactions.get.mockResolvedValueOnce({
        id: 'interactions/omni-pending',
        status: 'in_progress',
      });

      const result = await pollGoogleVideoOperation(
        mockClient as any,
        'interactions/omni-pending',
        'google',
        'test-api-key',
      );

      expect(result).toEqual({ status: 'pending' });
    });

    it('should return pending when operation not done', async () => {
      const mockOperation = { done: false };
      mockClient.operations.getVideosOperation.mockResolvedValueOnce(mockOperation);

      const result = await pollGoogleVideoOperation(
        mockClient as any,
        'operations/test-123',
        'google',
        'test-api-key',
      );

      expect(result).toEqual({ status: 'pending' });
    });

    it('should return pending when operation is partially done', async () => {
      const mockOperation = {
        done: false,
        name: 'operations/test-123',
        metadata: { progress: 50 },
      };
      mockClient.operations.getVideosOperation.mockResolvedValueOnce(mockOperation);

      const result = await pollGoogleVideoOperation(
        mockClient as any,
        'operations/test-123',
        'google',
        'test-api-key',
      );

      expect(result).toEqual({ status: 'pending' });
    });
  });

  describe('error handling', () => {
    it('should handle polling errors gracefully', async () => {
      mockClient.operations.getVideosOperation.mockRejectedValueOnce(new Error('Network error'));

      const result = await pollGoogleVideoOperation(
        mockClient as any,
        'operations/test-123',
        'google',
        'test-api-key',
      );

      expect(result).toEqual({
        status: 'failed',
        error: 'Network error',
      });
    });

    it('should return failed status when inferenceId is empty', async () => {
      const result = await pollGoogleVideoOperation(
        mockClient as any,
        '',
        'google',
        'test-api-key',
      );

      expect(result).toEqual({
        status: 'failed',
        error: 'Invalid operation name',
      });
    });

    it('should return failed status when inferenceId is null', async () => {
      const result = await pollGoogleVideoOperation(
        mockClient as any,
        null as any,
        'google',
        'test-api-key',
      );

      expect(result).toEqual({
        status: 'failed',
        error: 'Invalid operation name',
      });
    });

    it('should handle errors without message property', async () => {
      mockClient.operations.getVideosOperation.mockRejectedValueOnce({});

      const result = await pollGoogleVideoOperation(
        mockClient as any,
        'operations/test-123',
        'google',
        'test-api-key',
      );

      expect(result).toEqual({
        status: 'failed',
        error: 'Failed to poll video status',
      });
    });

    it('should handle network timeout errors', async () => {
      mockClient.operations.getVideosOperation.mockRejectedValueOnce(new Error('ETIMEDOUT'));

      const result = await pollGoogleVideoOperation(
        mockClient as any,
        'operations/test-123',
        'google',
        'test-api-key',
      );

      expect(result).toEqual({
        status: 'failed',
        error: 'ETIMEDOUT',
      });
    });

    it('should handle authentication errors', async () => {
      mockClient.operations.getVideosOperation.mockRejectedValueOnce(new Error('API_KEY_INVALID'));

      const result = await pollGoogleVideoOperation(
        mockClient as any,
        'operations/test-123',
        'google',
        'invalid-key',
      );

      expect(result).toEqual({
        status: 'failed',
        error: 'API_KEY_INVALID',
      });
    });
  });

  describe('logging', () => {
    it('should log polling request', async () => {
      const mockOperation = {
        done: true,
        response: {
          generatedVideos: [{ video: { uri: 'https://example.com/video.mp4' } }],
        },
      };
      mockClient.operations.getVideosOperation.mockResolvedValueOnce(mockOperation);

      await pollGoogleVideoOperation(
        mockClient as any,
        'operations/test-123',
        'google',
        'test-api-key',
      );

      expect(mockClient.operations.getVideosOperation).toHaveBeenCalledWith({
        operation: expect.objectContaining({
          name: 'operations/test-123',
        }),
      });
    });
  });
});
