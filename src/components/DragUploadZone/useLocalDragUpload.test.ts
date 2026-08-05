import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  detectDragContentKind,
  type DroppedLocalPath,
  partitionDroppedItemsAsLocalPaths,
} from './useLocalDragUpload';

type EntryShape = { isDirectory: boolean; isFile: boolean; name?: string };

const makeItem = ({
  file,
  entry,
  kind = 'file',
}: {
  entry?: EntryShape | null;
  file?: File | null;
  kind?: 'file' | 'string';
}): DataTransferItem =>
  ({
    getAsFile: () => file ?? null,
    kind,
    webkitGetAsEntry: () => (entry as unknown as FileSystemEntry) ?? null,
  }) as unknown as DataTransferItem;

const makeFile = (name: string) => new File([new Blob(['x'])], name);

describe('detectDragContentKind', () => {
  it('returns "none" for empty or null input', () => {
    expect(detectDragContentKind(null)).toBe('none');
    expect(detectDragContentKind([] as unknown as DataTransferItemList)).toBe('none');
  });

  it('detects "files" when only files are present', () => {
    const items = [
      makeItem({ entry: { isDirectory: false, isFile: true } }),
      makeItem({ entry: { isDirectory: false, isFile: true } }),
    ];
    expect(detectDragContentKind(items as unknown as DataTransferItemList)).toBe('files');
  });

  it('detects "folders" when only directories are present', () => {
    const items = [makeItem({ entry: { isDirectory: true, isFile: false } })];
    expect(detectDragContentKind(items as unknown as DataTransferItemList)).toBe('folders');
  });

  it('detects "mixed" when both folders and files are present', () => {
    const items = [
      makeItem({ entry: { isDirectory: true, isFile: false } }),
      makeItem({ entry: { isDirectory: false, isFile: true } }),
    ];
    expect(detectDragContentKind(items as unknown as DataTransferItemList)).toBe('mixed');
  });

  it('falls back to "files" when entry metadata is unavailable', () => {
    const items = [makeItem({ entry: null })];
    expect(detectDragContentKind(items as unknown as DataTransferItemList)).toBe('files');
  });

  it('ignores items whose kind is not "file"', () => {
    const items = [makeItem({ kind: 'string', entry: { isDirectory: true, isFile: false } })];
    expect(detectDragContentKind(items as unknown as DataTransferItemList)).toBe('none');
  });
});

describe('partitionDroppedItemsAsLocalPaths', () => {
  const originalElectron = (globalThis as any).window?.electron;

  beforeEach(() => {
    (globalThis as any).window = (globalThis as any).window ?? {};
    (globalThis as any).window.electron = {
      webUtils: {
        getPathForFile: (file: File) => `/abs/${file.name}`,
      },
    };
  });

  afterEach(() => {
    if (originalElectron === undefined) {
      delete (globalThis as any).window.electron;
    } else {
      (globalThis as any).window.electron = originalElectron;
    }
  });

  it('routes top-level folders to the local paths bucket with absolute paths', async () => {
    const folderFile = makeFile('my-folder');
    const items = [
      makeItem({
        entry: { isDirectory: true, isFile: false, name: 'my-folder' },
        file: folderFile,
      }),
    ];

    const result = await partitionDroppedItemsAsLocalPaths(items);

    expect(result.files).toEqual([]);
    expect(result.localPaths).toEqual<DroppedLocalPath[]>([
      { isDirectory: true, name: 'my-folder', path: '/abs/my-folder' },
    ]);
  });

  it('routes top-level files to the local paths bucket with absolute paths', async () => {
    const fileA = makeFile('a.txt');
    const fileB = makeFile('b.txt');
    const items = [
      makeItem({ entry: { isDirectory: false, isFile: true }, file: fileA }),
      makeItem({ entry: { isDirectory: false, isFile: true }, file: fileB }),
    ];

    const result = await partitionDroppedItemsAsLocalPaths(items);

    expect(result.files).toEqual([]);
    expect(result.localPaths).toEqual<DroppedLocalPath[]>([
      { isDirectory: false, name: 'a.txt', path: '/abs/a.txt' },
      { isDirectory: false, name: 'b.txt', path: '/abs/b.txt' },
    ]);
  });

  it('preserves drop order across mixed local paths', async () => {
    const folderFile = makeFile('docs');
    const file = makeFile('readme.md');
    const items = [
      makeItem({
        entry: { isDirectory: true, isFile: false, name: 'docs' },
        file: folderFile,
      }),
      makeItem({ entry: { isDirectory: false, isFile: true }, file }),
    ];

    const result = await partitionDroppedItemsAsLocalPaths(items);

    expect(result.files).toEqual([]);
    expect(result.localPaths).toEqual<DroppedLocalPath[]>([
      { isDirectory: true, name: 'docs', path: '/abs/docs' },
      { isDirectory: false, name: 'readme.md', path: '/abs/readme.md' },
    ]);
  });

  it('falls back to flattening a folder when Electron path resolution fails', async () => {
    (globalThis as any).window.electron = undefined;

    const innerFile = makeFile('child.txt');
    const folderEntry: FileSystemDirectoryEntry = {
      createReader: () =>
        ({
          readEntries: (cb: (entries: FileSystemEntry[]) => void) =>
            cb([
              {
                file: (fileCb: (file: File) => void) => fileCb(innerFile),
                isDirectory: false,
                isFile: true,
              } as unknown as FileSystemFileEntry,
            ]),
        }) as unknown as FileSystemDirectoryReader,
      isDirectory: true,
      isFile: false,
    } as unknown as FileSystemDirectoryEntry;

    const items = [
      makeItem({
        entry: folderEntry as unknown as EntryShape,
        file: makeFile('unused'),
      }),
    ];

    const result = await partitionDroppedItemsAsLocalPaths(items);

    expect(result.localPaths).toEqual([]);
    expect(result.files.map((f) => f.name)).toEqual(['child.txt']);
  });

  it('falls back to uploading a file when Electron path resolution fails', async () => {
    (globalThis as any).window.electron = undefined;

    const file = makeFile('fallback.txt');
    const items = [makeItem({ entry: { isDirectory: false, isFile: true }, file })];

    const result = await partitionDroppedItemsAsLocalPaths(items);

    expect(result.localPaths).toEqual([]);
    expect(result.files.map((f) => f.name)).toEqual(['fallback.txt']);
  });

  it('skips items whose kind is not "file"', async () => {
    const items = [makeItem({ kind: 'string', entry: { isDirectory: true, isFile: false } })];

    const result = await partitionDroppedItemsAsLocalPaths(items);

    expect(result.localPaths).toEqual([]);
    expect(result.files).toEqual([]);
  });
});
