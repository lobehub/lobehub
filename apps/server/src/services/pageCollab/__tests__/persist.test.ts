// @vitest-environment node
import { createHeadlessEditor } from '@lobehub/editor/headless';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { openPageFork } from '../fork';
import { PageProjectionRejectedError, persistPageState } from '../persist';

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

// An emptied editor keeps one empty paragraph, as does a client binding seeding an empty root.
const blankRoom = async () => {
  const fork = await openPageFork(undefined, {
    root: {
      children: [
        { children: [], direction: null, format: '', indent: 0, type: 'paragraph', version: 1 },
      ],
      direction: null,
      format: '',
      indent: 0,
      type: 'root',
      version: 1,
    },
  } as any);
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

  describe('an empty room over a stored body', () => {
    const storedBody = async () => {
      const editor = createHeadlessEditor();
      editor.hydrateMarkdown('# Report\n\nbody that must survive\n', { keepId: true });
      const editorData = editor.export().editorData;
      editor.destroy();
      return editorData;
    };

    it('refuses a room that was never bootstrapped', async () => {
      store.row = { content: '', editorData: await storedBody(), title: 'Report' };
      const unbootstrapped = Y.encodeStateAsUpdate(new Y.Doc());

      await expect(persist(unbootstrapped)).rejects.toBeInstanceOf(PageProjectionRejectedError);
      expect(store.updates).toEqual([]);
    });

    it('refuses a room seeded with only an empty paragraph', async () => {
      store.row = { content: 'body that must survive\n', editorData: null, title: 'Report' };

      await expect(persist(await blankRoom())).rejects.toThrow(/empty room/);
      expect(store.updates).toEqual([]);
    });

    it('refuses even when the stored body is only in its editor state', async () => {
      store.row = { content: '', editorData: await storedBody(), title: 'Report' };

      await expect(persist(await blankRoom())).rejects.toBeInstanceOf(PageProjectionRejectedError);
    });

    it('accepts clearing a page whose room held the stored body', async () => {
      await persist(await roomOf('body\n'));
      store.row = { ...store.row, content: 'body\n' };

      await persist(await blankRoom());

      expect(store.updates).toHaveLength(2);
      expect(store.updates[1].content).toBe('');
    });

    it('accepts clearing a page after its remembered projection expired', async () => {
      store.row = { content: 'body\n', editorData: await storedBody(), title: 'Report' };
      const doc = new Y.Doc();
      Y.applyUpdate(doc, await roomOf('body\n'));
      const root = doc.get('root', Y.XmlText);
      root.delete(0, root.length);
      const cleared = Y.encodeStateAsUpdate(doc);
      doc.destroy();

      await persist(cleared);

      expect(store.updates).toHaveLength(1);
      expect(store.updates[0].content).toBe('');
    });

    it('writes a room with content over a new, empty page', async () => {
      store.row = { content: '', editorData: null, title: 'Page' };

      await persist(await roomOf('first words\n'));

      expect(store.updates).toHaveLength(1);
      expect(store.updates[0].content).toBe('first words\n');
    });

    it('accepts an empty room over an empty page', async () => {
      store.row = { content: '', editorData: null, title: 'Page' };

      await persist(Y.encodeStateAsUpdate(new Y.Doc()));

      expect(store.updates).toHaveLength(1);
    });
  });
});
