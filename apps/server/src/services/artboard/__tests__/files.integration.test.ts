// @vitest-environment node
import { createHash } from 'node:crypto';

import { type LobeChatDatabase } from '@lobechat/database';
import { getTestDB } from '@lobechat/database/test-utils';
import { ARTBOARD_FILE_LIMITS } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { artboards, users } from '@/database/schemas';

import { ArtboardServiceError } from '../errors';
import { type ArtboardBlobStore, ArtboardFileService } from '../files';

const userId = 'artboard-files-user';
const artboardId = 'art_files_service';

const db: LobeChatDatabase = await getTestDB();

const memoryStore = () => {
  const blobs = new Map<string, Uint8Array>();
  const store: ArtboardBlobStore = {
    delete: async (keys) => {
      for (const key of keys) blobs.delete(key);
    },
    list: async (prefix) => [...blobs.keys()].filter((key) => key.startsWith(prefix)),
    read: async (key) => {
      const bytes = blobs.get(key);
      if (!bytes) throw new Error(`missing ${key}`);
      return bytes;
    },
    presignWrite: async (key) => ({ url: `memory://${key}` }),
    write: async (key, bytes) => {
      blobs.set(key, bytes);
    },
  };
  return { blobs, store };
};

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

let blobs: Map<string, Uint8Array>;
let service: ArtboardFileService;
const shot = new Uint8Array([137, 80, 78, 71]);

const errorOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ArtboardServiceError) return error;
    throw error;
  }
  throw new Error('expected an ArtboardServiceError');
};

beforeEach(async () => {
  await db.delete(users).where(eq(users.id, userId));
  await db.insert(users).values({ id: userId });
  await db.insert(artboards).values({ id: artboardId, title: 'Board', userId });
  const memory = memoryStore();
  blobs = memory.blobs;
  service = new ArtboardFileService({
    db,
    resolveImage: async (fileRef) =>
      fileRef === 'msg_1.image_1' ? { bytes: shot, contentType: 'image/png' } : undefined,
    store: memory.store,
    userId,
  });
});

describe('ArtboardFileService', () => {
  it('stores written text under its sha256 and lists it by path', async () => {
    const html = '<!doctype html><body style="background:#0b0b0b">hi</body>';

    const changed = await service.applyChanges(artboardId, {
      writes: [{ content: html, path: 'pages/home/a.html' }],
    });

    expect(changed).toEqual([{ hash: sha(html), path: 'pages/home/a.html', size: html.length }]);
    expect(new TextDecoder().decode(blobs.get(`artboards/${artboardId}/${sha(html)}`))).toBe(html);
    expect((await service.list(artboardId)).map(({ hash, path }) => ({ hash, path }))).toEqual([
      { hash: sha(html), path: 'pages/home/a.html' },
    ]);
  });

  it('reads a file back as text with its hash', async () => {
    await service.applyChanges(artboardId, { writes: [{ content: 'a { }', path: 'a.css' }] });

    expect(await service.read(artboardId, 'a.css')).toMatchObject({
      content: 'a { }',
      contentType: 'text/css; charset=utf-8',
      hash: sha('a { }'),
    });
  });

  it('copies an image from the conversation by its ref', async () => {
    await service.applyChanges(artboardId, {
      writes: [{ fileRef: 'msg_1.image_1', path: 'shots/home.png' }],
    });

    const [row] = await service.list(artboardId);
    expect(row).toMatchObject({ contentType: 'image/png', path: 'shots/home.png', size: 4 });
    expect(blobs.get(`artboards/${artboardId}/${row.hash}`)).toEqual(shot);
  });

  it('stores a base64 write as its raw bytes', async () => {
    await service.applyChanges(artboardId, {
      writes: [{ base64: Buffer.from(shot).toString('base64'), path: 'shots/push.png' }],
    });

    const [row] = await service.list(artboardId);
    expect(row).toMatchObject({ contentType: 'image/png', path: 'shots/push.png', size: 4 });
    expect(blobs.get(`artboards/${artboardId}/${row.hash}`)).toEqual(shot);
  });

  it('refuses an image ref it cannot resolve', async () => {
    const error = await errorOf(
      service.applyChanges(artboardId, { writes: [{ fileRef: 'msg_9.image_1', path: 'a.png' }] }),
    );
    expect(error.code).toBe('source_denied');
  });

  it('applies an edit whose old text appears exactly once', async () => {
    await service.applyChanges(artboardId, {
      writes: [{ content: '<h1>Old</h1><p>keep</p>', path: 'a.html' }],
    });

    await service.applyChanges(artboardId, {
      edits: [{ newText: '<h1>New</h1>', oldText: '<h1>Old</h1>', path: 'a.html' }],
    });

    expect((await service.read(artboardId, 'a.html')).content).toBe('<h1>New</h1><p>keep</p>');
  });

  it.each([
    ['is missing', '<h2>'],
    ['appears twice', 'p'],
  ])('refuses an edit whose old text %s', async (_, oldText) => {
    await service.applyChanges(artboardId, {
      writes: [{ content: '<p>a</p><p>b</p>', path: 'a.html' }],
    });

    const error = await errorOf(
      service.applyChanges(artboardId, { edits: [{ newText: 'x', oldText, path: 'a.html' }] }),
    );
    expect(error.code).toBe('invalid');
    expect((await service.read(artboardId, 'a.html')).content).toBe('<p>a</p><p>b</p>');
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
    expect(await service.list(artboardId)).toEqual([]);
  });

  it('deletes paths and keeps the others', async () => {
    await service.applyChanges(artboardId, {
      writes: [
        { content: 'a', path: 'a.html' },
        { content: 'b', path: 'b.html' },
      ],
    });

    await service.applyChanges(artboardId, { deletes: ['a.html'] });

    expect((await service.list(artboardId)).map((row) => row.path)).toEqual(['b.html']);
  });

  it('refuses to delete a path that does not exist', async () => {
    const error = await errorOf(service.applyChanges(artboardId, { deletes: ['nope.html'] }));
    expect(error.code).toBe('invalid');
  });

  it('removes every blob of an artboard', async () => {
    await service.applyChanges(artboardId, { writes: [{ content: 'a', path: 'a.html' }] });
    await service.applyChanges(artboardId, { writes: [{ content: 'b', path: 'a.html' }] });

    await service.removeAll(artboardId);

    expect([...blobs.keys()]).toEqual([]);
  });

  it('refuses an edit whose file changed after it was read', async () => {
    await service.applyChanges(artboardId, {
      writes: [{ content: '<h1>Old</h1><p>x</p>', path: 'a.html' }],
    });
    const first = await service.prepare(artboardId, {
      edits: [{ newText: 'New', oldText: 'Old', path: 'a.html' }],
    });
    const second = await service.prepare(artboardId, {
      edits: [{ newText: 'y', oldText: 'x', path: 'a.html' }],
    });
    await db.transaction((tx) => service.commit(artboardId, first, tx));

    const error = await errorOf(db.transaction((tx) => service.commit(artboardId, second, tx)));

    expect(error.code).toBe('conflict');
    expect((await service.read(artboardId, 'a.html')).content).toBe('<h1>New</h1><p>x</p>');
  });

  it('reports the files left after a delete that landed between prepare and commit', async () => {
    await service.applyChanges(artboardId, {
      writes: [
        { content: 'a', path: 'a.html' },
        { content: 'b', path: 'b.html' },
      ],
    });
    const write = await service.prepare(artboardId, { writes: [{ content: 'c', path: 'c.html' }] });
    await service.applyChanges(artboardId, { deletes: ['b.html'] });

    const { paths } = await db.transaction((tx) => service.commit(artboardId, write, tx));

    expect([...paths].toSorted()).toEqual(['a.html', 'c.html']);
  });

  describe('presigned uploads', () => {
    const big = new Uint8Array(3 * 1024 * 1024).fill(7);
    const bigHash = createHash('sha256').update(big).digest('hex');
    const putTo = (url: string, bytes: Uint8Array) =>
      blobs.set(url.replace('memory://', ''), bytes);

    it('commits a file the client uploaded to the signed URL, checked by its hash', async () => {
      const { uploads } = await service.prepareUploads(artboardId, [
        { hash: bigHash, path: 'shots/home.png', size: big.byteLength },
      ]);
      expect(uploads.map((upload) => upload.path)).toEqual(['shots/home.png']);
      putTo(uploads[0].url, big);

      const changed = await service.applyChanges(artboardId, {
        writes: [{ hash: bigHash, path: 'shots/home.png' }],
      });

      expect(changed).toEqual([{ hash: bigHash, path: 'shots/home.png', size: big.byteLength }]);
      expect((await service.read(artboardId, 'shots/home.png')).contentType).toBe('image/png');
    });

    it('asks for no upload of content the artboard already stores', async () => {
      await service.applyChanges(artboardId, {
        writes: [{ base64: Buffer.from(shot).toString('base64'), path: 'a.png' }],
      });
      const hash = createHash('sha256').update(shot).digest('hex');

      const { uploads } = await service.prepareUploads(artboardId, [
        { hash, path: 'b.png', size: shot.byteLength },
      ]);

      expect(uploads).toEqual([]);
      await service.applyChanges(artboardId, { writes: [{ hash, path: 'b.png' }] });
      expect((await service.list(artboardId)).map((file) => file.path)).toEqual(['a.png', 'b.png']);
    });

    it('refuses an upload over the size limit before signing it', async () => {
      const error = await errorOf(
        service.prepareUploads(artboardId, [
          { hash: bigHash, path: 'huge.png', size: ARTBOARD_FILE_LIMITS.maxImageBytes + 1 },
        ]),
      );

      expect(error.code).toBe('invalid');
    });

    it('refuses a commit whose uploaded bytes do not match the hash, or were never uploaded', async () => {
      const { uploads } = await service.prepareUploads(artboardId, [
        { hash: bigHash, path: 'shots/home.png', size: big.byteLength },
      ]);
      putTo(uploads[0].url, shot);

      const tampered = await errorOf(
        service.applyChanges(artboardId, { writes: [{ hash: bigHash, path: 'shots/home.png' }] }),
      );
      const missing = await errorOf(
        service.applyChanges(artboardId, { writes: [{ hash: sha('nope'), path: 'x.png' }] }),
      );

      expect(tampered.code).toBe('invalid');
      expect(missing.code).toBe('invalid');
      expect(await service.list(artboardId)).toEqual([]);
    });
  });
});
