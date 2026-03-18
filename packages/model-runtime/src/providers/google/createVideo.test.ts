// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CreateVideoPayload } from '../../types/video';
import { createGoogleVideo, pollGoogleVideoOperation } from './createVideo';

vi.mock('debug', () => ({
  default: vi.fn(() => vi.fn()),
}));

vi.mock('@google/genai', () => ({
  GenerateVideosOperation: class {
    name: string = '';
  },
}));

describe('createGoogleVideo', () => {
  const mockClient = {
    models: {
      generateVideos: vi.fn(),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('successful creation', () => {
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
    it('should include aspectRatio in config as aspect_ratio', async () => {
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
      expect(callArgs.config).toEqual({ aspect_ratio: '16:9' });
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
        aspect_ratio: '21:9',
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
      expect(callArgs.image).toBe('https://example.com/first.jpg');
    });

    it('should include endImageUrl as last_frame in config', async () => {
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
      expect(callArgs.image).toBe('https://example.com/first.jpg');
      expect(callArgs.config.last_frame).toBe('https://example.com/last.jpg');
    });

    it('should include duration as duration_seconds in config', async () => {
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
      expect(callArgs.config.duration_seconds).toBe(5);
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
      expect(callArgs.duration).toBeUndefined();
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
        },
      };

      await createGoogleVideo(mockClient as any, 'google', payload);

      const callArgs = mockClient.models.generateVideos.mock.calls[0][0];
      expect(callArgs).toEqual({
        model: 'veo-2.0-generate-001',
        prompt: 'Full featured video',
        config: {
          aspect_ratio: '16:9',
          resolution: '4k',
          last_frame: 'https://example.com/end.jpg',
          duration_seconds: 10,
        },
        image: 'https://example.com/start.jpg',
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
        errorType: expect.any(String),
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
  });
});

describe('pollGoogleVideoOperation', () => {
  const mockClient = {
    operations: {
      getVideosOperation: vi.fn(),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('successful completion', () => {
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
  });

  describe('pending state', () => {
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
  });
});
