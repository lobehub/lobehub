import { describe, expect, it, vi } from 'vitest';

import { AsyncTaskStatus } from '@/types/asyncTask';
import type { Generation, VideoGenerationAsset } from '@/types/generation';
import { downloadFile } from '@/utils/client/downloadFile';

import { downloadGeneratedVideo } from './downloadVideo';

vi.mock('@/utils/client/downloadFile', () => ({ downloadFile: vi.fn() }));

describe('downloadGeneratedVideo', () => {
  it.each([
    ['webm', 'A_scene_2026-11-24_12-00-00.webm'],
    ['mp4', 'A_scene_2026-11-24_12-00-00.mp4'],
    [undefined, 'A_scene_2026-11-24_12-00-00.mp4'],
  ] as const)(
    'passes the actual feed download filename for %s',
    async (fileExtension, filename) => {
      vi.clearAllMocks();
      const asset: VideoGenerationAsset = {
        fileExtension,
        type: 'video',
        url: 'https://app.example/f/video-file',
      };
      const generation: Generation = {
        asset,
        asyncTaskId: null,
        createdAt: new Date(2026, 10, 24, 12),
        id: 'generation',
        task: { id: 'task', status: AsyncTaskStatus.Success },
      };

      await downloadGeneratedVideo(generation, 'A: scene');

      expect(downloadFile).toHaveBeenCalledExactlyOnceWith(asset.url, filename, false);
    },
  );
});
