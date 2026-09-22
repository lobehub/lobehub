import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getActiveWorkspaceId,
  useActiveWorkspaceId,
} from '@/business/client/hooks/useActiveWorkspaceId';
import { mutate } from '@/libs/swr';
import type { FilesTabs } from '@/types/files';

import { applyResourceMoveToListCaches, revalidateResources, useFetchResources } from './hooks';

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

describe('applyResourceMoveToListCaches', () => {
  type Matcher = (key: unknown) => boolean;
  type Updater = (data: any) => Promise<any>;

  const moved = { id: 'doc-1', name: 'Weekly report', parentId: 'folder-w37' };
  const listKey = (parentId: string | null, extra: Record<string, unknown> = {}) => [
    'resource:list',
    { libraryId: 'kb-1', parentId, showFilesInKnowledgeBase: false, ...extra },
    'workspace-1',
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.activeWorkspaceId = 'workspace-1';
    mocks.fileState = {
      hasMore: false,
      queryParams: {
        libraryId: 'kb-1',
        parentId: 'folder-2026-09',
        showFilesInKnowledgeBase: false,
      },
      resourceList: [],
      resourceMap: new Map(),
      total: 0,
    };
  });

  const runMove = async () => {
    await applyResourceMoveToListCaches(moved as any, {
      fromParentKeys: ['folder-2026-09', 'folder-2026-09-id'],
      toParentKeys: ['folder-w37', 'w37-slug'],
    });

    const calls = vi.mocked(mutate).mock.calls as unknown as [Matcher, Updater, unknown][];
    return {
      from: calls[1],
      reconcile: calls[2],
      to: calls[0],
    };
  };

  it('inserts the moved row into every cached destination list, scoped to workspace and library', async () => {
    const { to } = await runMove();
    const [matcher, updater, options] = to;

    expect(options).toEqual({ revalidate: false });
    expect(matcher(listKey('folder-w37'))).toBe(true);
    expect(matcher(listKey('w37-slug', { sorter: 'name' }))).toBe(true);
    expect(matcher(listKey('folder-2026-09'))).toBe(false);
    expect(matcher(listKey(null))).toBe(false);
    expect(
      matcher(['resource:list', { libraryId: 'kb-2', parentId: 'folder-w37' }, 'workspace-1']),
    ).toBe(false);
    expect(
      matcher(['resource:list', { libraryId: 'kb-1', parentId: 'folder-w37' }, 'workspace-2']),
    ).toBe(false);
    expect(matcher(['resource:recentFiles', 'workspace-1'])).toBe(false);

    const other = { id: 'doc-2', name: 'Other' };
    await expect(updater({ hasMore: false, items: [other], total: 1 })).resolves.toEqual({
      hasMore: false,
      items: [moved, other],
      total: 2,
    });
    // A destination that already lists the row (a retried move) keeps one copy.
    await expect(updater({ hasMore: false, items: [other, moved], total: 2 })).resolves.toEqual({
      hasMore: false,
      items: [moved, other],
      total: 2,
    });
    // Never seed a folder that has no cache: its first visit must fetch.
    await expect(updater(undefined)).resolves.toBeUndefined();
  });

  it('drops the moved row from every cached source list', async () => {
    const { from } = await runMove();
    const [matcher, updater, options] = from;

    expect(options).toEqual({ revalidate: false });
    expect(matcher(listKey('folder-2026-09'))).toBe(true);
    expect(matcher(listKey('folder-2026-09-id'))).toBe(true);
    expect(matcher(listKey('folder-w37'))).toBe(false);

    const other = { id: 'doc-2', name: 'Other' };
    await expect(updater({ hasMore: true, items: [other, moved], total: 2 })).resolves.toEqual({
      hasMore: true,
      items: [other],
      total: 1,
    });
    const untouched = { hasMore: false, items: [other], total: 1 };
    await expect(updater(untouched)).resolves.toBe(untouched);
  });

  it('refetches mounted source/destination lists without holding the caller', async () => {
    // A resolved-without-awaiting mutate: the reconcile is the third call and the
    // helper must resolve before that refetch does.
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
      toParentKeys: ['folder-w37'],
    }).then(settled);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(settled).toHaveBeenCalled();

    const { reconcile } = await (async () => {
      const calls = vi.mocked(mutate).mock.calls as unknown as [Matcher, Updater, unknown][];
      return { reconcile: calls[2] };
    })();
    const [matcher, updater, options] = reconcile;
    expect(options).toEqual({ revalidate: true });
    expect(matcher(listKey('folder-w37'))).toBe(true);
    expect(matcher(listKey('folder-2026-09'))).toBe(true);
    expect(matcher(listKey(null))).toBe(false);
    const current = { hasMore: false, items: [] };
    await expect(updater(current)).resolves.toBe(current);

    releaseRefetch();
    vi.mocked(mutate).mockReset();
  });

  it('matches root lists with a null parent key', async () => {
    await applyResourceMoveToListCaches(moved as any, {
      fromParentKeys: [null],
      toParentKeys: ['folder-w37'],
    });

    const [, fromCall] = vi.mocked(mutate).mock.calls as unknown as [Matcher][];
    expect(fromCall[0](listKey(null))).toBe(true);
    expect(fromCall[0](['resource:list', { libraryId: 'kb-1' }, 'workspace-1'])).toBe(true);
    expect(fromCall[0](listKey('folder-w37'))).toBe(false);
  });

  it('strips optimistic markers before the row lands in a cache', async () => {
    await applyResourceMoveToListCaches(
      { ...moved, _optimistic: { isPending: true, retryCount: 0 } } as any,
      { fromParentKeys: [null], toParentKeys: ['folder-w37'] },
    );

    const [[, toUpdater]] = vi.mocked(mutate).mock.calls as unknown as [unknown, Updater][];
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
