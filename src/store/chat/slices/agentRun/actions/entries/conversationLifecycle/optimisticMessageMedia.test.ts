import { describe, expect, it } from 'vitest';

import {
  reconstructUploadFilesFromQueue,
  snapshotQueuedFiles,
} from '@/store/chat/slices/operation/types';
import type { UploadFileItem } from '@/types/files/upload';

import { getOptimisticMessageMedia } from './optimisticMessageMedia';

const upload = (id: string, name: string, type: string, size = 1024): UploadFileItem => ({
  file: Object.defineProperty(new File([], name, { type }), 'size', { value: size }),
  fileUrl: `https://example.com/${id}`,
  id,
  status: 'success',
});

describe('getOptimisticMessageMedia', () => {
  it('turns non-media uploads into file cards with name, size and type, in send order', () => {
    const media = getOptimisticMessageMedia([
      upload('zip-1', 'a.zip', 'application/zip', 175_000_000),
      upload('pdf-1', 'b.pdf', 'application/pdf', 2048),
    ]);

    expect(media.fileList).toEqual([
      {
        fileType: 'application/zip',
        id: 'zip-1',
        name: 'a.zip',
        size: 175_000_000,
        url: 'https://example.com/zip-1',
      },
      {
        fileType: 'application/pdf',
        id: 'pdf-1',
        name: 'b.pdf',
        size: 2048,
        url: 'https://example.com/pdf-1',
      },
    ]);
    expect(media.imageList).toBeUndefined();
  });

  it('groups attachments the way the persisted message does', () => {
    const media = getOptimisticMessageMedia([
      upload('png', 'p.png', 'image/png'),
      upload('svg', 's.svg', 'image/svg+xml'),
      upload('mp4', 'v.mp4', 'video/mp4'),
      upload('mp3', 'a.mp3', 'audio/mpeg'),
      {
        ...upload('voice', 'voice.webm', 'video/webm'),
        audioMetadata: { durationMs: 1, mimeType: 'audio/webm' },
      },
      upload('zip', 'z.zip', 'application/zip'),
    ]);

    expect(media.imageList?.map((item) => item.id)).toEqual(['png']);
    expect(media.videoList?.map((item) => item.id)).toEqual(['mp4']);
    expect(media.audioList?.map((item) => item.id)).toEqual(['mp3', 'voice']);
    // Only model-readable image formats render as images; an SVG comes back as a file card.
    expect(media.fileList?.map((item) => item.id)).toEqual(['svg', 'zip']);
  });

  it('leaves out id-only entries that carry no file to describe', () => {
    const media = getOptimisticMessageMedia([{ id: 'legacy' } as UploadFileItem]);

    expect(media.fileList).toBeUndefined();
  });

  it('classifies by the type the upload was stored with', () => {
    const media = getOptimisticMessageMedia([
      { ...upload('png', 'p', ''), fileType: 'image/png' },
      { ...upload('m4a', 'a.m4a', 'video/mp4'), fileType: 'audio/mp4' },
      { ...upload('bin', 'b.bin', ''), fileType: 'application/octet-stream' },
    ]);

    expect(media.imageList?.map((item) => item.id)).toEqual(['png']);
    expect(media.audioList?.map((item) => item.id)).toEqual(['m4a']);
    expect(media.fileList).toEqual([
      expect.objectContaining({ fileType: 'application/octet-stream', id: 'bin' }),
    ]);
  });

  it('keeps the stored type through a queued send', () => {
    const queued = snapshotQueuedFiles([{ ...upload('png', 'p', ''), fileType: 'image/png' }]);
    const media = getOptimisticMessageMedia(reconstructUploadFilesFromQueue(queued!));

    expect(media.imageList?.map((item) => item.id)).toEqual(['png']);
  });

  it('shows no zero-byte card for a queued file saved without its size', () => {
    const media = getOptimisticMessageMedia(
      reconstructUploadFilesFromQueue([
        { id: 'legacy', mimeType: 'application/zip', name: 'old.zip', url: '' },
      ]),
    );

    expect(media.fileList).toBeUndefined();
  });

  it('keeps the file size through a queued send', () => {
    const queued = snapshotQueuedFiles([upload('zip-1', 'a.zip', 'application/zip', 177_500_000)]);
    const media = getOptimisticMessageMedia(reconstructUploadFilesFromQueue(queued!));

    expect(media.fileList).toEqual([expect.objectContaining({ name: 'a.zip', size: 177_500_000 })]);
  });
});
