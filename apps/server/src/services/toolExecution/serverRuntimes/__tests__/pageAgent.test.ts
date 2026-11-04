// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { projectPageState } from '@/server/services/pageCollab/fork';

import { pageAgentRuntime } from '../pageAgent';

const room = vi.hoisted(() => ({ bootstrapped: false, doc: null as any, pushes: [] as any[] }));
const env = vi.hoisted(() => ({ ENABLE_PAGE_COLLAB: true }));
const store = vi.hoisted(() => ({
  row: null as any,
  updates: [] as { id: string; params: any }[],
}));

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
        room.bootstrapped = true;
        Yjs.applyUpdate(room.doc, update);
      },
    }),
  };
});

vi.mock('@/server/services/resourcePermission', () => ({
  canPerformResourceAction: async () => true,
  getResourceMeta: async () => ({ userId: 'owner', workspaceId: 'ws_1' }),
}));

vi.mock('@/server/services/document', () => ({
  DocumentService: class {
    getDocumentById = async () => store.row;
    updateDocument = async (id: string, params: any) => {
      store.updates.push({ id, params });
      return { historyAppended: true, id, updatedAt: new Date() };
    };
  },
}));

const ctx = { documentId: 'doc_1', userId: 'u1' };

const createRuntime = () =>
  pageAgentRuntime.factory({
    agentId: 'agt_1',
    operationId: 'op_step',
    rootOperationId: 'op_root',
    serverDB: {} as any,
    toolManifestMap: {},
    userId: 'u1',
    workspaceId: 'ws_1',
  }) as {
    initPage: (args: { markdown: string }, context: typeof ctx) => Promise<any>;
  };

beforeEach(() => {
  room.doc = new Y.Doc();
  room.pushes = [];
  room.bootstrapped = false;
  store.updates = [];
  store.row = {
    content: 'para one\n',
    editorData: null,
    title: 'Page',
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };
});

describe('pageAgentRuntime initPage with collaboration', () => {
  beforeEach(() => {
    env.ENABLE_PAGE_COLLAB = true;
  });

  it('bootstraps the room from the stored page and replaces it through the room', async () => {
    const result = await createRuntime().initPage({ markdown: '# Fresh\n\nnew body' }, ctx);

    expect(result.success).toBe(true);
    expect(result.state).toMatchObject({ changed: true, documentId: 'doc_1' });
    expect(room.pushes[0]).toMatchObject({ bootstrap: true });
    expect(room.pushes[1]).toMatchObject({ actor: 'agent:u1' });

    const projected = await projectPageState(Y.encodeStateAsUpdate(room.doc));
    expect(projected.markdown).toContain('new body');
    expect(projected.markdown).not.toContain('para one');
    expect(projected.title).toBe('Fresh');
  });

  it('persists the edit right away as one AI version of the agent run', async () => {
    await createRuntime().initPage({ markdown: '# Fresh\n\nnew body' }, ctx);

    expect(store.updates).toHaveLength(1);
    expect(store.updates[0].params).toMatchObject({
      history: { agentId: 'agt_1', editorIds: ['u1'], operationId: 'op_root' },
      origin: 'room-projection',
      saveSource: 'llm_call',
    });
    expect(store.updates[0].params.content).toContain('new body');
  });
});

describe('pageAgentRuntime initPage without collaboration', () => {
  beforeEach(() => {
    env.ENABLE_PAGE_COLLAB = false;
  });

  it('writes the stored page directly, guarded by the version it read', async () => {
    const result = await createRuntime().initPage({ markdown: '# Fresh\n\nnew body' }, ctx);

    expect(result.success).toBe(true);
    expect(room.pushes).toHaveLength(0);
    expect(store.updates).toHaveLength(1);
    expect(store.updates[0].params).toMatchObject({
      expectedUpdatedAt: store.row.updatedAt,
      history: { agentId: 'agt_1', editorIds: ['u1'], operationId: 'op_root' },
      saveSource: 'llm_call',
      title: 'Fresh',
    });
    expect(store.updates[0].params.origin).toBeUndefined();
    expect(store.updates[0].params.content).toContain('new body');
  });
});

describe('pageAgentRuntime initPage on a SKILL.md', () => {
  beforeEach(() => {
    env.ENABLE_PAGE_COLLAB = true;
    store.row = {
      content: '---\nname: my-skill\ndescription: Does things\n---\n\nold body\n',
      editorData: null,
      filename: 'SKILL.md',
      title: 'SKILL.md',
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    };
  });

  it('writes the stored page directly and keeps its frontmatter', async () => {
    await createRuntime().initPage({ markdown: 'new body' }, ctx);

    expect(room.pushes).toHaveLength(0);
    expect(store.updates[0].params.content).toMatch(
      /^---\nname: my-skill\ndescription: Does things\n---\n\nnew body/,
    );
  });
});
