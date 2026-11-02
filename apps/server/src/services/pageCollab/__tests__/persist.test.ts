// @vitest-environment node
import { createHeadlessEditor } from '@lobehub/editor/headless';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { openPageFork } from '../fork';
import { persistPageState } from '../persist';

const { redisStore, store } = vi.hoisted(() => ({
  redisStore: new Map<string, string>(),
  store: { row: null as any, updates: [] as any[] },
}));

vi.mock('@/server/services/redis', () => ({
  redisService: {
    pageCollab: {
      lastProjectedBody: async (id: string) => redisStore.get(id) ?? null,
      rememberProjectedBody: async (id: string, digest: string) => {
        redisStore.set(id, digest);
      },
    },
  },
}));

vi.mock('@/server/services/resourcePermission', () => ({
  getResourceMeta: async () => ({ userId: 'owner', workspaceId: 'ws_1' }),
}));

vi.mock('@/server/services/document', () => ({
  DocumentService: class {
    getDocumentById = async () => store.row;
    updateDocument = async (_id: string, params: any) => {
      store.updates.push(params);
      store.row = { ...store.row, editorData: params.editorData };
      return { historyAppended: true, updatedAt: new Date() };
    };
  },
}));

const roomOf = async (markdown: string) => {
  const editor = createHeadlessEditor();
  editor.hydrateMarkdown(markdown, { keepId: true });
  const fork = await openPageFork(undefined, editor.export().editorData);
  editor.destroy();
  const state = Y.encodeStateAsUpdate(fork.doc);
  fork.destroy();
  return state;
};

const persist = (state: Uint8Array) =>
  persistPageState({} as any, 'doc_1', state, { saveSource: 'autosave' });

describe('persistPageState', () => {
  beforeEach(() => {
    redisStore.clear();
    store.updates = [];
    store.row = { content: 'old\n', editorData: null, title: 'Page' };
  });

  it('projects the room as the requested version', async () => {
    await persist(await roomOf('one\n'));
    await persist(await roomOf('two\n'));

    expect(store.updates.map((update) => update.saveSource)).toEqual(['autosave', 'autosave']);
  });

  it('keeps a body written around the room as its own version before replacing it', async () => {
    await persist(await roomOf('one\n'));
    // Something wrote the row without going through the room.
    store.row = { ...store.row, editorData: { root: { children: [], type: 'root' } } };

    await persist(await roomOf('two\n'));

    expect(store.updates[1]).toMatchObject({ breakAutosaveWindow: true, saveSource: 'system' });
  });

  it('cannot tell without a remembered projection', async () => {
    store.row = { ...store.row, editorData: { root: { children: [], type: 'root' } } };

    await persist(await roomOf('one\n'));

    expect(store.updates[0].saveSource).toBe('autosave');
  });

  it('ignores the key order jsonb hands back', async () => {
    await persist(await roomOf('one\n'));
    const reorder = (value: any): any =>
      Array.isArray(value)
        ? value.map(reorder)
        : value && typeof value === 'object'
          ? Object.fromEntries(
              Object.keys(value)
                .reverse()
                .map((key) => [key, reorder(value[key])]),
            )
          : value;
    store.row = { ...store.row, editorData: reorder(store.row.editorData) };

    await persist(await roomOf('two\n'));

    expect(store.updates[1].saveSource).toBe('autosave');
  });
});
