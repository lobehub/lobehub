import type OpenAI from 'openai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { imageUrlToBase64 } from '../../utils/imageToBase64';
import { clearReferenceImageCache } from '../../utils/referenceImageCache';
import { parseDataUri } from '../../utils/uriParser';
import { videoUrlToBase64 } from '../../utils/videoToBase64';
import {
  convertImageUrlToFile,
  convertMessageContent,
  type ExtendedChatCompletionContentPart,
} from './openai';

// 模拟依赖
vi.mock('../../utils/imageToBase64', () => ({
  imageUrlToBase64: vi.fn(),
}));
vi.mock('../../utils/videoToBase64', () => ({
  videoUrlToBase64: vi.fn(),
}));
vi.mock('../../utils/uriParser');

const MP3_BASE64 = 'SUQzBAAAAAA=';
const WAV_BASE64 = 'UklGRjAwMDBXQVZFZm10IA==';

describe('convertMessageContent', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return the same content if not image_url type', async () => {
    const content = { type: 'text', text: 'Hello' } as OpenAI.ChatCompletionContentPart;
    const result = await convertMessageContent(content);
    expect(result).toEqual(content);
  });

  it.each([
    ['WAV', 'audio/wav', 'wav', WAV_BASE64],
    ['MP3', 'audio/mpeg', 'mp3', MP3_BASE64],
  ] as const)(
    'should convert a base64 %s data URI to input_audio',
    async (_, mimeType, format, base64) => {
      const content = {
        audio_url: {
          codec: format,
          durationMs: 2500,
          mimeType,
          url: `data:${mimeType};base64,${base64}`,
        },
        type: 'audio_url',
      } as const;
      vi.mocked(parseDataUri).mockReturnValue({
        base64,
        mimeType,
        type: 'base64',
      });

      await expect(convertMessageContent(content, { supportsAudioInput: true })).resolves.toEqual({
        input_audio: { data: base64, format },
        type: 'input_audio',
      });
      expect(imageUrlToBase64).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['WAV', 'audio/wav', 'wav', WAV_BASE64],
    ['MP3', 'audio/mpeg', 'mp3', MP3_BASE64],
  ] as const)(
    'should safely download a %s URL and convert it to input_audio',
    async (_, mimeType, format, base64) => {
      const url = `https://files.example.com/voice.${format}`;
      const content = { audio_url: { url }, type: 'audio_url' } as const;
      vi.mocked(parseDataUri).mockReturnValue({ base64: null, mimeType: null, type: 'url' });
      vi.mocked(imageUrlToBase64).mockResolvedValue({ base64, mimeType });

      await expect(convertMessageContent(content, { supportsAudioInput: true })).resolves.toEqual({
        input_audio: { data: base64, format },
        type: 'input_audio',
      });
      expect(imageUrlToBase64).toHaveBeenCalledWith(url, { maxBytes: 20 * 1024 * 1024 });
    },
  );

  it('should fail closed when the provider adapter does not enable audio input', async () => {
    const content = {
      audio_url: { url: 'data:audio/wav;base64,audioBase64' },
      type: 'audio_url',
    } as const;

    await expect(convertMessageContent(content)).rejects.toThrow(
      'Audio input is not supported by this provider runtime',
    );
    expect(parseDataUri).not.toHaveBeenCalled();
    expect(imageUrlToBase64).not.toHaveBeenCalled();
  });

  it.each([
    ['base64 data', { base64: 'audioBase64', mimeType: 'audio/ogg', type: 'base64' as const }],
    ['download URL', { base64: null, mimeType: null, type: 'url' as const }],
  ])('should reject an unsupported audio MIME type from %s', async (_, parsedUri) => {
    const url =
      parsedUri.type === 'url'
        ? 'https://files.example.com/voice.ogg'
        : 'data:audio/ogg;base64,audioBase64';
    const content = { audio_url: { url }, type: 'audio_url' } as const;
    vi.mocked(parseDataUri).mockReturnValue(parsedUri);
    if (parsedUri.type === 'url') {
      vi.mocked(imageUrlToBase64).mockResolvedValue({
        base64: 'downloadedAudio',
        mimeType: 'audio/ogg',
      });
    }

    await expect(convertMessageContent(content, { supportsAudioInput: true })).rejects.toThrow(
      /only supports (?:base64 )?WAV or MP3/i,
    );
  });

  it('should reject bytes that only claim to be WAV in persisted metadata', async () => {
    const url = 'https://files.example.com/spoofed.wav';
    const content = {
      audio_url: { mimeType: 'audio/wav', url },
      type: 'audio_url',
    } as const;
    vi.mocked(parseDataUri).mockReturnValue({ base64: null, mimeType: null, type: 'url' });
    vi.mocked(imageUrlToBase64).mockResolvedValue({
      base64: 'bm90IGF1ZGlv',
      mimeType: 'application/octet-stream',
    });

    await expect(convertMessageContent(content, { supportsAudioInput: true })).rejects.toThrow(
      'only supports WAV or MP3 files',
    );
  });

  it('should convert image URL to base64 when necessary', async () => {
    // 设置环境变量
    process.env.LLM_VISION_IMAGE_USE_BASE64 = '1';

    const content = {
      type: 'image_url',
      image_url: { url: 'https://example.com/image.jpg' },
    } as OpenAI.ChatCompletionContentPart;

    vi.mocked(parseDataUri).mockReturnValue({ type: 'url', base64: null, mimeType: null });
    vi.mocked(imageUrlToBase64).mockResolvedValue({
      base64: 'base64String',
      mimeType: 'image/jpeg',
    });

    const result = await convertMessageContent(content);

    expect(result).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/jpeg;base64,base64String' },
    });

    expect(parseDataUri).toHaveBeenCalledWith('https://example.com/image.jpg');
    expect(imageUrlToBase64).toHaveBeenCalledWith('https://example.com/image.jpg');
  });

  it('should not convert image URL when not necessary', async () => {
    process.env.LLM_VISION_IMAGE_USE_BASE64 = undefined;

    const content = {
      type: 'image_url',
      image_url: { url: 'https://example.com/image.jpg' },
    } as OpenAI.ChatCompletionContentPart;

    vi.mocked(parseDataUri).mockReturnValue({ type: 'url', base64: null, mimeType: null });

    const result = await convertMessageContent(content);

    expect(result).toEqual(content);
    expect(imageUrlToBase64).not.toHaveBeenCalled();
  });

  it('should convert image URL when forceImageBase64 is true', async () => {
    process.env.LLM_VISION_IMAGE_USE_BASE64 = undefined;

    const content = {
      type: 'image_url',
      image_url: { url: 'https://example.com/image.jpg' },
    } as OpenAI.ChatCompletionContentPart;

    vi.mocked(parseDataUri).mockReturnValue({ type: 'url', base64: null, mimeType: null });
    vi.mocked(imageUrlToBase64).mockResolvedValue({
      base64: 'forcedBase64',
      mimeType: 'image/jpeg',
    });

    const result = await convertMessageContent(content, { forceImageBase64: true });

    expect(result).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/jpeg;base64,forcedBase64' },
    });

    expect(imageUrlToBase64).toHaveBeenCalledWith('https://example.com/image.jpg');
  });

  it('should convert video URL to base64 when necessary', async () => {
    process.env.LLM_VISION_VIDEO_USE_BASE64 = '1';

    const content: ExtendedChatCompletionContentPart = {
      type: 'video_url',
      video_url: { url: 'https://example.com/video.mp4' },
    };

    vi.mocked(parseDataUri).mockReturnValue({ type: 'url', base64: null, mimeType: null });
    vi.mocked(videoUrlToBase64).mockResolvedValue({
      base64: 'base64String',
      mimeType: 'video/mp4',
    });

    const result = await convertMessageContent(content);

    expect(result).toEqual({
      type: 'video_url',
      video_url: { url: 'data:video/mp4;base64,base64String' },
    });

    expect(parseDataUri).toHaveBeenCalledWith('https://example.com/video.mp4');
    expect(videoUrlToBase64).toHaveBeenCalledWith('https://example.com/video.mp4');

    process.env.LLM_VISION_VIDEO_USE_BASE64 = undefined;
  });

  it('should not convert video URL when not necessary', async () => {
    process.env.LLM_VISION_VIDEO_USE_BASE64 = undefined;

    const content: ExtendedChatCompletionContentPart = {
      type: 'video_url',
      video_url: { url: 'https://example.com/video.mp4' },
    };

    vi.mocked(parseDataUri).mockReturnValue({ type: 'url', base64: null, mimeType: null });

    const result = await convertMessageContent(content);

    expect(result).toEqual(content);
    expect(videoUrlToBase64).not.toHaveBeenCalled();
  });

  it('should convert video URL when forceVideoBase64 is true', async () => {
    process.env.LLM_VISION_VIDEO_USE_BASE64 = undefined;

    const content: ExtendedChatCompletionContentPart = {
      type: 'video_url',
      video_url: { url: 'https://example.com/video.mp4' },
    };

    vi.mocked(parseDataUri).mockReturnValue({ type: 'url', base64: null, mimeType: null });
    vi.mocked(videoUrlToBase64).mockResolvedValue({
      base64: 'forcedBase64',
      mimeType: 'video/mp4',
    });

    const result = await convertMessageContent(content, { forceVideoBase64: true });

    expect(result).toEqual({
      type: 'video_url',
      video_url: { url: 'data:video/mp4;base64,forcedBase64' },
    });

    expect(videoUrlToBase64).toHaveBeenCalledWith('https://example.com/video.mp4');
  });

  it('should return original content when video conversion fails', async () => {
    process.env.LLM_VISION_VIDEO_USE_BASE64 = '1';

    const content: ExtendedChatCompletionContentPart = {
      type: 'video_url',
      video_url: { url: 'https://example.com/video.mp4' },
    };

    vi.mocked(parseDataUri).mockReturnValue({ type: 'url', base64: null, mimeType: null });
    vi.mocked(videoUrlToBase64).mockRejectedValue(new Error('Conversion failed'));

    const result = await convertMessageContent(content);

    expect(result).toEqual(content);

    process.env.LLM_VISION_VIDEO_USE_BASE64 = undefined;
  });
});

describe('convertImageUrlToFile', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    clearReferenceImageCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Data URL handling', () => {
    it('should convert PNG data URL to File object correctly', async () => {
      const base64Data =
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
      const dataUrl = `data:image/png;base64,${base64Data}`;

      const result = await convertImageUrlToFile(dataUrl);

      expect(result).toBeDefined();
      expect(result).toHaveProperty('name', 'image.png');
      expect(result).toHaveProperty('type', 'image/png');
      expect(result).toHaveProperty('size');
      expect(result.size).toBeGreaterThan(0);
    });

    it('should convert JPEG data URL to File object correctly', async () => {
      const base64Data =
        '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/2wBDAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwA9BQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';
      const dataUrl = `data:image/jpeg;base64,${base64Data}`;

      const result = await convertImageUrlToFile(dataUrl);

      expect(result).toBeDefined();
      expect(result).toHaveProperty('name', 'image.jpeg');
      expect(result).toHaveProperty('type', 'image/jpeg');
      expect(result).toHaveProperty('size');
      expect(result.size).toBeGreaterThan(0);
    });

    it('should convert WebP data URL to File object correctly', async () => {
      const base64Data = 'UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAAAAJaQAA6g=';
      const dataUrl = `data:image/webp;base64,${base64Data}`;

      const result = await convertImageUrlToFile(dataUrl);

      expect(result).toBeDefined();
      expect(result).toHaveProperty('name', 'image.webp');
      expect(result).toHaveProperty('type', 'image/webp');
      expect(result).toHaveProperty('size');
      expect(result.size).toBeGreaterThan(0);
    });
  });

  describe('HTTP URL handling', () => {
    const mockFetch = vi.fn();

    beforeEach(() => {
      // Mock global fetch using vi.stubGlobal for better isolation
      vi.stubGlobal('fetch', mockFetch);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      vi.clearAllMocks();
    });

    it('should convert HTTP URL to File object correctly', async () => {
      const mockArrayBuffer = new ArrayBuffer(8);
      const mockHeaders = new Headers();
      mockHeaders.set('content-type', 'image/jpeg');

      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(mockArrayBuffer),
        headers: mockHeaders,
      } satisfies Partial<Response>);

      const result = await convertImageUrlToFile('https://example.com/image.jpg');

      expect(mockFetch).toHaveBeenCalledWith('https://example.com/image.jpg');
      expect(result).toBeDefined();
      expect(result).toHaveProperty('name', 'image.jpeg');
      expect(result).toHaveProperty('type', 'image/jpeg');
      expect(result).toHaveProperty('size');
      expect(result.size).toEqual(8);
    });

    it('should handle different content types from HTTP response headers', async () => {
      const testCases = [
        { contentType: 'image/jpeg', expectedExtension: 'jpeg' },
        { contentType: 'image/png', expectedExtension: 'png' },
        { contentType: 'image/webp', expectedExtension: 'webp' },
        { contentType: null, expectedExtension: 'png' }, // default fallback
      ];

      for (const testCase of testCases) {
        const mockArrayBuffer = new ArrayBuffer(8);
        const mockHeaders = new Headers();
        if (testCase.contentType) {
          mockHeaders.set('content-type', testCase.contentType);
        }

        mockFetch.mockResolvedValue({
          ok: true,
          arrayBuffer: () => Promise.resolve(mockArrayBuffer),
          headers: mockHeaders,
        } satisfies Partial<Response>);

        const result = await convertImageUrlToFile('https://example.com/image.jpg');

        expect(result).toHaveProperty('name', `image.${testCase.expectedExtension}`);
        expect(result).toHaveProperty('type', testCase.contentType || 'image/png');

        vi.clearAllMocks();
        clearReferenceImageCache();
      }
    });

    it('should reuse one download for repeated conversions of the same URL', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
        headers: new Headers({ 'content-type': 'image/png' }),
      } satisfies Partial<Response>);

      const first = await convertImageUrlToFile('https://example.com/reference.png');
      const second = await convertImageUrlToFile('https://example.com/reference.png');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(first).not.toBe(second);
      expect(second).toHaveProperty('type', 'image/png');
    });

    it('should throw error when HTTP request fails', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        statusText: 'Not Found',
      } satisfies Partial<Response>);

      await expect(convertImageUrlToFile('https://example.com/nonexistent.jpg')).rejects.toThrow(
        'Failed to fetch image from https://example.com/nonexistent.jpg: Not Found',
      );

      expect(mockFetch).toHaveBeenCalledWith('https://example.com/nonexistent.jpg');
    });

    it('should throw error when network request fails', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      await expect(convertImageUrlToFile('https://example.com/image.jpg')).rejects.toThrow(
        'Network error',
      );

      expect(mockFetch).toHaveBeenCalledWith('https://example.com/image.jpg');
    });
  });

  describe('Edge cases', () => {
    it('should handle malformed data URL gracefully', async () => {
      const malformedDataUrl = 'data:invalid-format';

      // 这个测试可能会抛出错误，我们需要适当处理
      await expect(convertImageUrlToFile(malformedDataUrl)).rejects.toThrow();
    });
  });
});
