import { CUSTOM_FOLDER_FILE_TYPE } from '@lobechat/const';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { hierarchySearchResource } from '@/features/ResourceManager/store/projection';
import type * as ReplicaModule from '@/libs/replica';
import { createReplicaState } from '@/libs/replica';
import { SortType } from '@/types/files';

import {
  isExpandable,
  sortTreeItems,
  toTreeItem,
  toTreeItemFromResource,
  TreeActionImpl,
} from './actions';
import type { TreeState } from './types';

const {
  mockApplyMovedResourceToCaches,
  mockCollapseHierarchySearch,
  mockDeleteResources,
  mockGetKnowledgeItems,
  mockPatchSearchHit,
  mockRefreshFileList,
  mockResourceMove,
  mockRevalidateReplica,
  mockSetSort,
  mockReorder,
  mockStoreMove,
  mockUpdateResource,
} = vi.hoisted(() => ({
  mockApplyMovedResourceToCaches: vi.fn(),
  mockCollapseHierarchySearch: vi.fn(),
  mockDeleteResources: vi.fn(),
  mockGetKnowledgeItems: vi.fn(),
  mockPatchSearchHit: vi.fn(),
  mockRefreshFileList: vi.fn(),
  mockResourceMove: vi.fn(),
  mockRevalidateReplica: vi.fn(),
  mockSetSort: vi.fn(),
  mockReorder: vi.fn(),
  mockStoreMove: vi.fn(),
  mockUpdateResource: vi.fn(),
}));

vi.mock('@/libs/replica', async () => ({
  ...(await vi.importActual<typeof ReplicaModule>('@/libs/replica')),
  revalidateReplica: mockRevalidateReplica,
}));

vi.mock('@/features/ResourceManager/store', () => ({
  useResourceManagerStore: {
    getState: () => ({
      setSort: mockSetSort,
      collapseHierarchySearch: mockCollapseHierarchySearch,
      patchSearchHit: mockPatchSearchHit,
    }),
  },
}));

vi.mock('@/services/knowledgeBase', () => ({
  knowledgeBaseService: { reorderKnowledgeItems: mockReorder },
}));

vi.mock('@/services/file', () => ({
  fileService: {
    getKnowledgeItems: mockGetKnowledgeItems,
  },
}));

const moveCachePatch = {
  fromParentKeys: ['folder-a'],
  scope: { libraryId: 'kb-1', workspaceId: 'workspace-1' },
  toParentKeys: ['folder-b'],
};

const fileStoreState = {
  queryParams: { libraryId: 'kb-1', parentId: null as string | null },
  resourceList: [],
  reorderCurrentResources: vi.fn(() => ({ commit: vi.fn(), rollback: vi.fn() })),
  applyMovedResourceToCaches: mockApplyMovedResourceToCaches,
  prepareResourceMoveCachePatch: vi.fn(async () => moveCachePatch),
  moveResource: mockStoreMove,
  refreshFileList: mockRefreshFileList,
  resourceMap: new Map<string, unknown>(),
};

vi.mock('@/services/resource', () => ({
  resourceService: {
    deleteResources: mockDeleteResources,
    moveResource: mockResourceMove,
    updateResource: mockUpdateResource,
  },
}));

vi.mock('@/store/file', () => ({
  useFileStore: {
    getState: () => fileStoreState,
  },
}));

const createState = (): TreeState => ({
  sorter: 'custom',
  sortType: SortType.Asc,
  setTreeSort: vi.fn(),
  reorderItems: vi.fn(),
  revalidateLoaded: vi.fn(),
  children: {},
  dropNodes: vi.fn(),
  epoch: 0,
  errors: {},
  expanded: {},
  init: vi.fn(),
  knowledgeBaseId: 'kb-1',
  loadChildren: vi.fn(),
  moveItem: vi.fn(),
  moveItems: vi.fn(),
  expandAncestors: vi.fn(),
  reconcile: vi.fn(),
  removeItems: vi.fn(),
  renameItem: vi.fn(),
  forgetLibrary: vi.fn(),
  forgetSnapshot: vi.fn(),
  reset: vi.fn(),
  preHydrate: vi.fn(),
  revalidate: vi.fn(),
  snapshotMap: {},
  snapshotReplica: createReplicaState(),
  status: {},
  toggle: vi.fn(),
});

const createSetter = (getState: () => TreeState) => {
  return (
    partial:
      Partial<TreeState> | TreeState | ((state: TreeState) => Partial<TreeState> | TreeState),
  ) => {
    const next = typeof partial === 'function' ? partial(getState()) : partial;
    Object.assign(getState(), next);
  };
};

describe('TreeActionImpl.moveItem', () => {
  beforeEach(() => {
    mockApplyMovedResourceToCaches.mockReset();
    mockRefreshFileList.mockReset();
    mockResourceMove.mockReset();
    mockStoreMove.mockReset();
    fileStoreState.prepareResourceMoveCachePatch.mockClear();
    fileStoreState.resourceMap = new Map();
  });

  it('falls back to backend move when the source node is absent from tree cache', async () => {
    const state = createState();
    const actions = new TreeActionImpl(
      createSetter(() => state),
      () => state,
    );
    const revalidateSpy = vi.spyOn(actions, 'revalidate').mockResolvedValue();

    const moved = { id: 'file-1', parentId: 'folder-b' };
    mockResourceMove.mockResolvedValue(moved);

    await actions.moveItem('file-1', 'folder-a', 'folder-b');
    await Promise.resolve();

    expect(mockResourceMove).toHaveBeenCalledWith('file-1', 'folder-b');
    // The explorer never saw the row, so its folder-list caches are patched
    // from the server result before the current list refreshes, with the
    // folder keys and scope prepared before the request went out.
    expect(fileStoreState.prepareResourceMoveCachePatch).toHaveBeenCalledWith(
      'folder-a',
      'folder-b',
    );
    expect(mockApplyMovedResourceToCaches).toHaveBeenCalledWith(moved, moveCachePatch);
    expect(fileStoreState.prepareResourceMoveCachePatch.mock.invocationCallOrder[0]).toBeLessThan(
      mockResourceMove.mock.invocationCallOrder[0],
    );
    expect(mockRefreshFileList).toHaveBeenCalledTimes(1);
    expect(mockStoreMove).not.toHaveBeenCalled();
    expect(revalidateSpy).toHaveBeenCalledWith('folder-a');
    expect(revalidateSpy).toHaveBeenCalledWith('folder-b');
  });

  it('delegates to the file store when explorer state already has the item', async () => {
    const state = createState();
    const actions = new TreeActionImpl(
      createSetter(() => state),
      () => state,
    );

    fileStoreState.resourceMap = new Map([['file-1', { id: 'file-1' }]]);

    await actions.moveItem('file-1', 'folder-a', 'folder-b');
    await Promise.resolve();

    expect(mockStoreMove).toHaveBeenCalledWith('file-1', 'folder-b');
    expect(mockResourceMove).not.toHaveBeenCalled();
    expect(mockApplyMovedResourceToCaches).not.toHaveBeenCalled();
    expect(mockRefreshFileList).not.toHaveBeenCalled();
  });
});

describe('TreeActionImpl folder key resolution', () => {
  // The sidebar walks `children` by folder id, while the explorer's query
  // params carry the folder slug from the URL (`/library/<kb>/<slug>`).
  const folder = toTreeItem({
    fileType: CUSTOM_FOLDER_FILE_TYPE,
    id: 'docs_folder',
    name: '2026.08',
    slug: 'f13650aa',
  });
  const doc = toTreeItem({
    fileType: 'custom/document',
    id: 'docs_new',
    name: 'Untitled',
    slug: 'noted-green-in',
  });

  const createLoadedState = (): TreeState => {
    const state = createState();
    state.children = { '': [folder] };
    return state;
  };

  beforeEach(() => {
    mockGetKnowledgeItems.mockReset();
  });

  it('reconcile writes children under the folder id when addressed by slug', () => {
    const state = createLoadedState();
    const actions = new TreeActionImpl(
      createSetter(() => state),
      () => state,
    );

    actions.reconcile('f13650aa', [doc]);

    expect(state.children['docs_folder']).toEqual([doc]);
    expect(state.children['f13650aa']).toBeUndefined();
  });

  it('reconcile resolves the slug to the loaded folder even after a stale slug entry exists', () => {
    const state = createLoadedState();
    // The explorer's first list for a deep-linked folder arrives before the
    // ancestors are loaded and lands under the slug.
    state.children['f13650aa'] = [doc];
    const actions = new TreeActionImpl(
      createSetter(() => state),
      () => state,
    );

    const created = toTreeItem({ fileType: 'custom/document', id: 'docs_created', name: 'New' });
    actions.reconcile('f13650aa', [doc, created]);

    expect(state.children['docs_folder']?.map((item) => item.id)).toEqual([
      'docs_created',
      'docs_new',
    ]);
    // The stale slug entry is left alone; the sidebar never walks it.
    expect(state.children['f13650aa']?.map((item) => item.id)).toEqual(['docs_new']);
  });

  it('reconcile drops rows whose parentId points at another folder', () => {
    const state = createLoadedState();
    const actions = new TreeActionImpl(
      createSetter(() => state),
      () => state,
    );
    const own = toTreeItem({
      fileType: 'custom/document',
      id: 'docs_own',
      name: 'Own',
      parentId: 'docs_folder',
    });
    const phantom = toTreeItem({
      fileType: 'custom/document',
      id: 'docs_elsewhere',
      name: 'Created for another folder',
      parentId: 'docs_other',
    });

    actions.reconcile('f13650aa', [doc, own, phantom]);
    expect(state.children['docs_folder']?.map((item) => item.id)).toEqual(['docs_own', 'docs_new']);

    const rootPhantom = toTreeItem({
      fileType: 'custom/document',
      id: 'docs_nested',
      name: 'Nested',
      parentId: 'docs_folder',
    });
    actions.reconcile('', [folder, doc, rootPhantom]);
    expect(state.children['']?.map((item) => item.id)).toEqual(['docs_folder', 'docs_new']);
  });

  it('reconcile keeps the root key and unknown keys untouched', () => {
    const state = createLoadedState();
    const actions = new TreeActionImpl(
      createSetter(() => state),
      () => state,
    );

    actions.reconcile('', [folder]);
    actions.reconcile('docs_unloaded', [doc]);

    expect(state.children['']).toEqual([folder]);
    expect(state.children['docs_unloaded']).toEqual([doc]);
  });

  it('revalidate drops the sidebar search depth and refreshes the replica', async () => {
    const state = createState();
    const actions = new TreeActionImpl(
      createSetter(() => state),
      () => state,
    );
    mockCollapseHierarchySearch.mockClear();
    mockRevalidateReplica.mockClear();
    mockGetKnowledgeItems.mockResolvedValue({ items: [] });

    await actions.revalidate('folder-a');

    // The sidebar's flat search list is a replica now; a rename/move/delete in
    // the tree must drop the loaded search depth (so a stale tail row cannot
    // survive) and revalidate it (so the head is fresh).
    await vi.waitFor(() => {
      expect(mockCollapseHierarchySearch).toHaveBeenCalled();
      expect(mockRevalidateReplica).toHaveBeenCalledWith(hierarchySearchResource);
    });
  });

  it('a revalidate requested during an in-flight root load runs once that load settles', async () => {
    const state = createState();
    const actions = new TreeActionImpl(
      createSetter(() => state),
      () => state,
    );
    // The initial root fetch captured its snapshot before the sidebar "+"
    // created a row; the refresh must not be dropped on the floor.
    let resolveInitial!: (value: { items: unknown[] }) => void;
    const initial = new Promise<{ items: unknown[] }>((resolve) => {
      resolveInitial = resolve;
    });
    const created = { fileType: 'custom/document', id: 'docs_created', name: 'New', slug: null };
    mockGetKnowledgeItems.mockReturnValueOnce(initial).mockResolvedValue({ items: [created] });

    const load = actions.loadChildren('');
    expect(state.status['']).toBe('loading');

    await actions.revalidate('');
    await actions.revalidate('');
    expect(mockGetKnowledgeItems).toHaveBeenCalledTimes(1);

    resolveInitial({ items: [] });
    await load;
    await vi.waitFor(() => {
      expect(state.children['']?.map((item) => item.id)).toEqual(['docs_created']);
    });
    // Both queued requests collapsed into a single follow-up fetch.
    expect(mockGetKnowledgeItems).toHaveBeenCalledTimes(2);
    expect(state.status['']).toBe('idle');
  });

  it('a revalidate requested during an in-flight revalidate follows it instead of racing it', async () => {
    const state = createState();
    const actions = new TreeActionImpl(
      createSetter(() => state),
      () => state,
    );
    let resolveFirst!: (value: { items: unknown[] }) => void;
    const first = new Promise<{ items: unknown[] }>((resolve) => {
      resolveFirst = resolve;
    });
    const fresh = { fileType: 'custom/document', id: 'docs_fresh', name: 'Fresh', slug: null };
    mockGetKnowledgeItems.mockReturnValueOnce(first).mockResolvedValue({ items: [fresh] });

    const running = actions.revalidate('folder-a');
    expect(state.status['folder-a']).toBe('revalidating');
    await actions.revalidate('folder-a');
    expect(mockGetKnowledgeItems).toHaveBeenCalledTimes(1);

    resolveFirst({ items: [] });
    await running;
    await vi.waitFor(() => {
      expect(state.children['folder-a']?.map((item) => item.id)).toEqual(['docs_fresh']);
    });
    expect(mockGetKnowledgeItems).toHaveBeenCalledTimes(2);
  });

  it('revalidate stores the refetched children under the folder id when addressed by slug', async () => {
    const state = createLoadedState();
    const actions = new TreeActionImpl(
      createSetter(() => state),
      () => state,
    );
    mockGetKnowledgeItems.mockResolvedValue({
      items: [{ fileType: 'custom/document', id: 'docs_new', name: 'Untitled', slug: null }],
    });

    await actions.revalidate('f13650aa');

    expect(state.children['docs_folder']?.map((item) => item.id)).toEqual(['docs_new']);
    expect(state.children['f13650aa']).toBeUndefined();
    expect(state.status['docs_folder']).toBe('idle');
  });
});

describe('TreeActionImpl optimistic moves', () => {
  const folder = toTreeItem({ fileType: CUSTOM_FOLDER_FILE_TYPE, id: 'folder-test', name: 'test' });
  const docA = toTreeItem({ fileType: 'custom/document', id: 'doc-a', name: 'A' });
  const docB = toTreeItem({ fileType: 'custom/document', id: 'doc-b', name: 'B' });

  // A move that never settles is the bug: the drop handler's promise hangs, the
  // sidebar never revalidates, and every later mutation on the same folders
  // queues behind the stuck one.
  const withTimeout = <T>(promise: Promise<T>, ms = 200) =>
    Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`did not settle within ${ms}ms`)), ms);
      }),
    ]);

  const createTree = () => {
    const state = createState();
    state.children = { '': [folder, docA, docB], 'folder-test': [] };
    const actions = new TreeActionImpl(
      createSetter(() => state),
      () => state,
    );
    return { actions, state };
  };

  beforeEach(() => {
    mockRefreshFileList.mockReset();
    mockResourceMove.mockReset();
    mockStoreMove.mockReset();
    fileStoreState.resourceMap = new Map();
    mockResourceMove.mockResolvedValue({});
    mockRefreshFileList.mockResolvedValue(undefined);
  });

  it('moveItem settles, persists, and revalidates both parents when the node is cached', async () => {
    const { actions, state } = createTree();
    const revalidateSpy = vi.spyOn(actions, 'revalidate').mockResolvedValue();

    await withTimeout(actions.moveItem('doc-a', '', 'folder-test'));

    expect(mockResourceMove).toHaveBeenCalledWith('doc-a', 'folder-test');
    expect(state.children['']?.map((i) => i.id)).toEqual(['folder-test', 'doc-b']);
    expect(state.children['folder-test']?.map((i) => i.id)).toEqual(['doc-a']);
    expect(revalidateSpy).toHaveBeenCalledWith('');
    expect(revalidateSpy).toHaveBeenCalledWith('folder-test');
  });

  it('a second move touching the same folders still reaches the backend', async () => {
    const { actions, state } = createTree();
    vi.spyOn(actions, 'revalidate').mockResolvedValue();

    await withTimeout(actions.moveItem('doc-a', '', 'folder-test'));
    await withTimeout(actions.moveItem('doc-b', '', 'folder-test'));

    expect(mockResourceMove).toHaveBeenCalledTimes(2);
    expect(mockResourceMove).toHaveBeenLastCalledWith('doc-b', 'folder-test');
    expect(state.children['']?.map((i) => i.id)).toEqual(['folder-test']);
    expect(state.children['folder-test']?.map((i) => i.id)).toEqual(['doc-a', 'doc-b']);
  });

  it('moveItems settles and persists every cached node', async () => {
    const { actions, state } = createTree();
    const revalidateSpy = vi.spyOn(actions, 'revalidate').mockResolvedValue();

    await withTimeout(actions.moveItems(['doc-a', 'doc-b'], '', 'folder-test'));

    expect(mockResourceMove).toHaveBeenCalledTimes(2);
    expect(state.children['']?.map((i) => i.id)).toEqual(['folder-test']);
    expect(state.children['folder-test']?.map((i) => i.id)).toEqual(['doc-a', 'doc-b']);
    expect(revalidateSpy).toHaveBeenCalledWith('');
    expect(revalidateSpy).toHaveBeenCalledWith('folder-test');
  });

  it('a failed move rolls the node back and rejects', async () => {
    const { actions, state } = createTree();
    vi.spyOn(actions, 'revalidate').mockResolvedValue();
    mockResourceMove.mockRejectedValue(new Error('boom'));

    await expect(withTimeout(actions.moveItem('doc-a', '', 'folder-test'))).rejects.toThrow('boom');

    expect(state.children['']?.map((i) => i.id)).toEqual(['folder-test', 'doc-a', 'doc-b']);
    expect(state.children['folder-test']).toEqual([]);
  });
});

describe('TreeActionImpl optimistic moves (destination and other mutations)', () => {
  const folder = toTreeItem({ fileType: CUSTOM_FOLDER_FILE_TYPE, id: 'folder-test', name: 'test' });
  const docA = toTreeItem({ fileType: 'custom/document', id: 'doc-a', name: 'A' });

  const withTimeout = <T>(promise: Promise<T>, ms = 200) =>
    Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`did not settle within ${ms}ms`)), ms);
      }),
    ]);

  beforeEach(() => {
    mockRefreshFileList.mockReset();
    mockResourceMove.mockReset();
    mockStoreMove.mockReset();
    // Reset explicitly rather than relying on the runner's `clearMocks`: the
    // rename tests assert both a patch call and the absence of one.
    mockPatchSearchHit.mockReset();
    mockUpdateResource.mockReset();
    fileStoreState.resourceMap = new Map();
    mockResourceMove.mockResolvedValue({});
    mockRefreshFileList.mockResolvedValue(undefined);
  });

  it('leaves an unloaded destination untouched so its first expand still fetches', async () => {
    const state = createState();
    state.children = { '': [folder, docA] };
    const actions = new TreeActionImpl(
      createSetter(() => state),
      () => state,
    );
    const revalidateSpy = vi.spyOn(actions, 'revalidate').mockResolvedValue();

    await withTimeout(actions.moveItem('doc-a', '', 'folder-test'));

    expect(state.children['']?.map((i) => i.id)).toEqual(['folder-test']);
    expect(state.children['folder-test']).toBeUndefined();
    expect(revalidateSpy).toHaveBeenCalledWith('folder-test');
  });

  it('does not duplicate a row the destination already lists', async () => {
    const state = createState();
    state.children = { '': [folder, docA], 'folder-test': [docA] };
    const actions = new TreeActionImpl(
      createSetter(() => state),
      () => state,
    );
    vi.spyOn(actions, 'revalidate').mockResolvedValue();

    await withTimeout(actions.moveItem('doc-a', '', 'folder-test'));

    expect(state.children['folder-test']?.map((i) => i.id)).toEqual(['doc-a']);
  });

  it('renameItem settles and revalidates the parent', async () => {
    const state = createState();
    state.children = { '': [folder, docA] };
    const actions = new TreeActionImpl(
      createSetter(() => state),
      () => state,
    );
    const revalidateSpy = vi.spyOn(actions, 'revalidate').mockResolvedValue();
    mockUpdateResource.mockResolvedValue({});

    await withTimeout(actions.renameItem('doc-a', '', 'Renamed'));

    expect(mockUpdateResource).toHaveBeenCalledWith('doc-a', { name: 'Renamed' });
    expect(state.children['']?.find((i) => i.id === 'doc-a')?.name).toBe('Renamed');
    expect(revalidateSpy).toHaveBeenCalledWith('');
    // Regression: the search surfaces keep their own persisted hits, so a
    // sidebar rename has to reach them or they repaint the old name.
    expect(mockPatchSearchHit).toHaveBeenCalledWith('doc-a', { name: 'Renamed' });
  });

  it('renameItem leaves the cached searches alone when the rename fails', async () => {
    const state = createState();
    state.children = { '': [folder, docA] };
    const actions = new TreeActionImpl(
      createSetter(() => state),
      () => state,
    );
    vi.spyOn(actions, 'revalidate').mockResolvedValue();
    mockUpdateResource.mockRejectedValue(new Error('boom'));

    await withTimeout(actions.renameItem('doc-a', '', 'Renamed')).catch(() => undefined);

    expect(mockPatchSearchHit).not.toHaveBeenCalled();
  });

  it('removeItems settles, drops the folder caches, and revalidates the parent', async () => {
    const state = createState();
    state.children = { '': [folder, docA], 'folder-test': [] };
    state.expanded = { 'folder-test': true };
    const actions = new TreeActionImpl(
      createSetter(() => state),
      () => state,
    );
    const revalidateSpy = vi.spyOn(actions, 'revalidate').mockResolvedValue();
    mockDeleteResources.mockResolvedValue(undefined);

    await withTimeout(actions.removeItems(['folder-test'], ''));

    expect(mockDeleteResources).toHaveBeenCalledWith(['folder-test']);
    expect(state.children['']?.map((i) => i.id)).toEqual(['doc-a']);
    expect(state.children['folder-test']).toBeUndefined();
    expect(state.expanded['folder-test']).toBeUndefined();
    expect(revalidateSpy).toHaveBeenCalledWith('');
  });
});

describe('TreeActionImpl.dropNodes', () => {
  const folderA = toTreeItem({
    fileType: CUSTOM_FOLDER_FILE_TYPE,
    id: 'folder-a',
    name: 'A',
    slug: 'folder-a-slug',
  });
  const folderChild = toTreeItem({
    fileType: CUSTOM_FOLDER_FILE_TYPE,
    id: 'folder-child',
    name: 'Child',
  });
  const docA = toTreeItem({ fileType: 'custom/document', id: 'doc-a', name: 'A' });

  const setup = (state: TreeState) => {
    const actions = new TreeActionImpl(
      createSetter(() => state),
      () => state,
    );
    const revalidateSpy = vi.spyOn(actions, 'revalidate').mockResolvedValue();
    return { actions, revalidateSpy };
  };

  it('refreshes the folder that held the row, not the explorer fallback', async () => {
    // Regression: deleting a folder from the sidebar right after opening it
    // left `queryParams.parentId` pointing at the folder being deleted, so the
    // parent list the sidebar renders was never refetched and the row stayed.
    const state = createState();
    state.children = { '': [folderA, docA], 'folder-a': [] };
    const { actions, revalidateSpy } = setup(state);

    await actions.dropNodes(['folder-a'], 'folder-a-slug');

    expect(state.children['']?.map((i) => i.id)).toEqual(['doc-a']);
    expect(revalidateSpy).toHaveBeenCalledWith('');
    expect(revalidateSpy).not.toHaveBeenCalledWith('folder-a-slug');
  });

  it('forgets the removed folder subtree, descendants included', async () => {
    const state = createState();
    state.children = {
      '': [folderA],
      'folder-a': [folderChild],
      'folder-child': [docA],
    };
    state.expanded = { 'folder-a': true, 'folder-child': true };
    state.status = { 'folder-a': 'idle', 'folder-child': 'idle' };
    state.errors = { 'folder-a': new Error('stale') };
    const { actions } = setup(state);

    await actions.dropNodes(['folder-a']);

    expect(state.children['folder-a']).toBeUndefined();
    expect(state.children['folder-child']).toBeUndefined();
    expect(state.expanded['folder-a']).toBeUndefined();
    expect(state.expanded['folder-child']).toBeUndefined();
    expect(state.status['folder-a']).toBeUndefined();
    expect(state.errors['folder-a']).toBeUndefined();
  });

  it('falls back to the given parent key when the tree never loaded the row', async () => {
    const state = createState();
    state.children = { '': [docA] };
    const { actions, revalidateSpy } = setup(state);

    await actions.dropNodes(['file-not-in-tree'], 'folder-a');

    expect(revalidateSpy).toHaveBeenCalledWith('folder-a');
    expect(revalidateSpy).toHaveBeenCalledTimes(1);
  });

  it('refreshes every folder that held one of the rows', async () => {
    const state = createState();
    state.children = { '': [folderA], 'folder-a': [docA, folderChild] };
    const { actions, revalidateSpy } = setup(state);

    await actions.dropNodes(['folder-child', 'doc-a'], 'ignored');

    expect(revalidateSpy).toHaveBeenCalledWith('folder-a');
    expect(revalidateSpy).toHaveBeenCalledTimes(1);
    expect(revalidateSpy).not.toHaveBeenCalledWith('ignored');
  });

  it('skips a parent that is itself being removed', async () => {
    const state = createState();
    state.children = { '': [folderA], 'folder-a': [docA] };
    const { actions, revalidateSpy } = setup(state);

    await actions.dropNodes(['folder-a', 'doc-a'], 'fallback');

    expect(revalidateSpy).toHaveBeenCalledWith('');
    expect(revalidateSpy).toHaveBeenCalledTimes(1);
  });

  it('does nothing for an empty id list', async () => {
    const state = createState();
    state.children = { '': [folderA] };
    const { actions, revalidateSpy } = setup(state);

    await actions.dropNodes([], 'folder-a');

    expect(state.children['']?.map((i) => i.id)).toEqual(['folder-a']);
    expect(revalidateSpy).not.toHaveBeenCalled();
  });
});

describe('sortTreeItems', () => {
  const doc = (id: string, name: string, createdAt?: string) =>
    toTreeItem({ createdAt, fileType: 'custom/document', id, name });

  it('puts a just-created page first instead of dropping it into the A-Z list', () => {
    // Creating a page inside a folder full of "<name> 周报 — 2026-Wxx"
    // rows landed the new "Untitled" between "TC" and "xiaojie".
    const rows = [
      doc('report-tc', 'TC 周报 — 2026-W35', '2026-08-28T02:00:00.000Z'),
      doc('untitled', 'Untitled', '2026-09-04T15:31:00.000Z'),
      doc('report-xiaojie', 'xiaojie 周报 — 2026-W35', '2026-08-29T02:00:00.000Z'),
    ];

    expect(sortTreeItems(rows, 'createdAt', SortType.Desc).map((item) => item.id)).toEqual([
      'untitled',
      'report-xiaojie',
      'report-tc',
    ]);
  });

  it('keeps folders ahead of documents no matter how new the document is', () => {
    const folderRow = toTreeItem({
      createdAt: '2026-01-01T00:00:00.000Z',
      fileType: CUSTOM_FOLDER_FILE_TYPE,
      id: 'folder-old',
      name: '2026.08',
    });
    const newest = doc('doc-new', 'Untitled', '2026-09-04T15:31:00.000Z');

    expect(sortTreeItems([newest, folderRow]).map((item) => item.id)).toEqual([
      'folder-old',
      'doc-new',
    ]);
  });

  it('sends rows without a timestamp to the tail of their group in A-Z order', () => {
    const rows = [
      doc('stub-b', 'B stub'),
      doc('dated', 'Dated', '2026-08-01T00:00:00.000Z'),
      doc('stub-a', 'A stub'),
    ];

    expect(sortTreeItems(rows, 'createdAt', SortType.Desc).map((item) => item.id)).toEqual([
      'dated',
      'stub-b',
      'stub-a',
    ]);
  });

  it('breaks a createdAt tie by name', () => {
    const rows = [
      doc('b', 'Beta', '2026-08-01T00:00:00.000Z'),
      doc('a', 'Alpha', '2026-08-01T00:00:00.000Z'),
    ];

    expect(sortTreeItems(rows, 'createdAt', SortType.Asc).map((item) => item.id)).toEqual([
      'a',
      'b',
    ]);
  });
});

describe('toTreeItemFromResource', () => {
  const row = {
    createdAt: new Date('2026-01-01T00:00:00Z'),
    fileId: 'file-1',
    fileType: 'custom/document',
    id: 'docs_1',
    metadata: { emoji: '📄' },
    name: 'Private note',
    parentId: null,
    size: 12,
    slug: 'private-note',
    sourceType: 'document',
    url: '',
    userId: 'user-1',
    visibility: 'private' as const,
  };

  it('carries the fields the sidebar and the row menu read', () => {
    // Regression: the explorer → tree reconcile rebuilt rows from a hand-written
    // literal that omitted these two, so every list refresh stripped the private
    // marker off the sidebar and mis-gated publish / make-private.
    expect(toTreeItemFromResource(row)).toMatchObject({
      userId: 'user-1',
      visibility: 'private',
    });
  });

  it('keeps a workspace-shared row shared', () => {
    expect(toTreeItemFromResource({ ...row, visibility: 'public' }).visibility).toBe('public');
  });

  it('produces the same row as the tree fetch does for the same input', () => {
    expect(toTreeItemFromResource(row)).toEqual(toTreeItem(row));
  });

  it('keeps a document with children expandable', () => {
    // Dropping `hasChildren` here would take the caret off a parent page on
    // every explorer refresh.
    const parent = toTreeItemFromResource({ ...row, hasChildren: true });

    expect(parent).toMatchObject({ hasChildren: true, isFolder: false });
    expect(isExpandable(parent)).toBe(true);
  });
});

describe('toTreeItem hasChildren', () => {
  const doc = { fileType: 'custom/document', id: 'docs_1', name: 'Page' };

  it('carries hasChildren from the server row', () => {
    expect(toTreeItem({ ...doc, hasChildren: true }).hasChildren).toBe(true);
    expect(toTreeItem({ ...doc, hasChildren: false }).hasChildren).toBe(false);
  });

  it('treats folders and documents with children as expandable, leaves as not', () => {
    expect(isExpandable(toTreeItem({ ...doc, hasChildren: true }))).toBe(true);
    expect(isExpandable(toTreeItem(doc))).toBe(false);
    expect(isExpandable(toTreeItem({ ...doc, fileType: CUSTOM_FOLDER_FILE_TYPE }))).toBe(true);
  });
});

describe('TreeActionImpl sorting and reorder', () => {
  const row = (id: string, isFolder = false) =>
    toTreeItem({
      id,
      name: id,
      fileType: isFolder ? CUSTOM_FOLDER_FILE_TYPE : 'text/plain',
    });

  beforeEach(() => {
    mockReorder.mockReset();
    mockSetSort.mockClear();
    mockRefreshFileList.mockResolvedValue(undefined);
    mockGetKnowledgeItems.mockResolvedValue({ items: [] });
    fileStoreState.queryParams = { libraryId: 'kb-1', parentId: null };
    fileStoreState.reorderCurrentResources.mockClear();
  });

  it('uses natural numbered names by default and keeps folders first in every mode', () => {
    const rows = ['10_知识', '02_知识', '09_知识', '01_知识'].map((id) => row(id));
    expect(sortTreeItems(rows).map((item) => item.id)).toEqual([
      '01_知识',
      '02_知识',
      '09_知识',
      '10_知识',
    ]);
    expect(sortTreeItems([row('第10章'), row('第2章')]).map((item) => item.id)).toEqual([
      '第2章',
      '第10章',
    ]);
    expect(sortTreeItems([row('10'), row('2')]).map((item) => item.id)).toEqual(['2', '10']);
    for (const sorter of ['custom', 'name', 'size', 'createdAt'] as const) {
      for (const direction of [SortType.Asc, SortType.Desc]) {
        expect(sortTreeItems([row('a'), row('z', true)], sorter, direction)[0].id).toBe('z');
      }
    }
  });

  it('re-sorts loaded levels and sends the active order on folder expansion', async () => {
    const state = createState();
    state.children = { '': [row('a'), row('z')], 'level2': [row('a'), row('z')] };
    const actions = new TreeActionImpl(
      createSetter(() => state),
      () => state,
    );
    mockGetKnowledgeItems.mockImplementation(() => new Promise(() => {}));
    actions.setTreeSort('name', SortType.Desc);
    expect(state.children.level2.map((item) => item.id)).toEqual(['z', 'a']);
    void actions.loadChildren('level3');
    expect(mockGetKnowledgeItems).toHaveBeenLastCalledWith(
      expect.objectContaining({
        parentId: 'level3',
        sorter: 'name',
        sortType: SortType.Desc,
      }),
    );
  });

  it.each([false, true])(
    'optimistically reorders both surfaces and rolls back on error=%s',
    async (fails) => {
      const state = createState();
      state.sorter = 'name';
      state.sortType = SortType.Desc;
      state.children = { '': [row('folder', true), row('a'), row('b')] };
      const actions = new TreeActionImpl(
        createSetter(() => state),
        () => state,
      );
      let resolve!: () => void;
      let reject!: (error: Error) => void;
      mockReorder.mockRejectedValue(new Error('reorder failed'));
      mockReorder.mockImplementationOnce(
        () =>
          new Promise<void>((yes, no) => {
            resolve = yes;
            reject = no;
          }),
      );
      const refresh = vi.spyOn(actions, 'revalidate').mockResolvedValue();
      const pending = actions.reorderItems('', ['b'], 'a', 'before');
      const caught = pending.catch((error) => error);
      await vi.waitFor(() => expect(mockReorder).toHaveBeenCalled());
      expect(state.children[''].map((item) => item.id)).toEqual(['folder', 'b', 'a']);
      expect(state.children[''].map((item) => item.metadata?.sortOrder)).toEqual([
        1000, 2000, 3000,
      ]);
      expect(mockSetSort).toHaveBeenCalledWith('custom', SortType.Asc);
      expect(mockReorder).toHaveBeenCalledWith({
        knowledgeBaseId: 'kb-1',
        parentId: null,
        dragIds: ['b'],
        targetId: 'a',
        position: 'before',
        sorter: 'name',
        sortType: SortType.Desc,
      });
      const overlay = fileStoreState.reorderCurrentResources.mock.results.at(-1)!.value;
      if (fails) {
        reject(new Error('reorder failed'));
        expect(await caught).toEqual(new Error('reorder failed'));
        expect(state.children[''].map((item) => item.id)).toEqual(['folder', 'a', 'b']);
        expect(state.children[''].every((item) => !item.metadata?.sortOrder)).toBe(true);
        expect(overlay.rollback).toHaveBeenCalled();
      } else {
        resolve();
        await pending;
        expect(overlay.commit).toHaveBeenCalled();
        expect(refresh).toHaveBeenCalledWith('');
      }
    },
  );

  it('sends only moved IDs when more than 1000 siblings are loaded', async () => {
    const state = createState();
    state.children = { '': Array.from({ length: 1005 }, (_, i) => row(`item-${i}`)) };
    const actions = new TreeActionImpl(
      createSetter(() => state),
      () => state,
    );
    vi.spyOn(actions, 'revalidate').mockResolvedValue();
    mockReorder.mockResolvedValue({ success: true });
    await actions.reorderItems('', ['item-1004'], 'item-0', 'before');
    expect(mockReorder).toHaveBeenCalledWith(
      expect.objectContaining({
        dragIds: ['item-1004'],
        targetId: 'item-0',
        position: 'before',
      }),
    );
    expect(mockReorder.mock.calls[0][0]).not.toHaveProperty('orderedIds');
    expect(state.children[''].map((item) => item.id)).toEqual([
      'item-1004',
      ...Array.from({ length: 1004 }, (_, i) => `item-${i}`),
    ]);
  });

  it('allows only the two cross-group boundary drops', async () => {
    const state = createState();
    const original = [row('f1', true), row('f2', true), row('a'), row('b')];
    state.children = { '': original };
    const actions = new TreeActionImpl(
      createSetter(() => state),
      () => state,
    );
    vi.spyOn(actions, 'revalidate').mockResolvedValue();
    mockReorder.mockResolvedValue({ success: true });
    await actions.reorderItems('', ['b'], 'f1', 'before');
    expect(mockReorder).not.toHaveBeenCalled();
    await actions.reorderItems('', ['b'], 'f2', 'after');
    expect(state.children[''].map((item) => item.id)).toEqual(['f1', 'f2', 'b', 'a']);
    state.children = { '': original };
    await actions.reorderItems('', ['f1'], 'a', 'before');
    expect(state.children[''].map((item) => item.id)).toEqual(['f2', 'f1', 'a', 'b']);
  });
});
