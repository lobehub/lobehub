import type { IEditor } from '@lobehub/editor';
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  LOCAL_PATH_REFERENCE_MIN_FILE_SIZE,
  partitionLargeFilesAsLocalPaths,
  useLargeFileLocalPath,
} from './useLargeFileLocalPath';

const { insertLocalPathTagsMock, toastInfoMock } = vi.hoisted(() => ({
  insertLocalPathTagsMock: vi.fn(),
  toastInfoMock: vi.fn(),
}));

vi.mock('@lobehub/ui/base-ui', () => ({ toast: { info: toastInfoMock } }));
vi.mock('@/features/ChatInput/InputEditor/insertLocalFileTags', () => ({
  insertLocalPathTags: insertLocalPathTagsMock,
}));
vi.mock('@/features/Conversation/useLocalPathReference', () => ({
  useLocalPathReference: () => ({ enableLocalPathReference: true }),
}));
vi.mock('@/utils/electron/localFilePath', () => ({
  getElectronLocalFilePath: (file: File) => `/Users/me/${file.name}`,
}));
vi.mock('./useTopicId', () => ({ useTopicId: () => 'topic-1' }));

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

describe('useLargeFileLocalPath', () => {
  it('inserts path tags and tells the user once per burst of picked files', () => {
    const editor = {} as IEditor;
    const { result } = renderHook(() => useLargeFileLocalPath('agent-1', editor));
    const large = (name: string) =>
      createFile(name, 'text/csv', LOCAL_PATH_REFERENCE_MIN_FILE_SIZE + 1);
    const small = createFile('notes.txt', 'text/plain', 10);

    expect(result.current([large('a.csv'), small])).toEqual([small]);
    expect(result.current([large('b.csv')])).toEqual([]);

    expect(insertLocalPathTagsMock).toHaveBeenCalledTimes(2);
    expect(insertLocalPathTagsMock).toHaveBeenLastCalledWith(editor, [
      { isDirectory: false, name: 'b.csv', path: '/Users/me/b.csv' },
    ]);
    expect(toastInfoMock).toHaveBeenCalledTimes(1);
  });
});
