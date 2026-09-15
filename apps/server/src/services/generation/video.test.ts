import type * as NodeFs from 'node:fs';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

import { ssrfSafeFetch } from '@lobechat/ssrf-safe-fetch';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { VideoGenerationService } from './video';

vi.mock('@lobechat/ssrf-safe-fetch', () => ({ ssrfSafeFetch: vi.fn() }));
vi.mock('debug', () => ({
  default: () => vi.fn(),
}));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFs>();

  return {
    ...actual,
    createWriteStream: vi.fn(() => ({}) as any),
  };
});
vi.mock('node:stream/promises', () => ({
  pipeline: vi.fn(),
}));

global.fetch = vi.fn(() => {
  throw new Error('raw global fetch must not be used for video URLs; use ssrfSafeFetch');
}) as any;

describe('VideoGenerationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('downloadVideo', () => {
    it('fetches provider video URLs through the SSRF guard instead of raw fetch', async () => {
      const response = new Response(Buffer.from('video'), {
        headers: { 'content-length': '5' },
        status: 200,
      });
      vi.mocked(ssrfSafeFetch).mockResolvedValueOnce(response);
      vi.mocked(pipeline).mockResolvedValueOnce(undefined);

      const service = Object.create(VideoGenerationService.prototype) as VideoGenerationService;
      const tempPath = await (service as any).downloadVideo('http://169.254.169.254/video.mp4', {
        headers: { Authorization: 'Bearer provider-token' },
      });

      expect(tempPath).toMatch(/lobe-video-.*\.mp4$/);
      expect(ssrfSafeFetch).toHaveBeenCalledWith(
        'http://169.254.169.254/video.mp4',
        {
          headers: { Authorization: 'Bearer provider-token' },
          signal: expect.any(AbortSignal),
        },
        { responseMode: 'stream' },
      );
      expect(global.fetch).not.toHaveBeenCalled();
      expect(createWriteStream).toHaveBeenCalledWith(tempPath);
    });

    it('propagates SSRF guard rejections for private network targets', async () => {
      vi.mocked(ssrfSafeFetch).mockRejectedValueOnce(
        new Error('SSRF blocked: DNS lookup 127.0.0.1 is not allowed.'),
      );

      const service = Object.create(VideoGenerationService.prototype) as VideoGenerationService;

      await expect(
        (service as any).downloadVideo('http://127.0.0.1:6379/video.mp4'),
      ).rejects.toThrow('SSRF blocked');
      expect(global.fetch).not.toHaveBeenCalled();
      expect(pipeline).not.toHaveBeenCalled();
    });
  });
});
