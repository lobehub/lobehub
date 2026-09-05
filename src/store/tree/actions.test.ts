import { CUSTOM_FOLDER_FILE_TYPE } from '@lobechat/const';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { toTreeItem, TreeActionImpl } from './actions';
import type { TreeState } from './types';

const {
  mockDeleteResources,
  mockGetKnowledgeItems,
  mockRefreshFileList,
  mockResourceMove,
  mockStoreMove,
  mockSwrMutate,
  mockUpdateResource,
} = vi.hoisted(() => ({
  mockDeleteResources: vi.fn(),
  mockGetKnowledgeItems: vi.fn(),
  mockRefreshFileList: vi.fn(),
  mockResourceMove: vi.fn(),
  mockStoreMove: vi.fn(),
  mockSwrMutate: vi.fn(),
  mockUpdateResource: vi.fn(),
}));

vi.mock('swr', () => ({ mutate: mockSwrMutate }));

vi.mock('@/services/file', () => ({
  fileService: {
    getKnowledgeItems: mockGetKnowledgeItems,
  },
}));

const fileStoreState = {
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
  children: {},
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
  reset: vi.fn(),
  revalidate: vi.fn(),
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
    mockRefreshFileList.mockReset();
    mockResourceMove.mockReset();
    mockStoreMove.mockReset();
    fileStoreState.resourceMap = new Map();
  });

  it('falls back to backend move when the source node is absent from tree cache', async () => {
    const state = createState();
    const actions = new TreeActionImpl(
      createSetter(() => state),
      () => state,
    );
    const revalidateSpy = vi.spyOn(actions, 'revalidate').mockResolvedValue();

    await actions.moveItem('file-1', 'folder-a', 'folder-b');
    await Promise.resolve();

    expect(mockResourceMove).toHaveBeenCalledWith('file-1', 'folder-b');
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

  it('revalidate also refreshes the hierarchy-scoped search caches', async () => {
    const state = createState();
    const actions = new TreeActionImpl(
      createSetter(() => state),
      () => state,
    );
    mockSwrMutate.mockClear();
    mockGetKnowledgeItems.mockResolvedValue({ items: [] });

    await actions.revalidate('folder-a');

    expect(mockSwrMutate).toHaveBeenCalledTimes(1);
    const [matcher, , options] = mockSwrMutate.mock.calls[0];
    expect(options).toEqual({ revalidate: true });
    // Only the sidebar search entries match — not the explorer's own search.
    expect(matcher(['resource:search', { q: 'a', scope: 'hierarchy' }, 'ws-1'])).toBe(true);
    expect(matcher(['resource:search', { q: 'a' }, 'ws-1'])).toBe(false);
    expect(matcher(['resource:list', { q: 'a', scope: 'hierarchy' }, 'ws-1'])).toBe(false);
    expect(matcher('resource:search')).toBe(false);
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
