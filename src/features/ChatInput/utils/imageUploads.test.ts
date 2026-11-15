import { describe, expect, it } from 'vitest';

import type { UploadFileItem } from '@/types/files/upload';

import { getImageUploadNumbers, getImageUploadRefs } from './imageUploads';

const upload = (
  name: string,
  type: string,
  previewUrl?: string,
  status: UploadFileItem['status'] = 'success',
): UploadFileItem =>
  ({
    file: new File(['x'], name, { type }),
    id: name,
    previewUrl,
    status,
  }) as UploadFileItem;

describe('getImageUploadNumbers', () => {
  it('numbers images by their position among images only', () => {
    const files = [
      upload('a.png', 'image/png', 'blob:a'),
      upload('notes.pdf', 'application/pdf'),
      upload('b.jpg', 'image/jpeg', 'blob:b'),
    ];

    expect(getImageUploadNumbers(files)).toEqual([1, undefined, 2]);
  });

  it('skips images that failed to upload, since they are not sent', () => {
    const files = [
      upload('a.png', 'image/png', 'blob:a', 'error'),
      upload('b.png', 'image/png', 'blob:b'),
      upload('c.png', 'image/png', 'blob:c', 'cancelled'),
    ];

    expect(getImageUploadNumbers(files)).toEqual([undefined, 1, undefined]);
    expect([...getImageUploadRefs(files).keys()]).toEqual(['blob:b']);
  });

  it('numbers pasted images that share a file name separately', () => {
    const files = [
      upload('image.png', 'image/png', 'blob:1'),
      upload('image.png', 'image/png', 'blob:2'),
    ];

    expect(getImageUploadNumbers(files)).toEqual([1, 2]);
  });
});

describe('getImageUploadRefs', () => {
  it('keys image uploads by preview URL with their current number', () => {
    const files = [
      upload('a.png', 'image/png', 'blob:a', 'uploading'),
      upload('clip.mp4', 'video/mp4', 'blob:v'),
      upload('b.png', 'image/png', 'blob:b', 'uploading'),
    ];

    expect([...getImageUploadRefs(files)]).toEqual([
      ['blob:a', { number: 1, src: 'blob:a' }],
      ['blob:b', { number: 2, src: 'blob:b' }],
    ]);
  });

  it('records the file id only once an upload finished', () => {
    // Until then the id is the file name, which two pasted images can share.
    const files = [
      upload('image.png', 'image/png', 'blob:a', 'uploading'),
      { ...upload('image.png', 'image/png', 'blob:b'), id: 'file-b' },
    ];

    expect([...getImageUploadRefs(files)]).toEqual([
      ['blob:a', { number: 1, src: 'blob:a' }],
      ['blob:b', { fileId: 'file-b', number: 2, src: 'blob:b' }],
    ]);
  });
});
