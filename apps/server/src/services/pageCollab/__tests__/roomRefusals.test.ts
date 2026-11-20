// @vitest-environment node
import { createHeadlessEditor } from '@lobehub/editor/headless';
import { TRPCError } from '@trpc/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { writePageBodyThroughRoom } from '../bodyWriter';
import { openPageFork } from '../fork';

vi.mock('@/envs/app', () => ({
  appEnv: {
    AGENT_GATEWAY_SERVICE_TOKEN: 'token',
    AGENT_GATEWAY_URL: 'https://gateway.test',
    ENABLE_PAGE_COLLAB: true,
  },
}));

vi.mock('@/server/services/pageCollab/persist', () => ({ persistPageState: async () => true }));

vi.mock('@/server/services/document', () => ({
  DocumentService: class {
    getDocumentById = async () => ({ title: 'Page', workspaceId: 'ws_1' });
  },
}));

const editorDataOf = (markdown: string) => {
  const editor = createHeadlessEditor();
  editor.hydrateMarkdown(markdown, { keepId: true });
  const { editorData } = editor.export();
  editor.destroy();
  return editorData;
};

const writer = { saveSource: 'llm_call' as const, userId: 'u1', writeSource: 'system' as const };

describe('a room that refuses a server write', () => {
  let state: Uint8Array;

  beforeEach(async () => {
    const seed = await openPageFork(undefined, editorDataOf('# Plan\n'));
    const doc = new Y.Doc();
    Y.applyUpdate(doc, seed.diff());
    seed.destroy();
    state = Y.encodeStateAsUpdate(doc);

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        const url = new URL(String(input));
        if (url.pathname === '/api/documents/state') {
          return Response.json({
            bootstrapped: true,
            epoch: 'e1',
            serverWriteSeq: 0,
            update: Buffer.from(state).toString('base64'),
          });
        }
        return Response.json({ code: 'DOC_TOO_LARGE', ok: false }, { status: 413 });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports a page over the size cap as PAYLOAD_TOO_LARGE with a reason the agent can read', async () => {
    const write = writePageBodyThroughRoom(
      {} as any,
      'doc_1',
      { editorData: editorDataOf('# Plan\n\nmore\n') },
      writer,
    );

    await expect(write).rejects.toBeInstanceOf(TRPCError);
    await expect(write).rejects.toMatchObject({
      code: 'PAYLOAD_TOO_LARGE',
      message: expect.stringMatching(/too large/i),
    });
  });
});
