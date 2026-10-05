// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { projectPageState } from '@/server/services/pageCollab/fork';

import { pageAgentRuntime } from '../pageAgent';

const room = vi.hoisted(() => ({ bootstrapped: false, doc: null as any, pushes: [] as any[] }));

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
        room.bootstrapped = true;
        Yjs.applyUpdate(room.doc, update);
      },
    }),
  };
});

vi.mock('@/server/services/document', () => ({
  DocumentService: class {
    getDocumentById = async () => ({ content: 'para one\n', editorData: null, title: 'Page' });
  },
}));

const ctx = { documentId: 'doc_1', userId: 'u1' };

const createRuntime = () =>
  pageAgentRuntime.factory({ serverDB: {} as any, toolManifestMap: {}, userId: 'u1' }) as {
    initPage: (args: { markdown: string }, context: typeof ctx) => Promise<any>;
  };

describe('pageAgentRuntime initPage', () => {
  beforeEach(() => {
    room.doc = new Y.Doc();
    room.pushes = [];
    room.bootstrapped = false;
  });

  it('bootstraps the room from the stored page and replaces it through the room', async () => {
    const result = await createRuntime().initPage({ markdown: '# Fresh\n\nnew body' }, ctx);

    expect(result.success).toBe(true);
    expect(result.state).toMatchObject({ changed: true, documentId: 'doc_1' });
    expect(room.pushes[0]).toMatchObject({ bootstrap: true });

    const projected = await projectPageState(Y.encodeStateAsUpdate(room.doc));
    expect(projected.markdown).toContain('new body');
    expect(projected.markdown).not.toContain('para one');
    expect(projected.title).toBe('Fresh');
  });
});
