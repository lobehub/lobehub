// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CreateImageOptions } from '../../core/openaiCompatibleFactory';
import type { CreateImagePayload } from '../../types/image';
import { createHunyuanImage } from './createImage';

vi.spyOn(console, 'error').mockImplementation(() => {});

const mockOptions: CreateImageOptions = {
  apiKey: 'sk-test-api-key',
  baseURL: 'https://api.cloudai.tencent.com/v1',
  provider: 'hunyuan',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('createHunyuanImage', () => {
  describe('Success scenarios', () => {
    it('should successfully generate image with lite model', async () => {
      const mockImageUrl = 'https://hyimg.tencentmaas.com/test/lite.png';

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          created: 1774806537,
          request_id: 'req-lite-123',
          data: [{ url: mockImageUrl }],
        }),
      });

      const payload: CreateImagePayload = {
        model: 'HY-Image-Lite',
        params: {
          prompt: '雨中, 竹林, 小路',
        },
      };

      const result = await createHunyuanImage(payload, mockOptions);

      const submitCall = (fetch as any).mock.calls[0];
      expect(submitCall[0]).toBe('https://api.cloudai.tencent.com/v1/api/image/lite');
      const submitBody = JSON.parse(submitCall[1].body);
      expect(submitBody).toEqual({
        model: 'HY-Image-Lite',
        prompt: '雨中, 竹林, 小路',
        resolution: '1024:1024',
        rsp_img_type: 'url',
      });

      expect(result).toEqual({
        imageUrl: mockImageUrl,
      });
    });

    it('should successfully generate image with basic prompt', async () => {
      const mockJobId = '251*************0';
      const mockImageUrl = 'https://****965e';

      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            id: mockJobId,
            request_id: 'req-123',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            request_id: 'req-456',
            status: 'completed',
            data: [{ url: mockImageUrl }],
          }),
        });

      const payload: CreateImagePayload = {
        model: 'HY-Image-V3.0',
        params: {
          prompt: '在图片中增加一个橘猫',
        },
      };

      const resultPromise = createHunyuanImage(payload, mockOptions);
      await vi.advanceTimersByTimeAsync(1000);
      const result = await resultPromise;

      const submitCall = (fetch as any).mock.calls[0];
      expect(submitCall[0]).toBe('https://api.cloudai.tencent.com/v1/api/image/submit');
      const submitBody = JSON.parse(submitCall[1].body);
      expect(submitBody).toEqual({
        model: 'HY-Image-V3.0',
        prompt: '在图片中增加一个橘猫',
        resolution: '1024:1024',
      });

      const queryCall = (fetch as any).mock.calls[1];
      expect(queryCall[0]).toBe('https://api.cloudai.tencent.com/v1/api/image/query');
      const queryBody = JSON.parse(queryCall[1].body);
      expect(queryBody).toEqual({ model: 'HY-Image-V3.0', id: mockJobId });

      expect(result).toEqual({
        imageUrl: mockImageUrl,
      });
    });

    it('should handle custom size parameter', async () => {
      const mockJobId = 'job-custom-size';
      const mockImageUrl = 'https://aiart.tencent.com/test/custom.png';

      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: mockJobId }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            status: 'completed',
            data: [{ url: mockImageUrl }],
          }),
        });

      const payload: CreateImagePayload = {
        model: 'HY-Image-V3.0',
        params: {
          prompt: 'Custom size test',
          size: '1024x1024',
        },
      };

      const resultPromise = createHunyuanImage(payload, mockOptions);
      await vi.advanceTimersByTimeAsync(1000);
      const result = await resultPromise;

      const submitBody = JSON.parse((fetch as any).mock.calls[0][1].body);
      expect(submitBody.resolution).toBe('1024:1024');
      expect(result.imageUrl).toBe(mockImageUrl);
    });

    it('should handle width and height parameters', async () => {
      const mockJobId = 'job-dims';
      const mockImageUrl = 'https://aiart.tencent.com/test/dims.png';

      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: mockJobId }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            status: 'completed',
            data: [{ url: mockImageUrl }],
          }),
        });

      const payload: CreateImagePayload = {
        model: 'HY-Image-V3.0',
        params: {
          prompt: 'Custom dimensions',
          width: 1024,
          height: 768,
        },
      };

      const resultPromise = createHunyuanImage(payload, mockOptions);
      await vi.advanceTimersByTimeAsync(1000);
      const result = await resultPromise;

      const submitBody = JSON.parse((fetch as any).mock.calls[0][1].body);
      expect(submitBody.resolution).toBe('1024:768');
      expect(result.imageUrl).toBe(mockImageUrl);
    });

    it('should handle seed parameter', async () => {
      const mockJobId = 'job-seed';
      const mockImageUrl = 'https://aiart.tencent.com/test/seed.png';

      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: mockJobId }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            status: 'completed',
            data: [{ url: mockImageUrl }],
          }),
        });

      const payload: CreateImagePayload = {
        model: 'HY-Image-V3.0',
        params: {
          prompt: 'With seed',
          seed: 84445,
        },
      };

      const resultPromise = createHunyuanImage(payload, mockOptions);
      await vi.advanceTimersByTimeAsync(1000);
      await resultPromise;

      const submitBody = JSON.parse((fetch as any).mock.calls[0][1].body);
      expect(submitBody.seed).toBe(84445);
    });

    it('should handle imageUrls for image-to-image', async () => {
      const mockJobId = 'job-img2img';
      const mockImageUrl = 'https://aiart.tencent.com/test/edited.png';

      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: mockJobId }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            status: 'completed',
            data: [{ url: mockImageUrl }],
          }),
        });

      const payload: CreateImagePayload = {
        model: 'HY-Image-V3.0',
        params: {
          prompt: 'Add a cat',
          imageUrls: ['https://example.com/source.png'],
        },
      };

      const resultPromise = createHunyuanImage(payload, mockOptions);
      await vi.advanceTimersByTimeAsync(1000);
      const result = await resultPromise;

      const submitBody = JSON.parse((fetch as any).mock.calls[0][1].body);
      expect(submitBody.images).toEqual(['https://example.com/source.png']);
      expect(result.imageUrl).toBe(mockImageUrl);
    });

    it('should poll multiple times until completion', async () => {
      const mockJobId = 'job-polling';
      const mockImageUrl = 'https://aiart.tencent.com/test/final.png';

      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: mockJobId }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ status: 'queued' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ status: 'processing' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            status: 'completed',
            data: [{ url: mockImageUrl }],
          }),
        });

      const payload: CreateImagePayload = {
        model: 'HY-Image-V3.0',
        params: {
          prompt: 'Polling test',
        },
      };

      const resultPromise = createHunyuanImage(payload, mockOptions);
      await vi.advanceTimersByTimeAsync(2000);
      const result = await resultPromise;

      expect(result.imageUrl).toBe(mockImageUrl);
      expect((fetch as any).mock.calls.length).toBe(4);
    });
  });

  describe('Error scenarios - Submit endpoint', () => {
    it('should handle 401 unauthorized error', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({
          error: {
            message: 'Incorrect API key provided',
            type: 'invalid_request_error',
          },
        }),
      });

      const payload: CreateImagePayload = {
        model: 'HY-Image-V3.0',
        params: { prompt: 'Test' },
      };

      await expect(createHunyuanImage(payload, mockOptions)).rejects.toEqual(
        expect.objectContaining({
          errorType: 'ProviderBizError',
          provider: 'hunyuan',
        }),
      );
    });

    it('should handle image download error', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          request_id: 'req-123',
          id: '',
          error: {
            message: '图片下载错误。',
            type: 'api_error',
            code: 'FailedOperation.ImageDownloadError',
          },
        }),
      });

      const payload: CreateImagePayload = {
        model: 'HY-Image-V3.0',
        params: { prompt: 'Test' },
      };

      await expect(createHunyuanImage(payload, mockOptions)).rejects.toEqual(
        expect.objectContaining({
          errorType: 'ProviderBizError',
          provider: 'hunyuan',
        }),
      );
    });

    it('should handle missing job id', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ request_id: 'req-123' }),
      });

      const payload: CreateImagePayload = {
        model: 'HY-Image-V3.0',
        params: { prompt: 'Test' },
      };

      await expect(createHunyuanImage(payload, mockOptions)).rejects.toEqual(
        expect.objectContaining({
          errorType: 'ProviderBizError',
          provider: 'hunyuan',
        }),
      );
    });

    it('should handle HTTP error with error.message format', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ message: 'Invalid prompt' }),
      });

      const payload: CreateImagePayload = {
        model: 'HY-Image-V3.0',
        params: { prompt: 'Invalid' },
      };

      await expect(createHunyuanImage(payload, mockOptions)).rejects.toEqual(
        expect.objectContaining({
          errorType: 'ProviderBizError',
          provider: 'hunyuan',
        }),
      );
    });
  });

  describe('Error scenarios - Query endpoint', () => {
    it('should handle API error in query response', async () => {
      const mockJobId = 'job-query-error';

      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: mockJobId }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            status: '',
            error: {
              message: 'Unknown job status: ',
              type: 'api_error',
            },
          }),
        });

      const payload: CreateImagePayload = {
        model: 'HY-Image-V3.0',
        params: { prompt: 'Test' },
      };

      try {
        await createHunyuanImage(payload, mockOptions);
        expect.fail('Expected error to be thrown');
      } catch (error) {
        expect(error).toEqual(
          expect.objectContaining({
            errorType: 'ProviderBizError',
            provider: 'hunyuan',
          }),
        );
      }
    });

    it('should handle missing status in query response', async () => {
      const mockJobId = 'job-no-status';

      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: mockJobId }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({}),
        });

      const payload: CreateImagePayload = {
        model: 'HY-Image-V3.0',
        params: { prompt: 'Test' },
      };

      try {
        await createHunyuanImage(payload, mockOptions);
        expect.fail('Expected error to be thrown');
      } catch (error) {
        expect(error).toEqual(
          expect.objectContaining({
            errorType: 'ProviderBizError',
            provider: 'hunyuan',
          }),
        );
      }
    });

    it('should handle failed status', async () => {
      const mockJobId = 'job-failed';

      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: mockJobId }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ status: 'failed' }),
        });

      const payload: CreateImagePayload = {
        model: 'HY-Image-V3.0',
        params: { prompt: 'Test' },
      };

      try {
        await createHunyuanImage(payload, mockOptions);
        expect.fail('Expected error to be thrown');
      } catch (error) {
        expect(error).toEqual(
          expect.objectContaining({
            errorType: 'ProviderBizError',
            provider: 'hunyuan',
          }),
        );
      }
    });

    it('should handle completed status with empty data', async () => {
      const mockJobId = 'job-empty-data';

      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: mockJobId }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ status: 'completed', data: null }),
        });

      const payload: CreateImagePayload = {
        model: 'HY-Image-V3.0',
        params: { prompt: 'Test' },
      };

      try {
        await createHunyuanImage(payload, mockOptions);
        expect.fail('Expected error to be thrown');
      } catch (error) {
        expect(error).toEqual(
          expect.objectContaining({
            errorType: 'ProviderBizError',
            provider: 'hunyuan',
          }),
        );
      }
    });

    it('should handle completed status with empty images array', async () => {
      const mockJobId = 'job-empty-images';

      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: mockJobId }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ status: 'completed', data: [] }),
        });

      const payload: CreateImagePayload = {
        model: 'HY-Image-V3.0',
        params: { prompt: 'Test' },
      };

      try {
        await createHunyuanImage(payload, mockOptions);
        expect.fail('Expected error to be thrown');
      } catch (error) {
        expect(error).toEqual(
          expect.objectContaining({
            errorType: 'ProviderBizError',
            provider: 'hunyuan',
          }),
        );
      }
    });

    it('should handle network error', async () => {
      global.fetch = vi.fn().mockRejectedValueOnce(new Error('Network error'));

      const payload: CreateImagePayload = {
        model: 'HY-Image-V3.0',
        params: { prompt: 'Test' },
      };

      await expect(createHunyuanImage(payload, mockOptions)).rejects.toEqual(
        expect.objectContaining({
          errorType: 'ProviderBizError',
          provider: 'hunyuan',
        }),
      );
    });
  });
});
