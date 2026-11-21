// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FileModel } from '@/database/models/file';
import { users } from '@/database/schemas';

import { type CanvasBlobStore, CanvasStorageService, isOwnCanvasManifestKey } from '../storage';

const serverDB = await getTestDB();
const userId = 'canvas-storage-user';

const createMemoryStore = () => {
  const objects = new Map<string, Uint8Array>();
  const store: CanvasBlobStore = {
    delete: vi.fn(async (keys: string[]) => {
      for (const key of keys) objects.delete(key);
    }),
    read: async (key) => {
      const value = objects.get(key);
      if (!value) throw new Error(`missing ${key}`);
      return value;
    },
    write: vi.fn(async (key: string, bytes: Uint8Array) => {
      objects.set(key, bytes);
    }),
  };
  return { objects, store };
};

const page = (body: string) => `<!doctype html><html><body>${body}</body></html>`;

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values({ id: userId });
});

describe('isOwnCanvasManifestKey', () => {
  it('accepts only manifests stored under the caller', () => {
    expect(isOwnCanvasManifestKey('u1', 'canvas/u1/cvs_1/manifests/a.json')).toBe(true);
    expect(isOwnCanvasManifestKey('u1', 'canvas/u2/cvs_1/manifests/a.json')).toBe(false);
    expect(isOwnCanvasManifestKey('u1', 'canvas/u1/../u2/cvs_1/manifests/a.json')).toBe(false);
    expect(isOwnCanvasManifestKey('u1', 'canvas/u1x/cvs_1/manifests/a.json')).toBe(false);
  });
});

describe('CanvasStorageService', () => {
  it('returns complete text and binary snapshots while refusing a foreign manifest', async () => {
    const { store } = createMemoryStore();
    const service = new CanvasStorageService({ db: serverDB, store, userId });
    const result = await service.commit('cvs_snapshot', [
      { content: page('<img src="a.png">'), path: 'index.html' },
      { content: new Uint8Array([0, 127, 255]), path: 'a.png' },
    ]);
    if (!result.ok) throw new Error('commit failed');
    const snapshot = await service.readSnapshot(result.metadata.manifestKey);
    expect(snapshot.entry).toBe('index.html');
    expect(snapshot.files.find((file) => file.path === 'index.html')).toMatchObject({
      content: page('<img src="a.png">'),
      encoding: 'utf8',
    });
    expect(snapshot.files.find((file) => file.path === 'a.png')).toMatchObject({
      content: Buffer.from([0, 127, 255]).toString('base64'),
      encoding: 'base64',
    });
    await expect(
      service.readSnapshot('canvas/another-user/cvs_snapshot/manifests/a.json'),
    ).rejects.toThrow(/owned/);
  });

  it('stores a project as content-addressed blobs plus a manifest and counts it toward usage', async () => {
    const { store } = createMemoryStore();
    const service = new CanvasStorageService({ db: serverDB, store, userId });

    const result = await service.commit('cvs_a', [
      { content: page('<lobe-tag>hi</lobe-tag>'), path: 'index.html' },
      { content: '[1,2]', path: 'data.json' },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.metadata).toMatchObject({ entry: 'index.html', fileCount: 2, runtimeMajor: 1 });
    expect(result.metadata.manifestKey).toMatch(
      /^canvas\/canvas-storage-user\/cvs_a\/manifests\/.+\.json$/,
    );

    const manifest = await service.readManifest(result.metadata.manifestKey);
    expect(Object.keys(manifest.files).sort()).toEqual(['data.json', 'index.html']);

    const file = await service.readFile(manifest, 'data.json');
    expect(new TextDecoder().decode(file?.bytes)).toBe('[1,2]');
    expect(file?.contentType).toContain('application/json');

    expect(await new FileModel(serverDB, userId).countUsage()).toBe(result.metadata.totalSize);
  });

  it('uploads unchanged files only once across versions', async () => {
    const { store } = createMemoryStore();
    const service = new CanvasStorageService({ db: serverDB, store, userId });
    const files = [
      { content: page('a'), path: 'index.html' },
      { content: 'body{}', path: 'app.css' },
    ];

    await service.commit('cvs_a', files);
    await service.commit('cvs_a', [{ ...files[0], content: page('b') }, files[1]]);

    expect(store.write).toHaveBeenCalledTimes(2 + 1 + 1 + 1);
  });

  it('loads the previous version with text files read and binary files sized', async () => {
    const { store } = createMemoryStore();
    const service = new CanvasStorageService({ db: serverDB, store, userId });
    const result = await service.commit('cvs_a', [
      { content: page('<img src="a.png">'), path: 'index.html' },
      { content: new Uint8Array([1, 2, 3, 4]), path: 'a.png' },
    ]);
    if (!result.ok) throw new Error('commit failed');

    const project = await service.loadProject(
      await service.readManifest(result.metadata.manifestKey),
    );

    expect(project.get('index.html')?.content).toBe(page('<img src="a.png">'));
    expect(project.get('a.png')).toMatchObject({ size: 4 });

    const next = await service.commit('cvs_a', [...project.values()]);
    expect(next.ok).toBe(true);
  });

  it('returns validation issues without writing anything', async () => {
    const { store } = createMemoryStore();
    const service = new CanvasStorageService({ db: serverDB, store, userId });

    const result = await service.commit('cvs_a', [
      { content: page('<lobe-nope></lobe-nope>'), path: 'index.html' },
    ]);

    expect(result).toMatchObject({ issues: [{ rule: 'unknown-component' }], ok: false });
    expect(store.write).not.toHaveBeenCalled();
  });

  it('refuses a commit that exceeds the storage quota', async () => {
    const { store } = createMemoryStore();
    const checkQuota = vi.fn().mockResolvedValue({ message: 'Storage is full', ok: false });
    const service = new CanvasStorageService({ checkQuota, db: serverDB, store, userId });

    const result = await service.commit('cvs_a', [{ content: page('x'), path: 'index.html' }]);

    expect(result).toMatchObject({
      issues: [{ message: 'Storage is full', rule: 'quota-exceeded' }],
      ok: false,
    });
    expect(checkQuota).toHaveBeenCalledWith(
      expect.objectContaining({ addedBytes: expect.any(Number), userId }),
    );
    expect(store.write).not.toHaveBeenCalled();
  });

  it('refuses to read another user’s manifest', async () => {
    const { store } = createMemoryStore();
    const service = new CanvasStorageService({ db: serverDB, store, userId });

    await expect(
      service.readManifest('canvas/someone-else/cvs/manifests/x.json'),
    ).rejects.toThrow();
  });

  it('deletes every version manifest and unshared blob while preserving other canvases', async () => {
    const { objects, store } = createMemoryStore();
    const service = new CanvasStorageService({ db: serverDB, store, userId });
    const manifests: string[] = [];
    for (const content of ['first', 'second']) {
      const result = await service.commit('cvs_a', [
        { content: page(content), path: 'index.html' },
      ]);
      if (!result.ok) throw new Error('commit failed');
      manifests.push(result.metadata.manifestKey);
    }
    const otherKeys = [
      `canvas/${userId}/cvs_b/manifests/other.json`,
      'canvas/another-user/cvs_a/manifests/other.json',
    ];
    for (const key of otherKeys) objects.set(key, new Uint8Array([1]));

    await service.removeCanvas('cvs_a', [...manifests, ...otherKeys]);

    expect(await new FileModel(serverDB, userId).countUsage()).toBe(0);
    expect([...objects.keys()].sort()).toEqual(otherKeys.sort());
  });
});
