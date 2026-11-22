// @vitest-environment node
import { createHash } from 'node:crypto';

import { ARTBOARD_FILE_LIMITS } from '@lobechat/types';
import { beforeEach, describe, expect, it } from 'vitest';

import { ArtboardServiceError } from '../errors';
import { type ArtboardBlobStore, ArtboardFileService } from '../files';

const artboardId = 'art_files_service';

export const memoryStore = () => {
  const blobs = new Map<string, Uint8Array>();
  const store: ArtboardBlobStore = {
    delete: async (keys) => {
      for (const key of keys) blobs.delete(key);
    },
    list: async (prefix) =>
      [...blobs]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, bytes]) => ({
          etag: createHash('md5').update(bytes).digest('hex'),
          key,
          size: bytes.byteLength,
        })),
    presignWrite: async (key) => ({ url: `memory://${key}` }),
    read: async (key) => {
      const bytes = blobs.get(key);
      if (!bytes) throw new Error(`missing ${key}`);
      return bytes;
    },
    write: async (key, bytes) => {
      blobs.set(key, bytes);
    },
  };
  return { blobs, store };
};

const md5 = (text: string | Uint8Array) => createHash('md5').update(text).digest('hex');
const shot = new Uint8Array([137, 80, 78, 71]);

let blobs: Map<string, Uint8Array>;
let service: ArtboardFileService;

const errorOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ArtboardServiceError) return error;
    throw error;
  }
  throw new Error('expected an ArtboardServiceError');
};

beforeEach(() => {
  const memory = memoryStore();
  blobs = memory.blobs;
  service = new ArtboardFileService({
    resolveImage: async (fileRef) =>
      fileRef === 'msg_1.image_1' ? { bytes: shot, contentType: 'image/png' } : undefined,
    resolveImport: async ({ canvasId }) =>
      canvasId === 'cvs_1'
        ? {
            assets: [{ bytes: new TextEncoder().encode('p{}'), path: 'assets/app.css' }],
            entry: new TextEncoder().encode('<html>canvas</html>'),
          }
        : undefined,
    store: memory.store,
  });
});

describe('ArtboardFileService', () => {
  it('stores each file under its path and lists it with its ETag', async () => {
    const html = '<!doctype html><body style="background:#0b0b0b">hi</body>';

    const changed = await service.applyChanges(artboardId, {
      writes: [{ content: html, path: 'pages/home/a.html' }],
    });

    expect(changed).toEqual(['pages/home/a.html']);
    expect(
      new TextDecoder().decode(blobs.get(`artboards/${artboardId}/files/pages/home/a.html`)),
    ).toBe(html);
    expect(await service.list(artboardId)).toEqual([
      {
        contentType: 'text/html; charset=utf-8',
        hash: md5(html),
        path: 'pages/home/a.html',
        size: html.length,
      },
    ]);
  });

  it('reads a text file back', async () => {
    await service.applyChanges(artboardId, { writes: [{ content: 'a { }', path: 'a.css' }] });

    expect(await service.read(artboardId, 'a.css')).toMatchObject({
      content: 'a { }',
      contentType: 'text/css; charset=utf-8',
      path: 'a.css',
    });
  });

  it('reports a missing file as not found', async () => {
    expect((await errorOf(service.read(artboardId, 'gone.html'))).code).toBe('not_found');
  });

  it('copies an image from the conversation by its ref, and writes base64 as raw bytes', async () => {
    await service.applyChanges(artboardId, {
      writes: [
        { fileRef: 'msg_1.image_1', path: 'shots/a.png' },
        { base64: Buffer.from(shot).toString('base64'), path: 'shots/b.png' },
      ],
    });

    expect(blobs.get(`artboards/${artboardId}/files/shots/a.png`)).toEqual(shot);
    expect(blobs.get(`artboards/${artboardId}/files/shots/b.png`)).toEqual(shot);
  });

  it('refuses an image ref it cannot resolve', async () => {
    const error = await errorOf(
      service.applyChanges(artboardId, { writes: [{ fileRef: 'nope', path: 'x.png' }] }),
    );
    expect(error.code).toBe('source_denied');
  });

  it('imports a Canvas page as a copy, and refuses one it cannot read', async () => {
    await service.applyChanges(artboardId, {
      writes: [{ fromCanvas: { canvasId: 'cvs_1' }, path: 'pages/imported.html' }],
    });
    const missing = await errorOf(
      service.applyChanges(artboardId, {
        writes: [{ fromCanvas: { canvasId: 'cvs_gone' }, path: 'pages/x.html' }],
      }),
    );

    expect((await service.read(artboardId, 'pages/imported.html')).content).toBe(
      '<html>canvas</html>',
    );
    // Next to the page, so the page's relative <link href="assets/app.css"> still resolves.
    expect((await service.read(artboardId, 'pages/assets/app.css')).content).toBe('p{}');
    expect(missing.code).toBe('source_denied');
  });

  it('applies an edit whose old text appears exactly once', async () => {
    await service.applyChanges(artboardId, {
      writes: [{ content: '<h1>Old</h1><p>Old</p><b>x</b>', path: 'a.html' }],
    });

    await service.applyChanges(artboardId, {
      edits: [{ newText: 'y', oldText: 'x', path: 'a.html' }],
    });
    const twice = await errorOf(
      service.applyChanges(artboardId, {
        edits: [{ newText: 'New', oldText: 'Old', path: 'a.html' }],
      }),
    );
    const absent = await errorOf(
      service.applyChanges(artboardId, {
        edits: [{ newText: 'New', oldText: 'missing', path: 'a.html' }],
      }),
    );

    expect((await service.read(artboardId, 'a.html')).content).toBe(
      '<h1>Old</h1><p>Old</p><b>y</b>',
    );
    expect(twice.message).toContain('2 times');
    expect(absent.code).toBe('invalid');
  });

  it('refuses a path outside the artboard', async () => {
    const error = await errorOf(
      service.applyChanges(artboardId, { writes: [{ content: 'x', path: '../escape.html' }] }),
    );
    expect(error.code).toBe('invalid');
  });

  it('refuses a text file over the limit and writes nothing from the batch', async () => {
    const error = await errorOf(
      service.applyChanges(artboardId, {
        writes: [
          { content: 'ok', path: 'ok.html' },
          { content: 'x'.repeat(ARTBOARD_FILE_LIMITS.maxTextFileBytes + 1), path: 'big.html' },
        ],
      }),
    );

    expect(error.code).toBe('invalid');
    expect(blobs.size).toBe(0);
  });

  it('deletes files without asking whether a board shows them', async () => {
    await service.applyChanges(artboardId, {
      writes: [
        { content: 'a', path: 'a.html' },
        { content: 'b', path: 'b.html' },
      ],
    });

    await service.applyChanges(artboardId, { deletes: ['a.html', 'never-written.html'] });

    expect((await service.list(artboardId)).map((file) => file.path)).toEqual(['b.html']);
  });

  it('records a file the client PUT to its signed URL, and refuses one never uploaded', async () => {
    const { uploads } = await service.prepareUploads(artboardId, [
      { path: 'shots/big.png', size: 3 * 1024 * 1024 },
    ]);
    blobs.set(uploads[0].url.replace('memory://', ''), shot);

    const changed = await service.applyChanges(artboardId, {
      writes: [{ path: 'shots/big.png', uploaded: true }],
    });
    const never = await errorOf(
      service.applyChanges(artboardId, { writes: [{ path: 'shots/none.png', uploaded: true }] }),
    );

    expect(uploads.map((upload) => upload.path)).toEqual(['shots/big.png']);
    expect(changed).toEqual(['shots/big.png']);
    expect(never.code).toBe('invalid');
  });

  it('refuses to sign an upload over the size limit', async () => {
    const error = await errorOf(
      service.prepareUploads(artboardId, [
        { path: 'huge.png', size: ARTBOARD_FILE_LIMITS.maxImageBytes + 1 },
      ]),
    );
    expect(error.code).toBe('invalid');
  });

  it('removes every object of an artboard', async () => {
    await service.applyChanges(artboardId, { writes: [{ content: 'a', path: 'a.html' }] });
    blobs.set('artboards/other/files/keep.html', shot);

    await service.removeAll(artboardId);

    expect([...blobs.keys()]).toEqual(['artboards/other/files/keep.html']);
  });
});
