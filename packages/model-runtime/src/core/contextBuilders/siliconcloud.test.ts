/// <reference types="vitest" />
import OpenAI from 'openai';
import { ssrfSafeFetch } from 'ssrf-safe-fetch';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { convertSiliconCloudMessageContent, transformSiliconCloudMessages } from './siliconcloud';

// Mock ssrfSafeFetch before importing
vi.mock('ssrf-safe-fetch', () => ({
  ssrfSafeFetch: vi.fn(),
}));

describe('siliconcloud context builder', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  describe('convertSiliconCloudMessageContent', () => {
    it('should return content unchanged when not video_url', async () => {
      const content: OpenAI.ChatCompletionContentPart = {
        type: 'text',
        text: 'Hello world',
      };

      const result = await convertSiliconCloudMessageContent(content);
      expect(result).toBe(content);
    });

    it('should return base64 content unchanged', async () => {
      const content: any = {
        type: 'video_url',
        video_url: {
          url: 'data:video/mp4;base64,somebase64data',
        },
      };

      const result = await convertSiliconCloudMessageContent(content);
      expect(result).toBe(content);
    });

    it('should return URL content unchanged when env is not set', async () => {
      delete process.env.LLM_VISION_VIDEO_USE_BASE64;

      const content: any = {
        type: 'video_url',
        video_url: {
          url: 'https://example.com/video.mp4',
        },
      };

      const result = await convertSiliconCloudMessageContent(content);
      expect(result).toBe(content);
    });

    it('should return URL content unchanged when env is not 1', async () => {
      process.env.LLM_VISION_VIDEO_USE_BASE64 = '0';

      const content: any = {
        type: 'video_url',
        video_url: {
          url: 'https://example.com/video.mp4',
        },
      };

      const result = await convertSiliconCloudMessageContent(content);
      expect(result).toBe(content);
    });

    it('should convert video URL to base64 when env is 1', async () => {
      process.env.LLM_VISION_VIDEO_USE_BASE64 = '1';

      // Mock ssrfSafeFetch to return a simple video
      const mockResponse = {
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'video/mp4',
        }),
        arrayBuffer: async () => Promise.resolve(new ArrayBuffer(10)),
      };

      (ssrfSafeFetch as any).mockResolvedValue(mockResponse);

      const content: any = {
        type: 'video_url',
        video_url: {
          url: 'https://example.com/video.mp4',
        },
      };

      const result = await convertSiliconCloudMessageContent(content);

      expect(ssrfSafeFetch).toHaveBeenCalledWith(
        'https://example.com/video.mp4',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      expect((result as any).video_url.url).toMatch(/^data:video\/mp4;base64,/);
    });

    it('should return original content when fetch fails', async () => {
      process.env.LLM_VISION_VIDEO_USE_BASE64 = '1';

      (ssrfSafeFetch as any).mockRejectedValue(new Error('Network error'));

      const content: any = {
        type: 'video_url',
        video_url: {
          url: 'https://example.com/video.mp4',
        },
      };

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await convertSiliconCloudMessageContent(content);

      expect(result).toBe(content);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Failed to convert video to base64:',
        expect.any(Error),
      );

      consoleWarnSpy.mockRestore();
    });
  });

  describe('transformSiliconCloudMessages', () => {
    it('should transform messages with video content', async () => {
      process.env.LLM_VISION_VIDEO_USE_BASE64 = '1';

      const mockResponse = {
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'video/mp4',
        }),
        arrayBuffer: async () => Promise.resolve(new ArrayBuffer(10)),
      };

      (ssrfSafeFetch as any).mockResolvedValue(mockResponse);

      const messages: OpenAI.ChatCompletionMessageParam[] = [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Please analyze this video',
            } as OpenAI.ChatCompletionContentPart,
            {
              type: 'video_url',
              video_url: {
                url: 'https://example.com/video.mp4',
              },
            } as any,
          ],
        },
      ];

      const result = await transformSiliconCloudMessages(messages);

      expect(result).toHaveLength(1);
      expect(result[0].content).toHaveLength(2);
      expect((result[0].content as any[])[1].video_url.url).toMatch(/^data:video\/mp4;base64,/);
      expect(ssrfSafeFetch).toHaveBeenCalledWith(
        'https://example.com/video.mp4',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    it('should handle string content unchanged', async () => {
      const messages: OpenAI.ChatCompletionMessageParam[] = [
        {
          role: 'user',
          content: 'Hello world',
        },
      ];

      const result = await transformSiliconCloudMessages(messages);

      expect(result).toHaveLength(1);
      expect(result[0].content).toBe('Hello world');
    });
  });
});
