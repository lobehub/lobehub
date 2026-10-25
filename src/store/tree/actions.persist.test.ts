import { CUSTOM_FOLDER_FILE_TYPE } from '@lobechat/const';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ReplicaModule from '@/libs/replica';
import { createReplicaState } from '@/libs/replica';
import { broadcastCacheScope, resetCacheScopeBroadcast } from '@/libs/replica/cacheScopeEvents';
import type * as CacheScopeModule from '@/libs/swr/useCacheScope';

import { TreeActionImpl } from './actions';
import {
  buildLibraryTreeSnapshot,
  MAX_PERSISTED_FOLDERS,
  MAX_PERSISTED_ITEMS_PER_FOLDER,
} from './projection';
import type { TreeItem, TreeState } from './types';

const { mockGetKnowledgeItems, mockUpdateResource, scope } = vi.hoisted(() => ({
  mockGetKnowledgeItems: vi.fn(),
  mockUpdateResource: vi.fn(),
  scope: { current: 'user-a:personal' },
}));

vi.mock('@/libs/swr/useCacheScope', async () => ({
  ...(await vi.importActual<typeof CacheScopeModule>('@/libs/swr/useCacheScope')),
  getCacheScope: () => scope.current,
}));

vi.mock('@/libs/replica', async () => ({
  ...(await vi.importActual<typeof ReplicaModule>('@/libs/replica')),
  revalidateReplica: vi.fn(),
}));

vi.mock('@/features/ResourceManager/store', () => ({
  useResourceManagerStore: { getState: () => ({ collapseHierarchySearch: vi.fn() }) },
}));

vi.mock('@/services/file', () => ({
  fileService: { getKnowledgeItems: mockGetKnowledgeItems },
}));

vi.mock('@/services/resource', () => ({
  resourceService: { updateResource: mockUpdateResource },
}));
vi.mock('@/store/file', () => ({ useFileStore: { getState: () => ({}) } }));

const folder = (id: string, name = id): TreeItem => ({
  fileType: CUSTOM_FOLDER_FILE_TYPE,
  id,
  isFolder: true,
  name,
  url: '',
});

const file = (id: string, extra: Partial<TreeItem> = {}): TreeItem => ({
  fileType: 'text/plain',
  id,
  isFolder: false,
  name: id,
  url: '',
  ...extra,
});

const createState = (): TreeState =>
  ({
    children: {},
    epoch: 0,
    errors: {},
    expanded: {},
    knowledgeBaseId: null,
    snapshotMap: {},
    snapshotReplica: createReplicaState(),
    status: {},
  }) as unknown as TreeState;

const setup = () => {
  const state = createState();
  const get = () => state;
  const set = (partial: Partial<TreeState> | ((s: TreeState) => Partial<TreeState>)) => {
    Object.assign(state, typeof partial === 'function' ? partial(state) : partial);
  };
  const actions = new TreeActionImpl(set as any, get);
  return { actions, state };
};

/** A request that resolves only when the test says so. */
const deferred = () => {
  let resolve!: (value: { items: unknown[] }) => void;
  const promise = new Promise<{ items: unknown[] }>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

const serverRow = (id: string, isFolder = false) => ({
  fileType: isFolder ? CUSTOM_FOLDER_FILE_TYPE : 'text/plain',
  id,
  name: id,
  url: 'https://s3.example.com/signed?X-Amz-Signature=secret',
});

describe('TreeActionImpl.init — keep the tree across remounts', () => {
  beforeEach(() => {
    mockGetKnowledgeItems.mockReset();
  });

  it('keeps the loaded tree when the same library mounts again, refreshing it in the background', async () => {
    const { actions, state } = setup();
    mockGetKnowledgeItems.mockResolvedValue({ items: [serverRow('folder-a', true)] });

    actions.init('kb-1');
    await vi.waitFor(() => expect(state.children['']).toHaveLength(1));
    state.expanded = { 'folder-a': true };
    state.children['folder-a'] = [file('doc-1')];

    const pending = deferred();
    mockGetKnowledgeItems.mockReset().mockReturnValue(pending.promise);
    actions.init('kb-1');

    // Same frame as the remount: nothing was wiped back to the skeleton.
    expect(state.children[''].map((i) => i.id)).toEqual(['folder-a']);
    expect(state.children['folder-a'].map((i) => i.id)).toEqual(['doc-1']);
    expect(state.expanded['folder-a']).toBe(true);
    // Root and the open folder are confirmed in the background.
    expect(mockGetKnowledgeItems.mock.calls.map(([args]) => args.parentId)).toEqual([
      null,
      'folder-a',
    ]);
    pending.resolve({ items: [] });
  });

  it('refreshes at most MAX_PERSISTED_FOLDERS folders on remount and collapses the rest', async () => {
    const { actions, state } = setup();
    const folders = Array.from({ length: MAX_PERSISTED_FOLDERS + 10 }, (_, i) => folder(`d-${i}`));
    mockGetKnowledgeItems.mockResolvedValue({ items: folders.map((f) => serverRow(f.id, true)) });
    actions.init('kb-1');
    await vi.waitFor(() => expect(state.children['']).toHaveLength(folders.length));
    for (const f of folders) {
      state.children[f.id] = [file(`${f.id}-child`)];
      state.expanded[f.id] = true;
    }

    mockGetKnowledgeItems.mockReset().mockReturnValue(new Promise(() => {}));
    actions.init('kb-1');

    // The root plus the first expanded folders, never one request per open folder.
    expect(mockGetKnowledgeItems).toHaveBeenCalledTimes(MAX_PERSISTED_FOLDERS);
    expect(state.children['d-0'].map((i) => i.id)).toEqual(['d-0-child']);
    // Folders past the cap are not left stale: collapsed, so the next expand reloads them.
    const last = folders.at(-1)!.id;
    expect(state.children[last]).toBeUndefined();
    expect(state.expanded[last]).toBeFalsy();
  });

  it('drops a folder loaded but collapsed before leaving, so expanding it after the return refetches', async () => {
    const { actions, state } = setup();
    mockGetKnowledgeItems.mockResolvedValue({ items: [serverRow('folder-a', true)] });
    actions.init('kb-1');
    await vi.waitFor(() => expect(state.children['']).toHaveLength(1));
    // Loaded once, then collapsed before the user left the library.
    state.children['folder-a'] = [file('stale-doc')];
    state.expanded = { 'folder-a': false };

    mockGetKnowledgeItems.mockReset().mockResolvedValue({ items: [] });
    actions.init('kb-1');
    expect(state.children['folder-a']).toBeUndefined();

    mockGetKnowledgeItems.mockClear().mockResolvedValue({ items: [serverRow('fresh-doc')] });
    actions.toggle('folder-a');

    expect(mockGetKnowledgeItems.mock.calls.map(([args]) => args.parentId)).toEqual(['folder-a']);
    await vi.waitFor(() =>
      expect(state.children['folder-a'].map((i) => i.id)).toEqual(['fresh-doc']),
    );
  });

  it('still resets when a different library mounts', () => {
    const { actions, state } = setup();
    mockGetKnowledgeItems.mockReturnValue(new Promise(() => {}));
    state.knowledgeBaseId = 'kb-1';
    state.children = { '': [folder('folder-a')] };

    actions.init('kb-2');

    expect(state.knowledgeBaseId).toBe('kb-2');
    expect(state.children).toEqual({});
  });
});

describe('TreeActionImpl.init — persisted snapshot', () => {
  beforeEach(() => {
    mockGetKnowledgeItems.mockReset();
  });

  it('paints the persisted tree in the init commit, before the network answers', async () => {
    const { actions, state } = setup();
    state.snapshotMap = {
      'kb-1': {
        children: { '': [folder('folder-a')], 'folder-a': [file('doc-1')] },
        expanded: ['folder-a'],
      },
    };
    const root = deferred();
    const sub = deferred();
    mockGetKnowledgeItems.mockImplementation(({ parentId }) =>
      parentId ? sub.promise : root.promise,
    );

    actions.init('kb-1');

    expect(state.children[''].map((i) => i.id)).toEqual(['folder-a']);
    expect(state.children['folder-a'].map((i) => i.id)).toEqual(['doc-1']);
    expect(state.expanded['folder-a']).toBe(true);

    // The server's answer replaces the stale rows.
    root.resolve({ items: [serverRow('folder-a', true), serverRow('doc-new')] });
    sub.resolve({ items: [serverRow('doc-2')] });
    await vi.waitFor(() => {
      expect(state.children[''].map((i) => i.id)).toEqual(['folder-a', 'doc-new']);
      expect(state.children['folder-a'].map((i) => i.id)).toEqual(['doc-2']);
    });
  });

  it('records the confirmed tree as the library snapshot without signed urls', async () => {
    const { actions, state } = setup();
    mockGetKnowledgeItems.mockResolvedValue({ items: [serverRow('doc-1')] });

    actions.init('kb-1');

    await vi.waitFor(() => expect(state.snapshotMap['kb-1']).toBeDefined());
    expect(state.snapshotMap['kb-1'].children[''].map((i) => i.id)).toEqual(['doc-1']);
    expect(state.snapshotMap['kb-1'].children[''][0].url).toBe('');
  });
});

describe('TreeActionImpl.reconcile — optimistic explorer rows', () => {
  beforeEach(() => {
    mockGetKnowledgeItems.mockReset();
  });

  it('renders an unconfirmed explorer list without persisting it, then persists once it settles', async () => {
    const { actions, state } = setup();
    mockGetKnowledgeItems.mockResolvedValue({ items: [serverRow('doc-1')] });
    actions.init('kb-1');
    await vi.waitFor(() => expect(state.snapshotMap['kb-1']).toBeDefined());

    // A pending create: the row shows, but a reload must not repaint it.
    actions.reconcile('', [file('doc-1'), file('temp-row')], { confirmed: false });
    expect(state.children[''].map((i) => i.id)).toEqual(['doc-1', 'temp-row']);
    // Nor may an unrelated write persist it meanwhile.
    actions.reconcile('folder-y', [file('doc-y')]);
    expect(state.snapshotMap['kb-1'].children[''].map((i) => i.id)).toEqual(['doc-1']);

    actions.reconcile('', [file('doc-1'), file('doc-2')], { confirmed: true });
    expect(state.snapshotMap['kb-1'].children[''].map((i) => i.id)).toEqual(['doc-1', 'doc-2']);
  });
});

describe('TreeActionImpl — sidebar transactions and the snapshot', () => {
  beforeEach(() => {
    mockGetKnowledgeItems.mockReset();
    mockUpdateResource.mockReset();
  });

  it('never persists a pending rename, and a rejected one leaves the stored name intact', async () => {
    const { actions, state } = setup();
    mockGetKnowledgeItems.mockResolvedValue({ items: [serverRow('doc-1')] });
    actions.init('kb-1');
    await vi.waitFor(() => expect(state.snapshotMap['kb-1']).toBeDefined());

    let reject!: (error: Error) => void;
    mockUpdateResource.mockReturnValue(
      new Promise((_resolve, r) => {
        reject = r;
      }),
    );
    const renaming = actions.renameItem('doc-1', '', 'renamed');
    await vi.waitFor(() => expect(state.children[''][0].name).toBe('renamed'));

    // An unrelated write while the rename is in flight must not persist it.
    actions.reconcile('folder-y', [file('doc-y')]);
    expect(state.snapshotMap['kb-1'].children[''][0].name).toBe('doc-1');

    reject(new Error('rename failed'));
    await renaming.catch(() => {});
    await vi.waitFor(() => expect(state.children[''][0].name).toBe('doc-1'));
    expect(state.snapshotMap['kb-1'].children[''][0].name).toBe('doc-1');
  });
});

describe('TreeActionImpl — reset during a sidebar transaction', () => {
  beforeEach(() => {
    mockGetKnowledgeItems.mockReset();
    mockUpdateResource.mockReset();
  });

  it("does not roll a previous library's failed rename back onto the new tree", async () => {
    const { actions, state } = setup();
    mockGetKnowledgeItems.mockResolvedValue({ items: [serverRow('doc-1')] });
    actions.init('kb-1');
    await vi.waitFor(() => expect(state.children['']).toHaveLength(1));

    let reject!: (error: Error) => void;
    mockUpdateResource.mockReturnValue(
      new Promise((_resolve, r) => {
        reject = r;
      }),
    );
    const renaming = actions.renameItem('doc-1', '', 'renamed');
    await vi.waitFor(() => expect(mockUpdateResource).toHaveBeenCalled());

    mockGetKnowledgeItems.mockResolvedValue({ items: [serverRow('other-doc')] });
    actions.init('kb-2');
    await vi.waitFor(() => expect(state.children[''][0].id).toBe('other-doc'));
    mockGetKnowledgeItems.mockClear();

    reject(new Error('rename failed'));
    await renaming.catch(() => {});

    expect(state.children[''].map((i) => i.id)).toEqual(['other-doc']);
    // Nor does the settled transaction refresh the previous library's folders.
    expect(mockGetKnowledgeItems).not.toHaveBeenCalled();
  });
});

describe('TreeActionImpl — abandoned optimistic folders', () => {
  beforeEach(() => {
    mockGetKnowledgeItems.mockReset();
  });

  it('keeps persisting the rest of the tree when a folder left mid-mutation stays unconfirmed', async () => {
    const { actions, state } = setup();
    mockGetKnowledgeItems.mockImplementation(({ parentId }) =>
      Promise.resolve({
        items: parentId ? [serverRow('doc-a')] : [serverRow('folder-a', true), serverRow('doc-1')],
      }),
    );
    actions.init('kb-1');
    await vi.waitFor(() => expect(state.children['']).toHaveLength(2));
    actions.toggle('folder-a');
    await vi.waitFor(() => expect(state.snapshotMap['kb-1'].children['folder-a']).toBeDefined());

    // A create in folder A, then the user navigates away before it settles.
    actions.reconcile('folder-a', [file('doc-a'), file('temp-row')], { confirmed: false });

    // A later confirmed write elsewhere still reaches the snapshot...
    actions.reconcile('', [folder('folder-a'), file('doc-1'), file('doc-2')], { confirmed: true });
    const stored = state.snapshotMap['kb-1'].children;
    expect(stored[''].map((i) => i.id)).toEqual(['folder-a', 'doc-1', 'doc-2']);
    // ...while folder A keeps its last confirmed rows.
    expect(stored['folder-a'].map((i) => i.id)).toEqual(['doc-a']);
  });
});

describe('TreeActionImpl.forgetLibrary', () => {
  beforeEach(() => {
    mockGetKnowledgeItems.mockReset();
  });

  it("drops a deleted library's persisted and rendered tree", async () => {
    const { actions, state } = setup();
    mockGetKnowledgeItems.mockResolvedValue({ items: [serverRow('doc-1')] });
    actions.init('kb-1');
    await vi.waitFor(() => expect(state.snapshotMap['kb-1']).toBeDefined());

    actions.forgetLibrary('kb-1');

    expect(state.snapshotMap['kb-1']).toBeUndefined();
    expect(state.knowledgeBaseId).toBeNull();
    expect(state.children).toEqual({});
  });
});

describe('TreeActionImpl — cache scope switch', () => {
  beforeEach(() => {
    mockGetKnowledgeItems.mockReset();
    resetCacheScopeBroadcast();
    scope.current = 'user-a:personal';
  });

  it("drops the previous identity's rendered tree when the scope changes", async () => {
    const { actions, state } = setup();
    mockGetKnowledgeItems.mockResolvedValue({ items: [serverRow('secret-folder', true)] });
    actions.init('kb-1');
    await vi.waitFor(() => expect(state.children['']).toHaveLength(1));
    broadcastCacheScope('user-a:personal');

    // The new identity's request fails: nothing of user-a may stay on screen.
    mockGetKnowledgeItems.mockReset().mockRejectedValue(new Error('unauthorized'));
    scope.current = 'user-b:personal';
    broadcastCacheScope('user-b:personal');

    expect(state.children['']).toBeUndefined();
    expect(state.snapshotMap['kb-1']).toBeUndefined();
    await vi.waitFor(() => expect(state.status['']).toBe('error'));
    expect(state.children['']).toBeUndefined();
  });

  it('keeps the tree when the resolved scope is the one it was built for', async () => {
    const { actions, state } = setup();
    mockGetKnowledgeItems.mockResolvedValue({ items: [serverRow('folder-a', true)] });
    actions.init('kb-1');
    await vi.waitFor(() => expect(state.children['']).toHaveLength(1));
    const epoch = state.epoch;

    broadcastCacheScope('user-a:personal');

    expect(state.epoch).toBe(epoch);
    expect(state.children[''].map((i) => i.id)).toEqual(['folder-a']);
  });
});

describe('buildLibraryTreeSnapshot', () => {
  it('keeps only the visible tree and bounds its size', () => {
    const many = Array.from({ length: MAX_PERSISTED_ITEMS_PER_FOLDER + 5 }, (_, i) =>
      file(`f-${i}`, { metadata: { emoji: '📄', huge: 'x'.repeat(100) } }),
    );
    const snapshot = buildLibraryTreeSnapshot(
      {
        '': [folder('open'), folder('closed'), ...many],
        'closed': [file('hidden')],
        'open': [file('visible')],
      },
      { open: true },
    )!;

    expect(Object.keys(snapshot.children).sort()).toEqual(['', 'open']);
    expect(snapshot.expanded).toEqual(['open']);
    expect(snapshot.children['']).toHaveLength(MAX_PERSISTED_ITEMS_PER_FOLDER);
    expect(snapshot.children[''][2].metadata).toEqual({ emoji: '📄' });
  });

  it('caps the number of persisted folders', () => {
    const folders = Array.from({ length: MAX_PERSISTED_FOLDERS + 5 }, (_, i) => folder(`d-${i}`));
    const children: Record<string, TreeItem[]> = { '': folders };
    const expanded: Record<string, boolean> = {};
    for (const f of folders) {
      children[f.id] = [file(`${f.id}-child`)];
      expanded[f.id] = true;
    }

    const snapshot = buildLibraryTreeSnapshot(children, expanded)!;
    expect(Object.keys(snapshot.children)).toHaveLength(MAX_PERSISTED_FOLDERS);
  });

  it('has nothing to persist before the root loads', () => {
    expect(buildLibraryTreeSnapshot({}, {})).toBeUndefined();
  });
});

describe('TreeActionImpl.revalidateLoaded — a delete only the server can enumerate', () => {
  beforeEach(() => {
    mockGetKnowledgeItems.mockReset();
  });

  /** Root holding two folders, both expanded and loaded, with one row each. */
  const loadTwoFolders = async () => {
    const { actions, state } = setup();
    mockGetKnowledgeItems.mockResolvedValue({
      items: [serverRow('folder-a', true), serverRow('folder-b', true)],
    });
    actions.init('kb-1');
    await vi.waitFor(() => expect(state.children['']).toHaveLength(2));
    state.expanded = { 'folder-a': true, 'folder-b': true };
    state.children['folder-a'] = [file('doc-a')];
    state.children['folder-b'] = [file('doc-b')];
    return { actions, state };
  };

  it('refetches every loaded folder, not only the one behind the explorer', async () => {
    const { actions, state } = await loadTwoFolders();

    // The search-wide delete matched rows in both folders; the server's answer no
    // longer lists them. The sidebar has to follow in each of them.
    mockGetKnowledgeItems.mockReset().mockResolvedValue({ items: [] });
    await actions.revalidateLoaded('');

    const requested = mockGetKnowledgeItems.mock.calls.map(([args]) => args.parentId);
    expect(new Set(requested)).toEqual(new Set([null, 'folder-a', 'folder-b']));
    expect(state.children['folder-a']).toEqual([]);
    expect(state.children['folder-b']).toEqual([]);

    const stored = JSON.stringify(state.snapshotMap['kb-1'] ?? {});
    expect(stored).not.toContain('doc-a');
    expect(stored).not.toContain('doc-b');
  });

  it('writes the snapshot once, after every folder settled', async () => {
    const { actions, state } = await loadTwoFolders();
    actions.forgetSnapshot();

    const pending = deferred();
    mockGetKnowledgeItems
      .mockReset()
      .mockImplementation(({ parentId }) =>
        parentId === 'folder-b' ? pending.promise : Promise.resolve({ items: [] }),
      );

    const batch = actions.revalidateLoaded('');
    await vi.waitFor(() => expect(state.children['folder-a']).toEqual([]));
    // folder-b still holds the deleted row: persisting now would store it again.
    expect(state.snapshotMap['kb-1']).toBeUndefined();

    pending.resolve({ items: [] });
    await batch;

    const stored = JSON.stringify(state.snapshotMap['kb-1'] ?? {});
    expect(stored).not.toContain('doc-a');
    expect(stored).not.toContain('doc-b');
  });
  // Regression: a failed folder refresh keeps its old rows on screen, and the
  // batch's closing snapshot write used to persist them, so a reload repainted
  // the rows the search-wide delete had just removed.
  it('keeps a folder whose refresh failed out of the stored snapshot', async () => {
    const { actions, state } = await loadTwoFolders();
    const rootFolders = [serverRow('folder-a', true), serverRow('folder-b', true)];
    actions.forgetSnapshot();

    mockGetKnowledgeItems
      .mockReset()
      .mockImplementation(({ parentId }) => {
        if (parentId === 'folder-b') return Promise.reject(new Error('network'));
        if (parentId === null) return Promise.resolve({ items: rootFolders });
        return Promise.resolve({ items: [] });
      });

    await actions.revalidateLoaded('');

    // The failed folder keeps its rows on screen; only the persisted copy drops them.
    expect(state.children['folder-b']).toEqual([file('doc-b')]);
    const stored = JSON.stringify(state.snapshotMap['kb-1'] ?? {});
    expect(stored).not.toContain('doc-a');
    expect(stored).not.toContain('doc-b');

    // A later successful refresh confirms the folder and persists it again.
    mockGetKnowledgeItems
      .mockReset()
      .mockImplementation(({ parentId }) =>
        Promise.resolve({ items: parentId === 'folder-b' ? [serverRow('doc-c')] : rootFolders }),
      );
    await actions.revalidate('folder-b');
    expect(JSON.stringify(state.snapshotMap['kb-1'] ?? {})).toContain('doc-c');
  });
});
