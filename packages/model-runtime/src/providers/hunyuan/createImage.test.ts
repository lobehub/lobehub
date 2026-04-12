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
    it('should successfully generate image with basic prompt', async () => {
      const mockJobId = '1301052320-1774048771-3ff52e2c-24b3-11f1-aca3-525400cc0b9a-0';
      const mockImageUrl = 'https://aiart-1258344699.cos.ap-guangzhou.myqcloud.com/test/image.png';

      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            request_id: 'req-123',
            job_id: mockJobId,
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            request_id: 'req-456',
            status: '5',
            data: [{ url: mockImageUrl }],
          }),
        });

      const payload: CreateImagePayload = {
        model: 'HY-Image-V3.0',
        params: {
          prompt: '生成一个可爱猫猫',
        },
      };

      const resultPromise = createHunyuanImage(payload, mockOptions);
      await vi.advanceTimersByTimeAsync(1000);
      const result = await resultPromise;

      const submitCall = (fetch as any).mock.calls[0];
      expect(submitCall[0]).toBe('https://api.cloudai.tencent.com/v1/aiart/submit');
      const submitBody = JSON.parse(submitCall[1].body);
      expect(submitBody).toEqual({
        model: 'HY-Image-V3.0',
        prompt: '生成一个可爱猫猫',
        size: '1024:1024',
        extra_body: {
          logo_add: 0,
          revise: 0,
        },
      });

      const queryCall = (fetch as any).mock.calls[1];
      expect(queryCall[0]).toBe('https://api.cloudai.tencent.com/v1/aiart/query');
      const queryBody = JSON.parse(queryCall[1].body);
      expect(queryBody).toEqual({ job_id: mockJobId });

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
          json: async () => ({ job_id: mockJobId }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            status: '5',
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
      expect(submitBody.size).toBe('1024:1024');
      expect(result.imageUrl).toBe(mockImageUrl);
    });

    it('should handle width and height parameters', async () => {
      const mockJobId = 'job-dims';
      const mockImageUrl = 'https://aiart.tencent.com/test/dims.png';

      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ job_id: mockJobId }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            status: '5',
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
      expect(submitBody.size).toBe('1024:768');
      expect(result.imageUrl).toBe(mockImageUrl);
    });

    it('should handle seed parameter', async () => {
      const mockJobId = 'job-seed';
      const mockImageUrl = 'https://aiart.tencent.com/test/seed.png';

      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ job_id: mockJobId }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            status: '5',
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
      expect(submitBody.extra_body.seed).toBe(84445);
    });

    it('should handle imageUrls for image-to-image', async () => {
      const mockJobId = 'job-img2img';
      const mockImageUrl = 'https://aiart.tencent.com/test/edited.png';

      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ job_id: mockJobId }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            status: '5',
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
          json: async () => ({ job_id: mockJobId }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ status: '1' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ status: '2' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            status: '5',
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
          job_id: '',
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

    it('should handle missing job_id', async () => {
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
        json: async () => ({
          message: 'Invalid prompt',
        }),
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
          json: async () => ({ job_id: mockJobId }),
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
          json: async () => ({ job_id: mockJobId }),
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
          json: async () => ({ job_id: mockJobId }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ status: '4' }),
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
          json: async () => ({ job_id: mockJobId }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ status: '5', data: null }),
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
          json: async () => ({ job_id: mockJobId }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ status: '5', data: [] }),
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
