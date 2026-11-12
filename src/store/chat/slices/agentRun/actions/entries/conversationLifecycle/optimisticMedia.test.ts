import type { UploadFileItem } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { buildOptimisticMediaLists } from './optimisticMedia';

const uploadedFile = (type: string, name: string): UploadFileItem =>
  ({
    base64Url: `data:${type};base64,AAAA`,
    file: new File([], name, { type }),
    fileUrl: `https://cdn.example.com/files/${name}`,
    id: 'file_1',
    previewUrl: `blob:local-${name}`,
    status: 'success',
  }) as UploadFileItem;

describe('buildOptimisticMediaLists', () => {
  it('renders images and videos from the local preview, not the uploaded URL', () => {
    const { imageList, videoList } = buildOptimisticMediaLists([
      uploadedFile('image/png', 'shot.png'),
      uploadedFile('video/mp4', 'clip.mp4'),
    ]);

    expect(imageList[0].url).toBe('blob:local-shot.png');
    expect(videoList[0].url).toBe('blob:local-clip.mp4');
  });

  it('keeps audio on the uploaded URL', () => {
    const { audioList } = buildOptimisticMediaLists([uploadedFile('audio/mpeg', 'note.mp3')]);

    expect(audioList[0].url).toBe('https://cdn.example.com/files/note.mp3');
  });
});
