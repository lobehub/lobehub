// @vitest-environment node
import { createHeadlessEditor } from '@lobehub/editor/headless';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { updateDocumentThroughRoom, writePageBodyThroughRoom } from '../bodyWriter';
import { openPageFork, projectPageState } from '../fork';

const room = vi.hoisted(() => ({ bootstrapped: true, doc: null as any, pushes: [] as any[] }));
const env = vi.hoisted(() => ({ ENABLE_PAGE_COLLAB: true }));
const persisted = vi.hoisted(() => [] as any[]);

vi.mock('@/envs/app', () => ({ appEnv: env }));

vi.mock('@/server/services/pageCollab/roomClient', async (importOriginal) => {
  const Yjs = await import('yjs');
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    createPageRoomClient: () => ({
      getState: async () => ({
        bootstrapped: room.bootstrapped,
        epoch: 'e1',
        update: Yjs.encodeStateAsUpdate(room.doc),
      }),
      pushUpdate: async (_id: string, update: Uint8Array, options: any) => {
        room.pushes.push(options);
        Yjs.applyUpdate(room.doc, update);
      },
    }),
  };
});

vi.mock('@/server/services/pageCollab/persist', () => ({
  persistPageState: async (_db: unknown, _id: string, _state: Uint8Array, options: any) => {
    persisted.push(options);
    return true;
  },
}));

vi.mock('@/server/services/document', () => ({
  DocumentService: class {
    getDocumentById = async () => ({ title: 'Page' });
  },
}));

const writer = { saveSource: 'system' as const, userId: 'u1', writeSource: 'system' as const };

const editorDataOf = (markdown: string) => {
  const editor = createHeadlessEditor();
  editor.hydrateMarkdown(markdown, { keepId: true });
  const { editorData } = editor.export();
  editor.destroy();
  return editorData;
};

const seedRoom = async (markdown: string) => {
  const seed = await openPageFork(undefined, editorDataOf(markdown));
  room.doc = new Y.Doc();
  Y.applyUpdate(room.doc, seed.diff());
  seed.destroy();
};

const markdownOfRoom = async () =>
  (await projectPageState(Y.encodeStateAsUpdate(room.doc))).markdown;

describe('writePageBodyThroughRoom', () => {
  beforeEach(async () => {
    env.ENABLE_PAGE_COLLAB = true;
    room.bootstrapped = true;
    room.pushes = [];
    persisted.length = 0;
    await seedRoom('para one\n\npara two\n');
  });

  it('writes a body into the live room as one more collaborator', async () => {
    const written = await writePageBodyThroughRoom(
      {} as any,
      'doc_1',
      { editorData: editorDataOf('para one\n\npara TWO\n') },
      writer,
    );

    expect(written).toBe(true);
    expect(await markdownOfRoom()).toBe('para one\n\npara TWO\n');
    expect(room.pushes).toEqual([{ actor: 'external:u1' }]);
    expect(persisted[0]).toMatchObject({
      history: { editorIds: ['u1'] },
      saveSource: 'system',
    });
  });

  it('merges with what someone typed in another block meanwhile', async () => {
    const user = await openPageFork(Y.encodeStateAsUpdate(room.doc));
    const userXml = user.editor.export({ litexml: true }).litexml!;
    const userBlock = userXml.match(/<p id="(\w+)">\s*<span[^>]*>para one/)?.[1];
    await user.editor.applyLiteXML({
      action: 'replace',
      litexml: `<p id="${userBlock}">para ONE</p>`,
    });
    const typed = user.diff();
    user.destroy();

    await writePageBodyThroughRoom(
      {} as any,
      'doc_1',
      { markdown: 'para one\n\npara TWO\n' },
      writer,
    );
    Y.applyUpdate(room.doc, typed);

    expect(await markdownOfRoom()).toBe('para ONE\n\npara TWO\n');
  });

  it('leaves the write to the caller when nobody uses the room yet', async () => {
    room.bootstrapped = false;

    const written = await writePageBodyThroughRoom(
      {} as any,
      'doc_1',
      { markdown: 'replaced\n' },
      writer,
    );

    expect(written).toBe(false);
    expect(room.pushes).toHaveLength(0);
  });

  it('leaves the write to the caller without collaboration', async () => {
    env.ENABLE_PAGE_COLLAB = false;

    expect(
      await writePageBodyThroughRoom({} as any, 'doc_1', { markdown: 'replaced\n' }, writer),
    ).toBe(false);
  });

  it('pushes nothing when the body already matches the room', async () => {
    await writePageBodyThroughRoom(
      {} as any,
      'doc_1',
      { markdown: 'para one\n\npara two\n' },
      writer,
    );

    expect(room.pushes).toHaveLength(0);
  });
});

describe('writePageBodyThroughRoom titles', () => {
  beforeEach(async () => {
    env.ENABLE_PAGE_COLLAB = true;
    room.bootstrapped = true;
    room.pushes = [];
    await seedRoom('para one\n\npara two\n');
  });

  it('renames the page in the room without touching its body', async () => {
    await writePageBodyThroughRoom({} as any, 'doc_1', { title: 'Renamed' }, writer);

    const projected = await projectPageState(Y.encodeStateAsUpdate(room.doc));
    expect(projected.title).toBe('Renamed');
    expect(projected.markdown).toBe('para one\n\npara two\n');
  });
});

describe('updateDocumentThroughRoom', () => {
  beforeEach(async () => {
    env.ENABLE_PAGE_COLLAB = true;
    room.bootstrapped = true;
    room.pushes = [];
    await seedRoom('para one\n');
  });

  const service = () => ({ updateDocument: vi.fn(async (id: string) => ({ id }) as any) });

  it('keeps the body off the row when the room took it', async () => {
    const documents = service();

    await updateDocumentThroughRoom(
      {} as any,
      documents,
      'doc_1',
      {
        content: 'para ONE\n',
        expectedUpdatedAt: new Date(),
        metadata: { tag: 'x' },
        saveSource: 'restore',
        title: 'T',
      },
      { userId: 'u1' },
    );

    expect(await markdownOfRoom()).toBe('para ONE\n');
    expect(documents.updateDocument).toHaveBeenCalledWith('doc_1', {
      metadata: { tag: 'x' },
      saveSource: 'restore',
    });
  });

  it('writes the row as before when the page has no live room', async () => {
    room.bootstrapped = false;
    const documents = service();
    const params = { content: 'para ONE\n' };

    await updateDocumentThroughRoom({} as any, documents, 'doc_1', params, { userId: 'u1' });

    expect(documents.updateDocument).toHaveBeenCalledWith('doc_1', params);
  });

  it('leaves metadata-only updates alone', async () => {
    const documents = service();

    await updateDocumentThroughRoom(
      {} as any,
      documents,
      'doc_1',
      { parentId: 'p1' },
      {
        userId: 'u1',
      },
    );

    expect(room.pushes).toHaveLength(0);
    expect(documents.updateDocument).toHaveBeenCalledWith('doc_1', { parentId: 'p1' });
  });
});
