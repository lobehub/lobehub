import { describe, expect, it } from 'vitest';

import {
  LOCAL_PATH_REFERENCE_MIN_FILE_SIZE,
  partitionLargeFilesAsLocalPaths,
} from './useLargeFileLocalPath';

const createFile = (name: string, type: string, size: number) => {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
};

const resolvePath = (file: File) => `/Users/me/${file.name}`;

describe('partitionLargeFilesAsLocalPaths', () => {
  it('references large non-media files by local path', () => {
    const large = createFile('data.csv', 'text/csv', LOCAL_PATH_REFERENCE_MIN_FILE_SIZE + 1);

    expect(partitionLargeFilesAsLocalPaths([large], resolvePath)).toEqual({
      files: [],
      localPaths: [{ isDirectory: false, name: 'data.csv', path: '/Users/me/data.csv' }],
    });
  });

  it('keeps uploading small files and media of any size', () => {
    const small = createFile('notes.txt', 'text/plain', LOCAL_PATH_REFERENCE_MIN_FILE_SIZE);
    const image = createFile('photo.png', 'image/png', LOCAL_PATH_REFERENCE_MIN_FILE_SIZE * 10);
    const video = createFile('clip.mp4', 'video/mp4', LOCAL_PATH_REFERENCE_MIN_FILE_SIZE * 10);

    expect(partitionLargeFilesAsLocalPaths([small, image, video], resolvePath)).toEqual({
      files: [small, image, video],
      localPaths: [],
    });
  });

  it('falls back to upload when no local path resolves', () => {
    const pasted = createFile('export.json', '', LOCAL_PATH_REFERENCE_MIN_FILE_SIZE * 2);

    expect(partitionLargeFilesAsLocalPaths([pasted], () => null)).toEqual({
      files: [pasted],
      localPaths: [],
    });
  });
});
