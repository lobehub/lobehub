// @vitest-environment node
import { createHeadlessEditor } from '@lobehub/editor/headless';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { writePageBodyThroughRoom } from '../bodyWriter';
import { openPageFork, projectPageState } from '../fork';
import { PageRoomStaleBaseError } from '../roomClient';

const env = vi.hoisted(() => ({
  AGENT_GATEWAY_SERVICE_TOKEN: 'token',
  AGENT_GATEWAY_URL: 'https://gateway.test',
  ENABLE_PAGE_COLLAB: true,
}));

vi.mock('@/envs/app', () => ({ appEnv: env }));

vi.mock('@/server/services/pageCollab/persist', () => ({ persistPageState: async () => true }));

vi.mock('@/server/services/document', () => ({
  DocumentService: class {
    getDocumentById = async () => ({ title: 'Page', workspaceId: 'ws_1' });
  },
}));

const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
const fromBase64 = (value: string) => new Uint8Array(Buffer.from(value, 'base64'));

// The gateway's room: `staleReads` stands in for other server instances that
// read the room before the latest server write reached it.
const room = {
  doc: new Y.Doc(),
  serverWriteSeq: 0,
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
      update: toBase64(stale ? stale.state : Y.encodeStateAsUpdate(room.doc)),
    });
  }

  if (url.pathname === '/api/documents/update') {
    const body = JSON.parse(String(init?.body));
    if (
      typeof body.baseServerWriteSeq === 'number' &&
      body.baseServerWriteSeq < room.serverWriteSeq
    ) {
      return Response.json({ code: 'STALE_BASE', ok: false }, { status: 409 });
    }
    Y.applyUpdate(room.doc, fromBase64(body.update));
    room.serverWriteSeq++;
    return Response.json({ epoch: 'e1', ok: true });
  }

  return new Response('not found', { status: 404 });
};

const writer = { saveSource: 'llm_call' as const, userId: 'u1', writeSource: 'system' as const };

const editorDataOf = (markdown: string) => {
  const editor = createHeadlessEditor();
  editor.hydrateMarkdown(markdown, { keepId: true });
  const { editorData } = editor.export();
  editor.destroy();
  return editorData;
};

const seedRoom = async (markdown: string) => {
  const seed = await openPageFork(undefined, markdown ? editorDataOf(markdown) : undefined);
  room.doc = new Y.Doc();
  Y.applyUpdate(room.doc, seed.diff());
  seed.destroy();
};

const markdownOfRoom = async () =>
  (await projectPageState(Y.encodeStateAsUpdate(room.doc))).markdown;

const write = (markdown: string) =>
  writePageBodyThroughRoom({} as any, 'doc_1', { editorData: editorDataOf(markdown) }, writer);

const readStaleFor = (reads: number) => {
  room.stale = { reads, seq: room.serverWriteSeq, state: Y.encodeStateAsUpdate(room.doc) };
};

const writeBothFromOneRead = async (first: string, second: string) => {
  readStaleFor(2);
  await write(first);
  await write(second);
  room.stale = null;
};

describe('two server writers that read the same room state', () => {
  beforeEach(() => {
    room.serverWriteSeq = 0;
    room.stale = null;
    vi.stubGlobal('fetch', vi.fn(gateway));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('control: sequential writers that each read the latest room state', async () => {
    await seedRoom('## Purpose\n\npara one\n');

    await write('## Purpose v2\n\npara one\n');
    await write('## Purpose v2\n\npara one\n');

    expect(await markdownOfRoom()).toBe('## Purpose v2\n\npara one\n');
  });

  it('writing the same body twice keeps one copy', async () => {
    await seedRoom('## Purpose\n\npara one\n');

    await writeBothFromOneRead('## Purpose v2\n\npara one\n', '## Purpose v2\n\npara one\n');

    expect(await markdownOfRoom()).toBe('## Purpose v2\n\npara one\n');
  });

  it('writing different bodies keeps one of them, not both merged', async () => {
    await seedRoom('## Purpose\n\npara one\n');

    await writeBothFromOneRead('## Purpose A\n\npara one\n', '## Purpose B\n\npara one\n');

    expect(['## Purpose A\n\npara one\n', '## Purpose B\n\npara one\n']).toContain(
      await markdownOfRoom(),
    );
  });

  it('two writers filling an empty page keep one copy of the page', async () => {
    await seedRoom('');
    const page = '# Plan\n\nfirst paragraph\n\nsecond paragraph\n';

    await writeBothFromOneRead(page, page);

    expect(await markdownOfRoom()).toBe(page);
  });

  it('two writers appending to a stub page keep one copy of the new content', async () => {
    await seedRoom('# Plan\n');
    const page = '# Plan\n\nfirst paragraph\n\nsecond paragraph\n';

    await writeBothFromOneRead(page, page);

    expect(await markdownOfRoom()).toBe(page);
  });

  it('gives up with the stale-base error when every read stays stale, leaving the room untouched', async () => {
    await seedRoom('# Plan\n');
    await write('# Plan\n\nlatest\n');
    readStaleFor(Number.POSITIVE_INFINITY);
    room.stale!.seq = 0;

    await expect(write('# Plan\n\nfrom a stale read\n')).rejects.toBeInstanceOf(
      PageRoomStaleBaseError,
    );
    room.stale = null;

    expect(await markdownOfRoom()).toBe('# Plan\n\nlatest\n');
  });
});
