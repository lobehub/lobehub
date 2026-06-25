import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildVideoGenerationFilePayload } from './videoFile';

describe('buildVideoGenerationFilePayload', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('should include upload metadata for generated video hash dedup', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-19T10:20:30Z'));

    const payload = buildVideoGenerationFilePayload({
      generationId: 'gen-456',
      processResult: {
        coverKey: 'generations/videos/video_cover.webp',
        duration: 12,
        fileHash: 'hash-abc',
        fileSize: 1024,
        height: 1080,
        mimeType: 'video/mp4',
        thumbnailKey: 'generations/videos/video_thumb.webp',
        videoKey: 'generations/videos/video_raw.mp4',
        width: 1920,
      },
      prompt: 'test prompt',
    });

    expect(payload).toEqual({
      fileHash: 'hash-abc',
      fileType: 'video/mp4',
      metadata: {
        date: '2026-06-19',
        dirname: 'generations/videos',
        duration: 12,
        filename: 'test prompt.mp4',
        generationId: 'gen-456',
        height: 1080,
        path: 'generations/videos/video_raw.mp4',
        width: 1920,
      },
      name: 'test prompt.mp4',
      size: 1024,
      url: 'generations/videos/video_raw.mp4',
    });
  });
});
