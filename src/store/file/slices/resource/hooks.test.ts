import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getActiveWorkspaceId,
  useActiveWorkspaceId,
} from '@/business/client/hooks/useActiveWorkspaceId';
import { mutate } from '@/libs/swr';
import type { FilesTabs } from '@/types/files';

import {
  applyResourceMoveToListCaches,
  patchDestinationList,
  patchSourceList,
  revalidateResources,
  useFetchResources,
} from './hooks';

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  fileState: {
    hasMore: false,
    queryParams: undefined as any,
    resourceList: [] as any[],
    resourceMap: new Map<string, any>(),
    total: 0,
  },
  queryParams: {
    category: 'audios' as FilesTabs,
    parentId: null,
    showFilesInKnowledgeBase: false,
  },
  useClientDataSWR: vi.fn(() => ({ data: undefined as any })),
  activeWorkspaceId: null as string | null,
}));

vi.mock('@/libs/swr', () => ({
  mutate: mocks.mutate,
  useClientDataSWR: mocks.useClientDataSWR,
}));

vi.mock('../../store', () => ({
  useFileStore: {
    getState: () => mocks.fileState,
    setState: vi.fn((nextState) => {
      mocks.fileState = {
        ...mocks.fileState,
        ...nextState,
      };
    }),
  },
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  getActiveWorkspaceId: vi.fn(() => mocks.activeWorkspaceId),
  useActiveWorkspaceId: vi.fn(() => mocks.activeWorkspaceId),
}));

describe('revalidateResources', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.activeWorkspaceId = null;
    mocks.fileState = {
      hasMore: false,
      queryParams: mocks.queryParams,
      resourceList: [],
      resourceMap: new Map(),
      total: 0,
    };
  });

  it('matches workspace-scoped resource SWR keys', async () => {
    mocks.activeWorkspaceId = 'workspace-1';

    await revalidateResources();

    const [matcher] = vi.mocked(mutate).mock.calls[0] as [(key: unknown) => boolean];

    expect(matcher).toEqual(expect.any(Function));
    expect(matcher(['resource:list', mocks.queryParams, 'workspace-1'])).toBe(true);
    expect(matcher(['resource:list', mocks.queryParams, 'workspace-2'])).toBe(false);
    expect(matcher(['resource:list', mocks.queryParams])).toBe(false);
    expect(matcher(['OTHER_KEY', mocks.queryParams, 'workspace-1'])).toBe(false);
    expect(getActiveWorkspaceId).toHaveBeenCalled();
  });
});

describe('patchDestinationList', () => {
  const row = (id: string, createdAt: string, extra: Record<string, unknown> = {}) =>
    ({ createdAt: new Date(createdAt), id, name: id, size: 1, ...extra }) as any;
  const moved = row('moved', '2026-09-15T00:00:00.000Z');

  it('inserts newest-first when the list has no explicit sort', () => {
    const newer = row('newer', '2026-09-20T00:00:00.000Z');
    const older = row('older', '2026-09-10T00:00:00.000Z');

    expect(
      patchDestinationList({ hasMore: false, items: [newer, older], total: 2 }, moved, {}),
    ).toEqual({ hasMore: false, items: [newer, moved, older], total: 3 });
  });

  it('follows the list sort when both halves are set, like the server does', () => {
    const a = row('a', '2026-09-01T00:00:00.000Z', { name: 'Apple' });
    const z = row('z', '2026-09-02T00:00:00.000Z', { name: 'Zebra' });
    const named = { ...moved, name: 'Mango' };

    expect(
      patchDestinationList({ hasMore: false, items: [a, z] }, named, {
        sortType: 'asc' as any,
        sorter: 'name',
      })!.items.map((item: any) => item.id),
    ).toEqual(['a', 'moved', 'z']);
    expect(
      patchDestinationList({ hasMore: false, items: [z, a] }, named, {
        sortType: 'desc' as any,
        sorter: 'name',
      })!.items.map((item: any) => item.id),
    ).toEqual(['z', 'moved', 'a']);
    // A sorter without a sortType is newest-first on the server too.
    expect(
      patchDestinationList({ hasMore: false, items: [z, a] }, named, { sorter: 'name' })!.items.map(
        (item: any) => item.id,
      ),
    ).toEqual(['moved', 'z', 'a']);
  });

  it('keeps a full page at its length so "load more" resumes at the right offset', () => {
    const page = Array.from({ length: 3 }, (_, i) =>
      row(`row-${i}`, `2026-09-2${i}T00:00:00.000Z`),
    ).reverse(); // newest first: row-2, row-1, row-0
    const inside = row('inside', '2026-09-21T12:00:00.000Z');

    // Sorts inside the page: the last cached row falls off and is fetched
    // again at the same server offset.
    expect(patchDestinationList({ hasMore: true, items: page, total: 10 }, inside, {})).toEqual({
      hasMore: true,
      items: [page[0], inside, page[1]],
      total: 11,
    });

    // Sorts past the page: a later page will hold it, nothing is skipped.
    const beyond = row('beyond', '2026-09-01T00:00:00.000Z');
    expect(patchDestinationList({ hasMore: true, items: page, total: 10 }, beyond, {})).toEqual({
      hasMore: true,
      items: page,
      total: 11,
    });
  });

  it('lets the last loaded page grow when there is nothing more to load', () => {
    const only = row('only', '2026-09-20T00:00:00.000Z');
    const beyond = row('beyond', '2026-09-01T00:00:00.000Z');

    expect(patchDestinationList({ hasMore: false, items: [only], total: 1 }, beyond, {})).toEqual({
      hasMore: false,
      items: [only, beyond],
      total: 2,
    });
  });

  it('keeps one copy of a row the destination already lists (a retried move)', () => {
    const other = row('other', '2026-09-20T00:00:00.000Z');

    expect(
      patchDestinationList({ hasMore: true, items: [other, moved], total: 2 }, moved, {}),
    ).toEqual({ hasMore: true, items: [other, moved], total: 2 });
  });

  it('never seeds a folder that has no cache: its first visit must fetch', () => {
    expect(patchDestinationList(undefined, moved, {})).toBeUndefined();
  });
});

describe('patchSourceList', () => {
  const moved = { id: 'doc-1' } as any;
  const other = { id: 'doc-2' } as any;

  it('drops the moved row and returns the same object when it was not listed', () => {
    expect(patchSourceList({ hasMore: true, items: [other, moved], total: 2 }, moved)).toEqual({
      hasMore: true,
      items: [other],
      total: 1,
    });
    const untouched = { hasMore: false, items: [other], total: 1 };
    expect(patchSourceList(untouched, moved)).toBe(untouched);
    expect(patchSourceList(undefined, moved)).toBeUndefined();
  });
});

describe('applyResourceMoveToListCaches', () => {
  type Matcher = (key: unknown) => boolean;
  type Updater = (data: any) => Promise<any>;
  type MutateCall = [Matcher, Updater, { revalidate: boolean }];

  const moved = {
    createdAt: new Date('2026-09-15T00:00:00.000Z'),
    id: 'doc-1',
    name: 'Weekly report',
    parentId: 'folder-w37',
  };
  const scope = { libraryId: 'kb-1', workspaceId: 'workspace-1' };
  const listKey = (parentId: string | null, extra: Record<string, unknown> = {}) => [
    'resource:list',
    { libraryId: 'kb-1', parentId, showFilesInKnowledgeBase: false, ...extra },
    'workspace-1',
  ];

  /** Keys the SWR cache holds; the mocked `mutate` offers them to every matcher. */
  let cachedKeys: unknown[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    cachedKeys = [];
    vi.mocked(mutate).mockImplementation((async (key: unknown) => {
      if (typeof key === 'function') for (const cached of cachedKeys) (key as Matcher)(cached);
    }) as any);
    // Scope comes from the caller; the active workspace/library must not matter.
    mocks.activeWorkspaceId = 'workspace-9';
    mocks.fileState = {
      hasMore: false,
      queryParams: { libraryId: 'kb-9', parentId: 'elsewhere', showFilesInKnowledgeBase: false },
      resourceList: [],
      resourceMap: new Map(),
      total: 0,
    };
  });

  const runMove = async (
    patch: Partial<Parameters<typeof applyResourceMoveToListCaches>[1]> = {},
  ) => {
    await applyResourceMoveToListCaches(moved as any, {
      fromParentKeys: ['folder-2026-09', 'folder-2026-09-id'],
      scope,
      toParentKeys: ['folder-w37', 'w37-slug'],
      ...patch,
    });

    const calls = vi.mocked(mutate).mock.calls as unknown as MutateCall[];
    const [collect, ...rest] = calls;
    const reconcile = rest.at(-1)!;
    const writes = rest.slice(0, -1);
    return { collect, reconcile, writes };
  };

  it('enumerates the cached destination lists without writing to them', async () => {
    cachedKeys = [listKey('folder-w37'), listKey('w37-slug', { sorter: 'name' })];
    const { collect } = await runMove();
    const [matcher, data, options] = collect;

    expect(options).toEqual({ revalidate: false });
    expect(data).toBeUndefined();
    // The collecting matcher accepts nothing, so SWR mutates nothing.
    expect(matcher(listKey('folder-w37'))).toBe(false);
  });

  it('patches each cached destination list in its own sort, scoped to the given workspace and library', async () => {
    const byName = listKey('w37-slug', { sortType: 'asc', sorter: 'name' });
    cachedKeys = [
      listKey('folder-w37'),
      byName,
      listKey('folder-2026-09'),
      listKey(null),
      ['resource:list', { libraryId: 'kb-2', parentId: 'folder-w37' }, 'workspace-1'],
      ['resource:list', { libraryId: 'kb-1', parentId: 'folder-w37' }, 'workspace-2'],
      ['resource:list', { libraryId: 'kb-1', parentId: 'folder-w37' }, 'workspace-9'],
      ['resource:recentFiles', 'workspace-1'],
    ];
    const { writes } = await runMove();
    const destinationWrites = writes.filter(
      ([matcher]) => matcher(byName) || matcher(listKey('folder-w37')),
    );

    expect(destinationWrites).toHaveLength(2);
    for (const [, , options] of destinationWrites) expect(options).toEqual({ revalidate: false });

    const [, updateByName] = destinationWrites.find(([matcher]) => matcher(byName))!;
    const apple = { createdAt: new Date('2026-09-20T00:00:00.000Z'), id: 'a', name: 'Apple' };
    const zebra = { createdAt: new Date('2026-09-21T00:00:00.000Z'), id: 'z', name: 'Zebra' };
    await expect(
      updateByName({ hasMore: false, items: [apple, zebra], total: 2 }),
    ).resolves.toEqual({
      hasMore: false,
      items: [apple, moved, zebra],
      total: 3,
    });

    const [, updateDefault] = destinationWrites.find(([matcher]) =>
      matcher(listKey('folder-w37')),
    )!;
    // Newest-first: both cached rows are newer, so the row goes after them.
    await expect(
      updateDefault({ hasMore: false, items: [apple, zebra], total: 2 }),
    ).resolves.toEqual({
      hasMore: false,
      items: [apple, zebra, moved],
      total: 3,
    });
  });

  it('only seeds plain destination listings; filtered variants are left to revalidate', async () => {
    const plain = listKey('folder-w37');
    const plainAll = listKey('folder-w37', { category: 'all', sourceFilter: 'all' });
    const filtered = [
      listKey('folder-w37', { q: 'weekly' }),
      listKey('folder-w37', { category: 'images' }),
      listKey('folder-w37', { sourceFilter: 'ai' }),
      listKey('folder-w37', { visibility: 'private' }),
    ];
    cachedKeys = [plain, plainAll, ...filtered];
    const { writes, reconcile } = await runMove();
    const destinationWrites = writes.filter(([matcher]) => matcher(plain) || matcher(plainAll));

    expect(destinationWrites).toHaveLength(2);
    for (const key of filtered) {
      expect(writes.some(([matcher]) => matcher(key))).toBe(false);
      // …but a mounted filtered list is still refetched.
      expect(reconcile[0](key)).toBe(true);
    }
  });

  it('keeps a library row out of a personal root that hides library files', async () => {
    const root = ['resource:list', { parentId: null, showFilesInKnowledgeBase: false }, null];
    const rootShowingLibraries = [
      'resource:list',
      { parentId: null, showFilesInKnowledgeBase: true },
      null,
    ];
    cachedKeys = [root, rootShowingLibraries];
    await applyResourceMoveToListCaches({ ...moved, knowledgeBaseId: 'kb-1' } as any, {
      fromParentKeys: ['folder-w37'],
      scope: { libraryId: undefined, workspaceId: null },
      toParentKeys: [null],
    });

    const calls = vi.mocked(mutate).mock.calls as unknown as MutateCall[];
    const writes = calls.slice(1, -1);
    expect(writes.some(([matcher]) => matcher(root))).toBe(false);
    expect(writes.some(([matcher]) => matcher(rootShowingLibraries))).toBe(true);
  });

  it('drops the moved row from every cached source list', async () => {
    const { writes } = await runMove();
    const from = writes.find(([matcher]) => matcher(listKey('folder-2026-09')))!;
    const [matcher, updater, options] = from;

    expect(options).toEqual({ revalidate: false });
    expect(matcher(listKey('folder-2026-09-id'))).toBe(true);
    expect(matcher(listKey('folder-w37'))).toBe(false);
    expect(
      matcher(['resource:list', { libraryId: 'kb-1', parentId: 'folder-2026-09' }, 'workspace-9']),
    ).toBe(false);

    const other = { id: 'doc-2', name: 'Other' };
    await expect(updater({ hasMore: true, items: [other, moved], total: 2 })).resolves.toEqual({
      hasMore: true,
      items: [other],
      total: 1,
    });
  });

  it('refetches mounted source/destination lists without holding the caller', async () => {
    // A resolved-without-awaiting mutate: the reconcile is the last call and
    // the helper must resolve before that refetch does.
    let releaseRefetch!: () => void;
    vi.mocked(mutate).mockImplementation(((_: unknown, __: unknown, options: any) =>
      options?.revalidate
        ? new Promise<void>((resolve) => {
            releaseRefetch = resolve;
          })
        : Promise.resolve()) as any);

    const settled = vi.fn();
    void applyResourceMoveToListCaches(moved as any, {
      fromParentKeys: ['folder-2026-09'],
      scope,
      toParentKeys: ['folder-w37'],
    }).then(settled);
    // Enough microtask turns for the serialising queue plus the awaited writes.
    for (let i = 0; i < 20; i++) await Promise.resolve();

    expect(settled).toHaveBeenCalled();

    const calls = vi.mocked(mutate).mock.calls as unknown as MutateCall[];
    const [matcher, updater, options] = calls.at(-1)!;
    expect(options).toEqual({ revalidate: true });
    expect(matcher(listKey('folder-w37'))).toBe(true);
    expect(matcher(listKey('folder-2026-09'))).toBe(true);
    expect(matcher(listKey(null))).toBe(false);
    const current = { hasMore: false, items: [] };
    await expect(updater(current)).resolves.toBe(current);

    releaseRefetch();
    vi.mocked(mutate).mockReset();
  });

  it('runs concurrent patches one after another so none overwrites the other', async () => {
    // Two rows moved together: the second row's patch must read the list the
    // first one wrote, so its collect/mutate calls start only after the first
    // patch finished all of its writes.
    cachedKeys = [listKey('folder-w37')];
    const order: string[] = [];
    let releaseFirstWrite: () => void = () => {};
    let armed = false;
    vi.mocked(mutate).mockImplementation((async (key: unknown, data: unknown, options: any) => {
      if (typeof key === 'function') for (const cached of cachedKeys) (key as Matcher)(cached);
      // collect: no data; write: updater + revalidate false; reconcile: revalidate true
      const kind = options?.revalidate ? 'reconcile' : data === undefined ? 'collect' : 'write';
      order.push(kind);
      if (kind === 'write' && !armed) {
        armed = true;
        await new Promise<void>((resolve) => {
          releaseFirstWrite = resolve;
        });
      }
    }) as any);

    const patch = { fromParentKeys: [null], scope, toParentKeys: ['folder-w37'] };
    const first = applyResourceMoveToListCaches(moved as any, patch);
    const second = applyResourceMoveToListCaches({ ...moved, id: 'doc-2' } as any, patch);
    try {
      for (let i = 0; i < 10; i++) await Promise.resolve();

      // First patch: keys enumerated, destination + source writes issued (the
      // destination one hangs). The second patch has not started at all.
      expect(order).toEqual(['collect', 'write', 'write']);
    } finally {
      releaseFirstWrite();
    }
    await first;
    await second;

    expect(order).toEqual([
      'collect',
      'write',
      'write',
      'reconcile',
      'collect',
      'write',
      'write',
      'reconcile',
    ]);
  });

  it('matches root lists with a null parent key', async () => {
    const { writes } = await runMove({ fromParentKeys: [null], toParentKeys: ['folder-w37'] });
    const [matcher] = writes.find(([m]) => m(listKey(null)))!;

    expect(matcher(['resource:list', { libraryId: 'kb-1' }, 'workspace-1'])).toBe(true);
    expect(matcher(listKey('folder-w37'))).toBe(false);
  });

  it('strips optimistic markers before the row lands in a cache', async () => {
    cachedKeys = [listKey('folder-w37')];
    await applyResourceMoveToListCaches(
      { ...moved, _optimistic: { isPending: true, retryCount: 0 } } as any,
      { fromParentKeys: [null], scope, toParentKeys: ['folder-w37'] },
    );

    const calls = vi.mocked(mutate).mock.calls as unknown as MutateCall[];
    const [, toUpdater] = calls.slice(1).find(([matcher]) => matcher(listKey('folder-w37')))!;
    const result = await toUpdater({ hasMore: false, items: [] });
    expect(result.items[0]).toEqual(moved);
    expect(result.total).toBeUndefined();
  });
});

describe('useFetchResources', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.activeWorkspaceId = null;
    mocks.fileState = {
      hasMore: false,
      queryParams: mocks.queryParams,
      resourceList: [],
      resourceMap: new Map(),
      total: 0,
    };
    mocks.useClientDataSWR.mockReturnValue({ data: undefined });
  });

  it('scopes the resource SWR key by active workspace', () => {
    mocks.activeWorkspaceId = 'workspace-1';

    renderHook(() => useFetchResources(mocks.queryParams));

    expect(mocks.useClientDataSWR).toHaveBeenCalledWith(
      ['resource:list', mocks.queryParams, 'workspace-1'],
      expect.any(Function),
      expect.any(Object),
    );
    expect(useActiveWorkspaceId).toHaveBeenCalled();
  });

  it('syncs query params when the returned list is unchanged', async () => {
    const resource = { id: 'resource-1', name: 'Report' };
    const nextQueryParams = {
      ...mocks.queryParams,
      category: 'documents' as FilesTabs,
    };
    mocks.fileState = {
      hasMore: false,
      queryParams: mocks.queryParams,
      resourceList: [resource],
      resourceMap: new Map([[resource.id, resource]]),
      total: 1,
    };
    mocks.useClientDataSWR.mockReturnValue({
      data: {
        hasMore: false,
        items: [resource],
        total: 1,
      },
    });

    renderHook(() => useFetchResources(nextQueryParams));

    await waitFor(() => {
      expect(mocks.fileState.queryParams).toBe(nextQueryParams);
    });
    expect(mocks.fileState.resourceList).toEqual([resource]);
  });
});
