import { describe, expect, it } from 'vitest';

import { partitionFilesByMediaAbility } from './useUploadFiles';

const file = (name: string, type: string): File => new File(['x'], name, { type });

const allAllowed = { canUploadAudio: true, canUploadImage: true, canUploadVideo: true };

describe('partitionFilesByMediaAbility', () => {
  it('accepts everything when the model can receive all media', () => {
    const files = [
      file('a.png', 'image/png'),
      file('b.mp4', 'video/mp4'),
      file('c.txt', 'text/plain'),
    ];
    const { accepted, rejected } = partitionFilesByMediaAbility(files, allAllowed);
    expect(accepted).toEqual(files);
    expect(rejected).toEqual([]);
  });

  it('rejects media the model cannot receive and keeps the rest', () => {
    const image = file('a.png', 'image/png');
    const audio = file('b.mp3', 'audio/mpeg');
    const doc = file('c.pdf', 'application/pdf');
    const { accepted, rejected } = partitionFilesByMediaAbility([image, audio, doc], {
      canUploadAudio: false,
      canUploadImage: false,
      canUploadVideo: true,
    });
    expect(accepted).toEqual([doc]);
    expect(rejected).toEqual([image, audio]);
  });

  it('non-media files are never rejected', () => {
    const doc = file('c.md', 'text/markdown');
    const { accepted, rejected } = partitionFilesByMediaAbility([doc], {
      canUploadAudio: false,
      canUploadImage: false,
      canUploadVideo: false,
    });
    expect(accepted).toEqual([doc]);
    expect(rejected).toEqual([]);
  });
});
