// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { projectPageState } from '../fork';
import { RoomPageSessions } from '../roomSession';

vi.mock('@/envs/app', () => ({
  appEnv: {
    AGENT_GATEWAY_SERVICE_TOKEN: 'token',
    AGENT_GATEWAY_URL: 'https://gateway.test',
    ENABLE_WORKSPACE_PAGE_COLLAB: true,
  },
}));

vi.mock('@/server/services/pageCollab/persist', () => ({ persistPageState: async () => true }));

vi.mock('@/server/services/document/writeLimit', () => ({
  assertDocumentWriteWithinLimit: async () => {},
  getDocumentCharLimitErrorData: () => undefined,
}));

vi.mock('@/server/services/document', () => ({
  DocumentService: class {
    getDocumentById = async () => ({
      content: '',
      editorData: null,
      title: 'Empty page',
      workspaceId: 'ws_1',
    });
  },
}));

const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
const fromBase64 = (value: string) => new Uint8Array(Buffer.from(value, 'base64'));

// A durable room with no tree yet: it takes one bootstrap and refuses anything
// else, so an unflagged root cannot become a second tree beside a later seed.
const room = { bootstrapped: false, doc: new Y.Doc() };

const gateway = async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.pathname === '/api/documents/state') {
    return Response.json({
      bootstrapped: room.bootstrapped,
      epoch: 'e1',
      serverWriteSeq: 0,
      update: toBase64(Y.encodeStateAsUpdate(room.doc)),
    });
  }
  const body = JSON.parse(String(init?.body));
  if (body.bootstrap === true && room.bootstrapped) {
    return Response.json({ code: 'bootstrap_conflict', ok: false }, { status: 409 });
  }
  if (!room.bootstrapped && body.bootstrap !== true) {
    return Response.json({ code: 'not_bootstrapped', ok: false }, { status: 409 });
  }
  Y.applyUpdate(room.doc, fromBase64(body.update));
  room.bootstrapped = true;
  return Response.json({ ok: true });
};

const writer = { saveSource: 'llm_call' as const, userId: 'u1', writeSource: 'system' as const };

describe('RoomPageSessions on a room that has no tree yet', () => {
  beforeEach(() => {
    room.bootstrapped = false;
    room.doc = new Y.Doc();
    vi.stubGlobal('fetch', vi.fn(gateway));
  });

  afterEach(() => vi.unstubAllGlobals());

  it('bootstraps an empty page with an empty root, so an agent can write into it', async () => {
    const session = await new RoomPageSessions({} as any, writer).openSession('doc_1');
    session.setTitle('Plan');
    await session.commit();
    session.draft.destroy();

    expect(room.bootstrapped).toBe(true);
    expect(room.doc.get('root', Y.XmlText).length).toBeGreaterThan(0);
    expect((await projectPageState(Y.encodeStateAsUpdate(room.doc))).title).toBe('Plan');
  });
});
