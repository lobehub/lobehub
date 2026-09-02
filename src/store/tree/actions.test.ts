import { CUSTOM_FOLDER_FILE_TYPE } from '@lobechat/const';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { toTreeItem, TreeActionImpl } from './actions';
import type { TreeState } from './types';

const {
  mockGetKnowledgeItems,
  mockRefreshFileList,
  mockResourceMove,
  mockStoreMove,
  mockSwrMutate,
} = vi.hoisted(() => ({
  mockGetKnowledgeItems: vi.fn(),
  mockRefreshFileList: vi.fn(),
  mockResourceMove: vi.fn(),
  mockStoreMove: vi.fn(),
  mockSwrMutate: vi.fn(),
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
    moveResource: mockResourceMove,
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
