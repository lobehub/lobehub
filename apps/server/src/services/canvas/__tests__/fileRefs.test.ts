import { CANVAS_LIMITS } from '@lobechat/canvas';
import { describe, expect, it, vi } from 'vitest';

import { type CanvasRefFile, createCanvasFileRefResolver } from '../fileRefs';

const png = new Uint8Array([137, 80, 78, 71]);

const fileOf = (overrides: Partial<CanvasRefFile> = {}): CanvasRefFile => ({
  fileType: 'image/png',
  id: 'file_logo',
  name: 'logo.png',
  size: png.byteLength,
  url: 'files/user/logo.png',
  ...overrides,
});

const setup = (
  files: CanvasRefFile[] = [fileOf()],
  mediaRefs: Record<string, string | undefined> = {},
) => {
  const readBytes = vi.fn(async (key: string) => {
    if (key.endsWith('.csv')) return new TextEncoder().encode('a,b\n1,2');
    if (key.endsWith('.bin')) return new Uint8Array([0xff, 0xfe, 0x00]);
    return png;
  });
  const listMediaFileIds = vi.fn(async () => new Map(Object.entries(mediaRefs)));
  const resolver = createCanvasFileRefResolver({
    findFile: async (id) => files.find((file) => file.id === id),
    listMediaFileIds,
    readBytes,
  });
  return { listMediaFileIds, readBytes, resolver };
};

describe('createCanvasFileRefResolver', () => {
  it('copies an owned file by id', async () => {
    const { resolver } = setup();

    const result = await resolver([{ fileRef: 'file_logo', path: 'img/logo.png' }]);

    expect(result.issues).toEqual([]);
    expect(result.contents.get('file_logo')).toBe(png);
  });

  it('resolves an image ref from the conversation to its file', async () => {
    const { resolver } = setup([fileOf()], { 'msg_a1b2c3.image_1': 'file_logo' });

    const result = await resolver([{ fileRef: 'msg_a1b2c3.image_1', path: 'img/photo.png' }]);

    expect(result.issues).toEqual([]);
    expect(result.contents.get('msg_a1b2c3.image_1')).toBe(png);
  });

  it('only looks up conversation media when a media ref is used', async () => {
    const { listMediaFileIds, resolver } = setup();

    await resolver([{ fileRef: 'file_logo', path: 'img/logo.png' }]);

    expect(listMediaFileIds).not.toHaveBeenCalled();
  });

  it('decodes a file written to a text path', async () => {
    const { resolver } = setup([fileOf({ fileType: 'text/csv', id: 'file_csv', url: 'k.csv' })]);

    const result = await resolver([{ fileRef: 'file_csv', path: 'data/table.csv' }]);

    expect(result.contents.get('file_csv')).toBe('a,b\n1,2');
  });

  it('reports refs that match no accessible file', async () => {
    const { readBytes, resolver } = setup([], { 'msg_a1b2c3.image_1': undefined });

    const result = await resolver([
      { fileRef: 'file_other_user', path: 'a.png' },
      { fileRef: 'msg_a1b2c3.image_1', path: 'b.png' },
      { fileRef: 'msg_zzzzzz.image_9', path: 'c.png' },
    ]);

    expect(result.issues.map((issue) => [issue.file, issue.rule])).toEqual([
      ['a.png', 'unresolved-file-ref'],
      ['b.png', 'unresolved-file-ref'],
      ['c.png', 'unresolved-file-ref'],
    ]);
    expect(readBytes).not.toHaveBeenCalled();
  });

  it('refuses a file whose kind does not match the target path', async () => {
    const { readBytes, resolver } = setup([
      fileOf(),
      fileOf({ fileType: 'application/pdf', id: 'file_pdf' }),
    ]);

    const imageAsPdf = await resolver([{ fileRef: 'file_logo', path: 'fonts/brand.woff2' }]);
    const unknownKind = await resolver([{ fileRef: 'file_pdf', path: 'img/scan.png' }]);

    expect(imageAsPdf.issues.map((issue) => issue.rule)).toEqual(['file-type-mismatch']);
    expect(unknownKind.issues).toEqual([]);
    expect(readBytes).toHaveBeenCalledTimes(1);
  });

  it('refuses non-UTF-8 bytes on a text path', async () => {
    const { resolver } = setup([fileOf({ fileType: '', id: 'file_bin', url: 'k.bin' })]);

    const result = await resolver([{ fileRef: 'file_bin', path: 'data/table.csv' }]);

    expect(result.issues.map((issue) => issue.rule)).toEqual(['file-type-mismatch']);
  });

  it('refuses an oversized file before downloading it', async () => {
    const { readBytes, resolver } = setup([
      fileOf({ size: CANVAS_LIMITS.maxFileBytes + 1 }),
      fileOf({ fileType: 'text/csv', id: 'file_csv', size: CANVAS_LIMITS.maxTextFileBytes + 1 }),
    ]);

    const result = await resolver([
      { fileRef: 'file_logo', path: 'img/logo.png' },
      { fileRef: 'file_csv', path: 'data/table.csv' },
    ]);

    expect(result.issues.map((issue) => issue.rule)).toEqual(['file-too-large', 'file-too-large']);
    expect(readBytes).not.toHaveBeenCalled();
  });
});
