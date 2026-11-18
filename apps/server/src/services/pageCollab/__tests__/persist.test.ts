// @vitest-environment node
import { createHeadlessEditor } from '@lobehub/editor/headless';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { openPageFork, PAGE_META_KEY } from '../fork';
import { PageProjectionRejectedError, persistPageState } from '../persist';
import { emptyEditorData } from '../seed';

const { redisStore, store } = vi.hoisted(() => ({
  redisStore: new Map<string, string>(),
  store: {
    calls: [] as string[],
    row: null as any,
    savedHistories: [] as any[],
    updates: [] as any[],
  },
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
    trySaveCurrentDocumentHistory = async (id: string, saveSource: string) => {
      store.calls.push('saveHistory');
      store.savedHistories.push({ editorData: store.row.editorData, id, saveSource });
      return { historyId: 'h1', savedAt: new Date() };
    };
    updateDocument = async (_id: string, params: any) => {
      store.calls.push('update');
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

const emptyRoom = async (titles: string[] = []) => {
  const fork = await openPageFork(undefined, emptyEditorData());
  for (const title of titles) fork.doc.getMap(PAGE_META_KEY).set('title', title);
  const state = Y.encodeStateAsUpdate(fork.doc);
  fork.destroy();
  return state;
};

const clearedRoom = async (markdown: string) => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, await roomOf(markdown));
  const root = doc.get('root', Y.XmlText);
  root.delete(0, root.length);
  return Y.encodeStateAsUpdate(doc);
};

const persist = (state: Uint8Array) =>
  persistPageState({} as any, 'doc_1', state, { saveSource: 'autosave' });

describe('persistPageState', () => {
  beforeEach(() => {
    redisStore.clear();
    store.calls = [];
    store.savedHistories = [];
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

  it('keeps the previous body as its own version before a projection that drops most of it', async () => {
    const previous = { root: { children: [{ type: 'paragraph' }], type: 'root' } };
    store.row = {
      ...store.row,
      content: `# Plan\n\n${'a long paragraph that the room is about to lose. '.repeat(8)}\n`,
      editorData: previous,
    };

    await persist(await roomOf('# Plan\n'));

    expect(store.calls).toEqual(['saveHistory', 'update']);
    expect(store.savedHistories).toEqual([
      { editorData: previous, id: 'doc_1', saveSource: 'system' },
    ]);
    expect(store.updates[0].saveSource).toBe('autosave');
  });

  it('writes a projection that keeps most of the body without an extra version', async () => {
    store.row = { ...store.row, content: '# Plan\n\nfirst\n' };

    await persist(await roomOf('# Plan\n\nfirst\n\nsecond\n'));

    expect(store.calls).toEqual(['update']);
  });

  describe('a room that never held the stored body', () => {
    beforeEach(() => {
      store.row = { content: '# Report\n\nfindings\n', editorData: null, title: 'Page' };
    });

    it('refuses an empty room over a stored body', async () => {
      await expect(persist(await emptyRoom())).rejects.toBeInstanceOf(PageProjectionRejectedError);
      expect(store.calls).toEqual([]);
    });

    it('refuses a room that was never bootstrapped', async () => {
      await expect(persist(Y.encodeStateAsUpdate(new Y.Doc()))).rejects.toBeInstanceOf(
        PageProjectionRejectedError,
      );
      expect(store.calls).toEqual([]);
    });

    it('refuses an empty room whose only edits renamed the page', async () => {
      await expect(persist(await emptyRoom(['Draft', 'Report']))).rejects.toBeInstanceOf(
        PageProjectionRejectedError,
      );
      expect(store.calls).toEqual([]);
    });

    it('writes a page someone cleared in the room', async () => {
      await persist(await clearedRoom('# Report\n\nfindings\n'));

      expect(store.updates).toHaveLength(1);
      expect(store.updates[0].content.trim()).toBe('');
    });

    it('writes an empty room over an empty stored page', async () => {
      store.row = { ...store.row, content: '' };

      await persist(await emptyRoom());

      expect(store.updates).toHaveLength(1);
    });
  });
});
