import type { ProjectFileIndexResult } from '@lobechat/electron-client-ipc';
import { describe, expect, it } from 'vitest';

import { REPLICA_INDEX_KEY, type ReplicaRow, type ReplicaStorage } from '@/libs/replica';

import {
  decodeProjectIndex,
  encodeProjectIndex,
  GIT_WORKING_TREE_PERSIST_MAX_PATHS,
  gitWorkingTreeFilesCodec,
  isPersistedPartialIndex,
  projectIndexCodec,
  withPersistCodec,
} from './codec';

const index: ProjectFileIndexResult = {
  entries: [
    { isDirectory: true, name: 'src', path: '/repo/src', relativePath: 'src/' },
    {
      isDirectory: false,
      name: 'index.ts',
      path: '/repo/src/index.ts',
      relativePath: 'src/index.ts',
    },
    {
      collapsed: true,
      gitIgnored: true,
      isDirectory: true,
      name: 'node_modules',
      path: '/repo/node_modules',
      relativePath: 'node_modules/',
    },
    {
      gitIgnored: true,
      isDirectory: false,
      name: '.env',
      path: '/repo/.env',
      relativePath: '.env',
    },
  ],
  indexedAt: '2026-10-12T00:00:00.000Z',
  root: '/repo',
  source: 'git',
};

describe('project index codec', () => {
  it('round-trips an index losslessly while dropping derivable fields', () => {
    const encoded = encodeProjectIndex(index);

    expect(encoded.entries).toEqual([
      ['src/', 1],
      ['src/index.ts', 0],
      ['node_modules/', 7],
      ['.env', 2],
    ]);
    expect(decodeProjectIndex(encoded)).toEqual(index);
  });

  it('keeps paths and names a host did not derive from the root', () => {
    const windows: ProjectFileIndexResult = {
      entries: [
        { isDirectory: true, name: 'src', path: 'C:\\repo\\src', relativePath: 'src/' },
        { isDirectory: false, name: 'a.ts', path: 'C:\\repo\\src\\a.ts', relativePath: 'src/a.ts' },
      ],
      indexedAt: 'now',
      root: 'C:\\repo',
      source: 'glob',
    };
    const sandbox: ProjectFileIndexResult = {
      entries: [
        {
          isDirectory: false,
          name: 'Report',
          path: '/workspace/out/report.md',
          relativePath: 'report.md',
        },
      ],
      indexedAt: 'now',
      root: '',
      source: 'sandbox',
      truncated: true,
    };

    expect(encodeProjectIndex(windows).entries).toEqual([
      ['src/', 1],
      ['src/a.ts', 0],
    ]);
    expect(decodeProjectIndex(encodeProjectIndex(windows))).toEqual(windows);
    expect(decodeProjectIndex(encodeProjectIndex(sandbox))).toEqual(sandbox);
  });

  it('keeps the shallowest entries, in order, when the tree is past the cap', () => {
    const decoded = decodeProjectIndex(encodeProjectIndex(index, 3));

    expect(decoded.entries.map((entry) => entry.relativePath)).toEqual([
      'src/',
      'node_modules/',
      '.env',
    ]);
  });

  it('caps a large index in source order without reordering the tree', () => {
    const entries = Array.from({ length: 25_050 }, (_, index) => {
      const relativePath = `${'deep/'.repeat(index % 5)}f${index}`;

      return {
        isDirectory: false,
        name: `f${index}`,
        path: `/repo/${relativePath}`,
        relativePath,
      };
    });

    const encoded = encodeProjectIndex({ ...index, entries }, 20_000);
    const keptPaths = encoded.entries.map(([relativePath]) => relativePath as string);

    expect(keptPaths).toHaveLength(20_000);
    // Every root-level entry survives, and the retained entries keep the
    // source order the tree renders in.
    const rootPaths = entries.filter((entry) => !entry.relativePath.includes('/'));
    for (const entry of rootPaths) expect(keptPaths).toContain(entry.relativePath);
    const sourceIndex = new Map(entries.map((entry, i) => [entry.relativePath, i]));
    const keptIndexes = keptPaths.map((path) => sourceIndex.get(path)!);
    expect(keptIndexes).toEqual([...keptIndexes].sort((a, b) => a - b));
  });

  it('marks a capped tree as partial, and keeps it partial when written back', () => {
    expect(isPersistedPartialIndex(decodeProjectIndex(encodeProjectIndex(index)))).toBe(false);

    const restored = decodeProjectIndex(encodeProjectIndex(index, 3));
    expect(isPersistedPartialIndex(restored)).toBe(true);
    // Under the cap now, but it is still the cut-down copy, not the full tree.
    expect(isPersistedPartialIndex(decodeProjectIndex(encodeProjectIndex(restored)))).toBe(true);
  });

  it('decodes only rows it encoded', () => {
    expect(projectIndexCodec.decode(projectIndexCodec.encode(index))).toEqual(index);
    // A raw (unencoded) value is an older shape: a miss, not a broken tree.
    expect(projectIndexCodec.decode(index)).toBeUndefined();
  });
});

describe('git working tree codec', () => {
  it('stores the dirty-file lists and skips oversized overlays', () => {
    const files = { added: ['a.ts'], deleted: [], modified: ['b.ts'] };
    expect(gitWorkingTreeFilesCodec.decode(gitWorkingTreeFilesCodec.encode(files))).toEqual(files);

    const huge = {
      added: Array.from({ length: GIT_WORKING_TREE_PERSIST_MAX_PATHS + 1 }, (_, i) => `f${i}`),
      deleted: [],
      modified: [],
    };
    expect(gitWorkingTreeFilesCodec.encode(huge)).toBeUndefined();
  });
});

const memoryStorage = () => {
  const rows = new Map<string, ReplicaRow<unknown>>();
  const id = ({ queryKey, scope }: { queryKey: string; scope: string }) => `${scope}|${queryKey}`;
  const storage: ReplicaStorage<unknown> = {
    get: async (key) => rows.get(id(key)),
    getStrict: async (key) => rows.get(id(key)),
    remove: async (key) => {
      rows.delete(id(key));
    },
    set: async (key, row) => {
      rows.set(id(key), row);
    },
  };
  return { rows, storage };
};

describe('withPersistCodec', () => {
  const key = { queryKey: '["local","/repo"]', scope: 'u1:personal' };

  it('stores the encoded row and reads the decoded value back', async () => {
    const { rows, storage } = memoryStorage();
    const codecStorage = withPersistCodec(storage, projectIndexCodec);

    await codecStorage.set(key, { data: index, updatedAt: 1 });

    expect((rows.get(`u1:personal|${key.queryKey}`)?.data as any).entries).toEqual([
      ['src/', 1],
      ['src/index.ts', 0],
      ['node_modules/', 7],
      ['.env', 2],
    ]);
    expect(await codecStorage.get(key)).toEqual({ data: index, updatedAt: 1 });
    expect(await codecStorage.getStrict!(key)).toEqual({ data: index, updatedAt: 1 });
  });

  it('passes the replica index row through untouched', async () => {
    const { storage } = memoryStorage();
    const codecStorage = withPersistCodec(storage, projectIndexCodec);
    const indexKey = { queryKey: REPLICA_INDEX_KEY, scope: 'u1:personal' };

    await codecStorage.set(indexKey, { data: ['a', 'b'] as any, updatedAt: 1 });

    expect(await codecStorage.get(indexKey)).toEqual({ data: ['a', 'b'], updatedAt: 1 });
  });

  it('drops the old row when a value is too large to keep', async () => {
    const { rows, storage } = memoryStorage();
    const codecStorage = withPersistCodec(storage, gitWorkingTreeFilesCodec);
    const small = { added: ['a.ts'], deleted: [], modified: [] };
    await codecStorage.set(key, { data: small, updatedAt: 1 });

    const huge = {
      added: Array.from({ length: GIT_WORKING_TREE_PERSIST_MAX_PATHS + 1 }, (_, i) => `f${i}`),
      deleted: [],
      modified: [],
    };
    await codecStorage.set(key, { data: huge, updatedAt: 2 });

    expect(rows.size).toBe(0);
    expect(await codecStorage.get(key)).toBeUndefined();
  });
});
