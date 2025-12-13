// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CreateImageOptions } from '../../core/openaiCompatibleFactory';
import { CreateImagePayload } from '../../types/image';
import { createQwenImage } from './createImage';

// Mock the console.error to avoid polluting test output
vi.spyOn(console, 'error').mockImplementation(() => {});

const mockOptions: CreateImageOptions = {
  apiKey: 'test-api-key',
  provider: 'qwen',
};

beforeEach(() => {
  // Reset all mocks before each test
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('createQwenImage', () => {
  describe('Success scenarios', () => {
    it('should successfully generate image with immediate success', async () => {
      const mockTaskId = 'task-123456';
      const mockImageUrl = 'https://dashscope.oss-cn-beijing.aliyuncs.com/aigc/test-image.jpg';

      // Mock fetch for task creation and immediate success
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            output: { task_id: mockTaskId },
            request_id: 'req-123',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            output: {
              task_id: mockTaskId,
              task_status: 'SUCCEEDED',
              results: [{ url: mockImageUrl }],
            },
            request_id: 'req-124',
          }),
        });

      const payload: CreateImagePayload = {
        model: 'wanx2.1-t2i-turbo',
        params: {
          prompt: 'A beautiful sunset over the mountains',
        },
      };

      const result = await createQwenImage(payload, mockOptions);

      // Verify task creation request
      expect(fetch).toHaveBeenCalledWith(
        'https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis',
        {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer test-api-key',
            'Content-Type': 'application/json',
            'X-DashScope-Async': 'enable',
          },
          body: JSON.stringify({
            input: {
              prompt: 'A beautiful sunset over the mountains',
            },
            model: 'wanx2.1-t2i-turbo',
            parameters: {
              n: 1,
              size: '1024*1024',
            },
          }),
        },
      );

      // Verify status query request
      expect(fetch).toHaveBeenCalledWith(
        `https://dashscope.aliyuncs.com/api/v1/tasks/${mockTaskId}`,
        {
          headers: {
            Authorization: 'Bearer test-api-key',
          },
        },
      );

      expect(result).toEqual({
        imageUrl: mockImageUrl,
      });
    });

    it('should handle task that needs polling before success', async () => {
      const mockTaskId = 'task-polling';
      const mockImageUrl = 'https://dashscope.oss-cn-beijing.aliyuncs.com/aigc/test-image-3.jpg';

      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            output: { task_id: mockTaskId },
            request_id: 'req-127',
          }),
        })
        // First status query - still running
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            output: {
              task_id: mockTaskId,
              task_status: 'RUNNING',
            },
            request_id: 'req-128',
          }),
        })
        // Second status query - succeeded
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            output: {
              task_id: mockTaskId,
              task_status: 'SUCCEEDED',
              results: [{ url: mockImageUrl }],
            },
            request_id: 'req-129',
          }),
        });

      const payload: CreateImagePayload = {
        model: 'wanx2.1-t2i-turbo',
        params: {
          prompt: 'Abstract digital art',
        },
      };

      const result = await createQwenImage(payload, mockOptions);

      // Should have made 3 fetch calls: 1 create + 2 status checks
      expect(fetch).toHaveBeenCalledTimes(3);
      expect(result).toEqual({
        imageUrl: mockImageUrl,
      });
    });

    it('should handle custom image dimensions', async () => {
      const mockTaskId = 'task-custom-size';
      const mockImageUrl = 'https://dashscope.oss-cn-beijing.aliyuncs.com/aigc/custom-size.jpg';

      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            output: { task_id: mockTaskId },
            request_id: 'req-140',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            output: {
              task_id: mockTaskId,
              task_status: 'SUCCEEDED',
              results: [{ url: mockImageUrl }],
            },
            request_id: 'req-141',
          }),
        });

      const payload: CreateImagePayload = {
        model: 'wanx2.1-t2i-turbo',
        params: {
          prompt: 'Custom size image',
          width: 512,
          height: 768,
        },
      };

      await createQwenImage(payload, mockOptions);

      expect(fetch).toHaveBeenCalledWith(
        'https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis',
        expect.objectContaining({
          body: JSON.stringify({
            input: {
              prompt: 'Custom size image',
            },
            model: 'wanx2.1-t2i-turbo',
            parameters: {
              n: 1,
              size: '512*768',
            },
          }),
        }),
      );
    });

    it('should handle long running tasks with retries', async () => {
      const mockTaskId = 'task-long-running';

      // Mock status query that returns RUNNING a few times then succeeds
      let statusCallCount = 0;
      const statusQueryMock = vi.fn().mockImplementation(() => {
        statusCallCount++;
        if (statusCallCount <= 3) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              output: {
                task_id: mockTaskId,
                task_status: 'RUNNING',
              },
              request_id: `req-${133 + statusCallCount}`,
            }),
          });
        } else {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              output: {
                task_id: mockTaskId,
                task_status: 'SUCCEEDED',
                results: [{ url: 'https://example.com/final-image.jpg' }],
              },
              request_id: 'req-137',
            }),
          });
        }
      });

      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            output: { task_id: mockTaskId },
            request_id: 'req-132',
          }),
        })
        .mockImplementation(statusQueryMock);

      const payload: CreateImagePayload = {
        model: 'wanx2.1-t2i-turbo',
        params: {
          prompt: 'Long running task',
        },
      };

      // Mock setTimeout to make test run faster but still allow controlled execution
      vi.spyOn(global, 'setTimeout').mockImplementation((callback: any) => {
        // Use setImmediate to avoid recursion issues
        setImmediate(callback);
        return 1 as any;
      });

      const result = await createQwenImage(payload, mockOptions);

      expect(result).toEqual({
        imageUrl: 'https://example.com/final-image.jpg',
      });

      // Should have made 1 create call + 4 status calls (3 RUNNING + 1 SUCCEEDED)
      expect(fetch).toHaveBeenCalledTimes(5);
    });

    it('should handle seed value of 0 correctly', async () => {
      const mockTaskId = 'task-with-zero-seed';
      const mockImageUrl = 'https://dashscope.oss-cn-beijing.aliyuncs.com/aigc/seed-zero.jpg';

      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            output: { task_id: mockTaskId },
            request_id: 'req-seed-0',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            output: {
              task_id: mockTaskId,
              task_status: 'SUCCEEDED',
              results: [{ url: mockImageUrl }],
            },
            request_id: 'req-seed-0-status',
          }),
        });

      const payload: CreateImagePayload = {
        model: 'wanx2.1-t2i-turbo',
        params: {
          prompt: 'Image with seed 0',
          seed: 0,
        },
      };

      await createQwenImage(payload, mockOptions);

      // Verify that seed: 0 is included in the request
      expect(fetch).toHaveBeenCalledWith(
        'https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis',
        expect.objectContaining({
          body: JSON.stringify({
            input: {
              prompt: 'Image with seed 0',
            },
            model: 'wanx2.1-t2i-turbo',
            parameters: {
              n: 1,
              seed: 0,
              size: '1024*1024',
            },
          }),
        }),
      );
    });
  });

  describe('Error scenarios', () => {
    it('should handle task creation failure', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        statusText: 'Bad Request',
        json: async () => ({
          message: 'Invalid model name',
        }),
      });

      const payload: CreateImagePayload = {
        model: 'invalid-model',
        params: {
          prompt: 'Test prompt',
        },
      };

      await expect(createQwenImage(payload, mockOptions)).rejects.toEqual(
        expect.objectContaining({
          errorType: 'ProviderBizError',
          provider: 'qwen',
        }),
      );
    });

    it('should handle non-JSON error responses', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => {
          throw new Error('Failed to parse JSON');
        },
      });

      const payload: CreateImagePayload = {
        model: 'wanx2.1-t2i-turbo',
        params: {
          prompt: 'Test prompt',
        },
      };

      await expect(createQwenImage(payload, mockOptions)).rejects.toEqual(
        expect.objectContaining({
          errorType: 'ProviderBizError',
          provider: 'qwen',
        }),
      );
    });

    it('should handle task failure status', async () => {
      const mockTaskId = 'task-failed';

      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            output: { task_id: mockTaskId },
            request_id: 'req-130',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            output: {
              task_id: mockTaskId,
              task_status: 'FAILED',
              error_message: 'Content policy violation',
            },
            request_id: 'req-131',
          }),
        });

      const payload: CreateImagePayload = {
        model: 'wanx2.1-t2i-turbo',
        params: {
          prompt: 'Invalid prompt that causes failure',
        },
      };

      await expect(createQwenImage(payload, mockOptions)).rejects.toEqual(
        expect.objectContaining({
          errorType: 'ProviderBizError',
          provider: 'qwen',
        }),
      );
    });

    it('should handle task succeeded but no results', async () => {
      const mockTaskId = 'task-no-results';

      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            output: { task_id: mockTaskId },
            request_id: 'req-134',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            output: {
              task_id: mockTaskId,
              task_status: 'SUCCEEDED',
              results: [], // Empty results array
            },
            request_id: 'req-135',
          }),
        });

      const payload: CreateImagePayload = {
        model: 'wanx2.1-t2i-turbo',
        params: {
          prompt: 'Test prompt',
        },
      };

      await expect(createQwenImage(payload, mockOptions)).rejects.toEqual(
        expect.objectContaining({
          errorType: 'ProviderBizError',
          provider: 'qwen',
        }),
      );
    });

    it('should handle status query failure', async () => {
      const mockTaskId = 'task-query-fail';

      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            output: { task_id: mockTaskId },
            request_id: 'req-136',
          }),
        })
        .mockResolvedValueOnce({
          ok: false,
          statusText: 'Unauthorized',
          json: async () => ({
            message: 'Invalid API key',
          }),
        });

      const payload: CreateImagePayload = {
        model: 'wanx2.1-t2i-turbo',
        params: {
          prompt: 'Test prompt',
        },
      };

      await expect(createQwenImage(payload, mockOptions)).rejects.toEqual(
        expect.objectContaining({
          errorType: 'ProviderBizError',
          provider: 'qwen',
        }),
      );
    });

    it('should handle transient status query failures and retry', async () => {
      const mockTaskId = 'task-transient-failure';
      const mockImageUrl = 'https://dashscope.oss-cn-beijing.aliyuncs.com/aigc/retry-success.jpg';

      let statusQueryCount = 0;
      const statusQueryMock = vi.fn().mockImplementation(() => {
        statusQueryCount++;
        if (statusQueryCount === 1 || statusQueryCount === 2) {
          // First two calls fail
          return Promise.reject(new Error('Network timeout'));
        } else {
          // Third call succeeds
          return Promise.resolve({
            ok: true,
            json: async () => ({
              output: {
                task_id: mockTaskId,
                task_status: 'SUCCEEDED',
                results: [{ url: mockImageUrl }],
              },
              request_id: 'req-retry-success',
            }),
          });
        }
      });

      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            output: { task_id: mockTaskId },
            request_id: 'req-transient',
          }),
        })
        .mockImplementation(statusQueryMock);

      const payload: CreateImagePayload = {
        model: 'wanx2.1-t2i-turbo',
        params: {
          prompt: 'Test transient failure',
        },
      };

      // Mock setTimeout to make test run faster
      vi.spyOn(global, 'setTimeout').mockImplementation((callback: any) => {
        setImmediate(callback);
        return 1 as any;
      });

      const result = await createQwenImage(payload, mockOptions);

      expect(result).toEqual({
        imageUrl: mockImageUrl,
      });

      // Verify the mock was called the expected number of times
      expect(statusQueryMock).toHaveBeenCalledTimes(3); // 2 failures + 1 success

      // Should have made 1 create call + 3 status calls (2 failed + 1 succeeded)
      expect(fetch).toHaveBeenCalledTimes(4);
    });

    it('should fail after consecutive query failures', async () => {
      const mockTaskId = 'task-consecutive-failures';

      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            output: { task_id: mockTaskId },
            request_id: 'req-will-fail',
          }),
        })
        // All subsequent calls fail
        .mockRejectedValue(new Error('Persistent network error'));

      const payload: CreateImagePayload = {
        model: 'wanx2.1-t2i-turbo',
        params: {
          prompt: 'Test persistent failure',
        },
      };

      // Mock setTimeout to make test run faster
      vi.spyOn(global, 'setTimeout').mockImplementation((callback: any) => {
        setImmediate(callback);
        return 1 as any;
      });

      await expect(createQwenImage(payload, mockOptions)).rejects.toEqual(
        expect.objectContaining({
          errorType: 'ProviderBizError',
          provider: 'qwen',
        }),
      );

      // Should have made 1 create call + 3 failed status calls (maxConsecutiveFailures)
      expect(fetch).toHaveBeenCalledTimes(4);
    });
  });

  describe('qwen-image-edit model', () => {
    it('should successfully generate image with qwen-image-edit model', async () => {
      const mockImageUrl =
        'https://dashscope.oss-cn-beijing.aliyuncs.com/aigc/test-generated-image.jpg';

      // Mock fetch for multimodal-generation API
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          output: {
            choices: [
              {
                message: {
                  content: [{ image: mockImageUrl }],
                },
              },
            ],
          },
          request_id: 'req-edit-123',
        }),
      });

      const payload: CreateImagePayload = {
        model: 'qwen-image-edit',
        params: {
          prompt: 'Edit this image to add a cat',
          imageUrl: 'https://example.com/source-image.jpg',
        },
      };

      const result = await createQwenImage(payload, mockOptions);

      expect(result).toEqual({
        imageUrl: mockImageUrl,
      });

      expect(fetch).toHaveBeenCalled();
      const [url, options] = (fetch as any).mock.calls[0];

      expect(url).toBe(
        'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
      );
      expect(options.method).toBe('POST');
      expect(options.headers).toEqual({
        'Authorization': 'Bearer test-api-key',
        'Content-Type': 'application/json',
      });

      const body = JSON.parse(options.body);
      expect(body).toEqual({
        input: {
          messages: [
            {
              content: [
                { image: 'https://example.com/source-image.jpg' },
                { text: 'Edit this image to add a cat' },
              ],
              role: 'user',
            },
          ],
        },
        model: 'qwen-image-edit',
        parameters: {},
      });
    });

    it('should throw error when imageUrl is missing for qwen-image-edit', async () => {
      const payload: CreateImagePayload = {
        model: 'qwen-image-edit',
        params: {
          prompt: 'Edit this image',
          // imageUrl is missing
        },
      };

      await expect(createQwenImage(payload, mockOptions)).rejects.toEqual(
        expect.objectContaining({
          errorType: 'ProviderBizError',
          provider: 'qwen',
        }),
      );
    });

    it('should handle qwen-image-edit API errors', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({
          message: 'Invalid image format',
        }),
      });

      const payload: CreateImagePayload = {
        model: 'qwen-image-edit',
        params: {
          prompt: 'Edit this image',
          imageUrl: 'https://example.com/invalid-image.jpg',
        },
      };

      await expect(createQwenImage(payload, mockOptions)).rejects.toEqual(
        expect.objectContaining({
          errorType: 'ProviderBizError',
          provider: 'qwen',
        }),
      );
    });

    it('should convert imageUrls array to imageUrl for qwen-image-edit', async () => {
      const mockImageUrl =
        'https://dashscope.oss-cn-beijing.aliyuncs.com/aigc/imageUrls-converted.jpg';

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          output: {
            choices: [
              {
                message: {
                  content: [{ image: mockImageUrl }],
                },
              },
            ],
          },
          request_id: 'req-imageUrls-123',
        }),
      });

      const payload: CreateImagePayload = {
        model: 'qwen-image-edit',
        params: {
          prompt: 'Edit this image to add a dog',
          imageUrls: [
            'https://example.com/source-image-1.jpg',
            'https://example.com/source-image-2.jpg',
          ],
        },
      };

      const result = await createQwenImage(payload, mockOptions);

      expect(result).toEqual({
        imageUrl: mockImageUrl,
      });

      const [url, options] = (fetch as any).mock.calls[0];
      const body = JSON.parse(options.body);

      // Verify that the first imageUrl from imageUrls array was used
      expect(body.input.messages[0].content[0].image).toBe(
        'https://example.com/source-image-1.jpg',
      );
    });

    it('should use first imageUrl when imageUrls has multiple elements', async () => {
      const mockImageUrl = 'https://dashscope.oss-cn-beijing.aliyuncs.com/aigc/first-element.jpg';

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          output: {
            choices: [
              {
                message: {
                  content: [{ image: mockImageUrl }],
                },
              },
            ],
          },
          request_id: 'req-first-element',
        }),
      });

      const payload: CreateImagePayload = {
        model: 'qwen-image-edit',
        params: {
          prompt: 'Use the first image only',
          imageUrls: [
            'https://example.com/first-image.jpg',
            'https://example.com/second-image.jpg',
            'https://example.com/third-image.jpg',
          ],
        },
      };

      await createQwenImage(payload, mockOptions);

      const [url, options] = (fetch as any).mock.calls[0];
      const body = JSON.parse(options.body);

      // Should use only the first image from the array
      expect(body.input.messages[0].content[0].image).toBe('https://example.com/first-image.jpg');
    });

    it('should throw error when imageUrls is empty array', async () => {
      const payload: CreateImagePayload = {
        model: 'qwen-image-edit',
        params: {
          prompt: 'Edit this image',
          imageUrls: [], // Empty array
        },
      };

      await expect(createQwenImage(payload, mockOptions)).rejects.toEqual(
        expect.objectContaining({
          errorType: 'ProviderBizError',
          provider: 'qwen',
        }),
      );
    });

    it('should prioritize imageUrl over imageUrls when both are provided', async () => {
      const mockImageUrl = 'https://dashscope.oss-cn-beijing.aliyuncs.com/aigc/priority-test.jpg';

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          output: {
            choices: [
              {
                message: {
                  content: [{ image: mockImageUrl }],
                },
              },
            ],
          },
          request_id: 'req-priority-test',
        }),
      });

      const payload: CreateImagePayload = {
        model: 'qwen-image-edit',
        params: {
          prompt: 'Test priority between imageUrl and imageUrls',
          imageUrl: 'https://example.com/priority-image.jpg',
          imageUrls: [
            'https://example.com/should-not-use-1.jpg',
            'https://example.com/should-not-use-2.jpg',
          ],
        },
      };

      await createQwenImage(payload, mockOptions);

      const [url, options] = (fetch as any).mock.calls[0];
      const body = JSON.parse(options.body);

      // Should use imageUrl, not imageUrls
      expect(body.input.messages[0].content[0].image).toBe(
        'https://example.com/priority-image.jpg',
      );
    });

    it('should throw error when neither imageUrl nor imageUrls are provided', async () => {
      const payload: CreateImagePayload = {
        model: 'qwen-image-edit',
        params: {
          prompt: 'Edit this image',
          // Neither imageUrl nor imageUrls provided
        },
      };

      await expect(createQwenImage(payload, mockOptions)).rejects.toEqual(
        expect.objectContaining({
          errorType: 'ProviderBizError',
          provider: 'qwen',
        }),
      );
    });
  });
});
