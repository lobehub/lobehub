// @vitest-environment node
import { createHeadlessEditor } from '@lobehub/editor/headless';
import { TRPCError } from '@trpc/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import type { LobeChatDatabase } from '@/database/type';
import type { DocumentService } from '@/server/services/document';

import { updateDocumentThroughRoom, writePageBodyThroughRoom } from '../bodyWriter';
import { openPageFork, projectPageState } from '../fork';

// Nothing on these paths reaches the database: the document service, persist and Redis are mocked.
const db = {} as unknown as LobeChatDatabase;

const env = vi.hoisted(() => ({
  AGENT_GATEWAY_SERVICE_TOKEN: 'token',
  AGENT_GATEWAY_URL: 'https://gateway.test',
  ENABLE_PAGE_COLLAB: true,
}));

// The stored page, and the room state it was last written from.
const stored = vi.hoisted(() => ({
  failPersist: false,
  persistedRoomState: null as Uint8Array | null,
  redisDown: false,
  updatedAt: new Date('2026-11-23T10:00:00.000Z'),
}));

vi.mock('@/envs/app', () => ({ appEnv: env }));

vi.mock('@/server/services/document', () => ({
  DocumentService: class {
    getDocumentById = async () => ({
      title: 'Page',
      updatedAt: stored.updatedAt,
      workspaceId: 'ws_1',
    });
  },
}));

vi.mock('@/server/services/redis', () => ({
  redisService: {
    pageCollab: {
      lastPersistedRoomState: async () =>
        stored.redisDown ? undefined : stored.persistedRoomState,
    },
  },
}));

// What the real persist does to the row and the remembered room state.
vi.mock('@/server/services/pageCollab/persist', async () => {
  // `vi.mock` factories are hoisted above the static imports, so `yjs` is loaded here.
  const Yjs = await import('yjs');
  return {
    persistPageState: async (_db: unknown, _id: string, state: Uint8Array) => {
      if (stored.failPersist) throw new Error('database unavailable');
      stored.updatedAt = new Date(stored.updatedAt.getTime() + 1000);
      stored.persistedRoomState = Yjs.encodeStateVectorFromUpdate(state);
      return true;
    },
  };
});

const room = {
  doc: new Y.Doc(),
  pushes: 0,
  serverWriteSeq: 0 as number | undefined,
  stale: null as { reads: number; seq: number; state: Uint8Array } | null,
};

const gateway = async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);

  if (url.pathname === '/api/documents/state') {
    const stale = room.stale && room.stale.reads > 0 ? room.stale : null;
    if (stale) stale.reads--;
    return Response.json({
      bootstrapped: true,
      epoch: 'e1',
      serverWriteSeq: stale ? stale.seq : room.serverWriteSeq,
      update: Buffer.from(stale ? stale.state : Y.encodeStateAsUpdate(room.doc)).toString('base64'),
    });
  }

  if (url.pathname === '/api/documents/update') {
    const body = JSON.parse(String(init?.body));
    if (
      typeof body.baseServerWriteSeq === 'number' &&
      room.serverWriteSeq !== undefined &&
      body.baseServerWriteSeq < room.serverWriteSeq
    ) {
      return Response.json({ code: 'STALE_BASE', ok: false }, { status: 409 });
    }
    Y.applyUpdate(room.doc, new Uint8Array(Buffer.from(body.update, 'base64')));
    room.pushes++;
    if (room.serverWriteSeq !== undefined) room.serverWriteSeq++;
    return Response.json({ epoch: 'e1', ok: true });
  }

  return new Response('not found', { status: 404 });
};

const writer = { saveSource: 'system' as const, userId: 'u1', writeSource: 'user' as const };

const editorDataOf = (markdown: string) => {
  const editor = createHeadlessEditor();
  editor.hydrateMarkdown(markdown, { keepId: true });
  const { editorData } = editor.export();
  editor.destroy();
  return editorData;
};

const roomState = () => Y.encodeStateAsUpdate(room.doc);

// A room the stored page was seeded from: the remembered state is the room's.
const seedRoom = async (markdown: string) => {
  const seed = await openPageFork(undefined, editorDataOf(markdown));
  room.doc = new Y.Doc();
  Y.applyUpdate(room.doc, seed.diff());
  seed.destroy();
  stored.persistedRoomState = Y.encodeStateVectorFromUpdate(roomState());
};

// An edit someone made in the room that has not reached the stored page yet.
const typeInRoom = async (markdown: string) => {
  const other = await openPageFork(roomState());
  other.editor.hydrateEditorData(editorDataOf(markdown), { keepId: true });
  Y.applyUpdate(room.doc, other.diff());
  other.destroy();
};

const markdownOfRoom = async () => (await projectPageState(roomState())).markdown;

const readVersion = () => new Date(stored.updatedAt);

const service: Pick<DocumentService, 'assertCanWriteBody' | 'updateDocument'> = {
  assertCanWriteBody: async () => {},
  updateDocument: async (id) => ({ historyAppended: false, id, updatedAt: stored.updatedAt }),
};

const save = (markdown: string, expectedUpdatedAt: Date) =>
  updateDocumentThroughRoom(
    db,
    service,
    'doc_1',
    { content: markdown, editorData: editorDataOf(markdown), expectedUpdatedAt },
    { userId: 'u1', workspaceId: 'ws_1' },
  );

const expectVersionMismatch = async (write: Promise<unknown>) => {
  const error = await write.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(TRPCError);
  expect(error).toMatchObject({
    cause: { data: { code: 'DocumentVersionMismatch' } },
    code: 'CONFLICT',
  });
};

describe('a write that names the stored version it was made against', () => {
  beforeEach(async () => {
    room.pushes = 0;
    room.serverWriteSeq = 0;
    room.stale = null;
    stored.failPersist = false;
    stored.redisDown = false;
    stored.updatedAt = new Date('2026-11-23T10:00:00.000Z');
    await seedRoom('para one\n');
    vi.stubGlobal('fetch', vi.fn(gateway));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('goes into the room while the page is still at that version', async () => {
    await save('para one\n\nadded\n', readVersion());

    expect(await markdownOfRoom()).toBe('para one\n\nadded\n');
  });

  it('lets only the first of two saves made from the same read through', async () => {
    const base = readVersion();

    const [first, second] = await Promise.allSettled([
      save('first\n', base),
      save('second\n', base),
    ]);

    expect(first.status).toBe('fulfilled');
    expect(second.status).toBe('rejected');
    await expectVersionMismatch(Promise.reject((second as PromiseRejectedResult).reason));
    expect(await markdownOfRoom()).toBe('first\n');
  });

  it('answers a conflict when another server wrote the room after it was read, instead of retrying', async () => {
    const base = readVersion();
    // Another instance wrote the room; its save has not reached the stored page yet.
    room.stale = { reads: 1, seq: 0, state: roomState() };
    await typeInRoom('from another instance\n');
    room.serverWriteSeq = 1;

    await expectVersionMismatch(save('mine\n', base));
    expect(await markdownOfRoom()).toBe('from another instance\n');
  });

  it('stores what the room holds beyond the stored page, answers a conflict, and takes a save made from that version', async () => {
    const base = readVersion();
    await typeInRoom('typed in the browser\n');

    await expectVersionMismatch(save('mine\n', base));
    expect(room.pushes).toBe(0);
    expect(stored.updatedAt.getTime()).toBeGreaterThan(base.getTime());
    expect(await markdownOfRoom()).toBe('typed in the browser\n');

    await save('mine\n', readVersion());
    expect(await markdownOfRoom()).toBe('mine\n');
  });

  it('treats a room nobody recorded the same way', async () => {
    const base = readVersion();
    stored.persistedRoomState = null;

    await expectVersionMismatch(save('mine\n', base));
    expect(room.pushes).toBe(0);

    await save('mine\n', readVersion());
    expect(await markdownOfRoom()).toBe('mine\n');
  });

  it('does not take a room write whose save to the stored page failed as that version', async () => {
    const base = readVersion();
    stored.failPersist = true;
    await save('first\n', base);
    stored.failPersist = false;

    await expectVersionMismatch(save('second\n', base));
    expect(await markdownOfRoom()).toBe('first\n');
  });

  it('answers a conflict when the stored page moved on', async () => {
    const base = readVersion();
    stored.updatedAt = new Date(base.getTime() + 5000);

    await expectVersionMismatch(save('mine\n', base));
    expect(room.pushes).toBe(0);
  });

  it('falls back to the stored version alone without Redis', async () => {
    stored.redisDown = true;
    const base = readVersion();

    await save('mine\n', base);
    expect(await markdownOfRoom()).toBe('mine\n');

    await expectVersionMismatch(save('stale\n', base));
  });

  it('refuses when the room cannot make conditional server writes', async () => {
    room.serverWriteSeq = undefined;

    await expect(save('mine\n', readVersion())).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
    expect(room.pushes).toBe(0);
  });

  it('still retries a stale room for a write that names no version', async () => {
    room.stale = { reads: 1, seq: 0, state: roomState() };
    await typeInRoom('para one\n\nfrom another instance\n');
    room.serverWriteSeq = 1;

    const written = await writePageBodyThroughRoom(
      db,
      'doc_1',
      { markdown: 'para one\n\nfrom another instance\n\nmine\n' },
      { ...writer, saveSource: 'system' },
    );

    expect(written).toBe(true);
    expect(await markdownOfRoom()).toBe('para one\n\nfrom another instance\n\nmine\n');
  });
});
