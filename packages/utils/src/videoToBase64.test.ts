import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { videoUrlToBase64 } from './videoToBase64';

// Mock ssrf-safe-fetch module
const mockSsrfSafeFetch = vi.fn();
vi.mock('ssrf-safe-fetch', () => ({
  ssrfSafeFetch: mockSsrfSafeFetch,
}));

describe('videoUrlToBase64', () => {
  const originalWindow = global.window;

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock server environment by removing window
    // @ts-ignore
    delete global.window;
  });

  afterEach(() => {
    // Restore window
    global.window = originalWindow;
  });

  it('should convert video URL to base64 successfully', async () => {
    const mockArrayBuffer = new ArrayBuffer(16);
    const mockResponse = {
      ok: true,
      status: 200,
      headers: {
        get: vi.fn().mockReturnValue('video/mp4'),
      },
      arrayBuffer: vi.fn().mockResolvedValue(mockArrayBuffer),
    };

    mockSsrfSafeFetch.mockResolvedValue(mockResponse);

    const result = await videoUrlToBase64('https://example.com/video.mp4');

    expect(mockSsrfSafeFetch).toHaveBeenCalledWith(
      'https://example.com/video.mp4',
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    );
    expect(result).toEqual({
      base64: Buffer.from(mockArrayBuffer).toString('base64'),
      mimeType: 'video/mp4',
    });
  });

  it('should handle different video mime types', async () => {
    const mockArrayBuffer = new ArrayBuffer(16);
    const mockResponse = {
      ok: true,
      status: 200,
      headers: {
        get: vi.fn().mockReturnValue('video/webm'),
      },
      arrayBuffer: vi.fn().mockResolvedValue(mockArrayBuffer),
    };

    mockSsrfSafeFetch.mockResolvedValue(mockResponse);

    const result = await videoUrlToBase64('https://example.com/video.webm');

    expect(result.mimeType).toBe('video/webm');
  });

  it('should throw error when response is not ok', async () => {
    const mockResponse = {
      ok: false,
      status: 404,
      statusText: 'Not Found',
    };

    mockSsrfSafeFetch.mockResolvedValue(mockResponse);

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(videoUrlToBase64('https://example.com/video.mp4')).rejects.toThrow(
      'Failed to fetch video: 404 Not Found',
    );

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Error converting video to base64:',
      expect.any(Error),
    );

    consoleErrorSpy.mockRestore();
  });

  it('should throw error when content-type is not video', async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      headers: {
        get: vi.fn().mockReturnValue('image/png'),
      },
    };

    mockSsrfSafeFetch.mockResolvedValue(mockResponse);

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(videoUrlToBase64('https://example.com/image.png')).rejects.toThrow(
      'URL does not point to a valid video file',
    );

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Error converting video to base64:',
      expect.any(Error),
    );

    consoleErrorSpy.mockRestore();
  });

  it('should throw error when content-type is missing', async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      headers: {
        get: vi.fn().mockReturnValue(null),
      },
    };

    mockSsrfSafeFetch.mockResolvedValue(mockResponse);

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(videoUrlToBase64('https://example.com/file')).rejects.toThrow(
      'URL does not point to a valid video file',
    );

    consoleErrorSpy.mockRestore();
  });

  it('should throw error when fetch fails', async () => {
    const mockError = new Error('Network error');
    mockSsrfSafeFetch.mockRejectedValue(mockError);

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(videoUrlToBase64('https://example.com/video.mp4')).rejects.toThrow(
      'Network error',
    );

    expect(consoleErrorSpy).toHaveBeenCalledWith('Error converting video to base64:', mockError);

    consoleErrorSpy.mockRestore();
  });

  it('should use 30 second timeout', async () => {
    const mockArrayBuffer = new ArrayBuffer(16);
    const mockResponse = {
      ok: true,
      status: 200,
      headers: {
        get: vi.fn().mockReturnValue('video/mp4'),
      },
      arrayBuffer: vi.fn().mockResolvedValue(mockArrayBuffer),
    };

    mockSsrfSafeFetch.mockResolvedValue(mockResponse);

    await videoUrlToBase64('https://example.com/video.mp4');

    expect(mockSsrfSafeFetch).toHaveBeenCalledWith(
      'https://example.com/video.mp4',
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    );
  });
});
