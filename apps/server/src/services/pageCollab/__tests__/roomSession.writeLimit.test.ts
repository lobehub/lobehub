// @vitest-environment node
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { persistPageState } from '../persist';
import { RoomPageSessions } from '../roomSession';
import type { PageWriter } from '../session';

const { fork, pushUpdate, state } = vi.hoisted(() => ({
  fork: {
    destroy: vi.fn(),
    diff: vi.fn(() => new Uint8Array([1])),
    doc: { getMap: () => ({ set: vi.fn() }) },
    editor: { export: vi.fn() },
    hasChanges: vi.fn(() => true),
  },
  pushUpdate: vi.fn(),
  state: { update: new Uint8Array() },
}));

vi.mock('@/business/server/document/writeLimit', () => ({
  checkDocumentCharLimit: async ({ charCount }: { charCount: number }) =>
    charCount > 10 ? { allowed: false, limit: 10, plan: 'free' } : { allowed: true },
}));

vi.mock('@/server/services/document', () => ({ DocumentService: class {} }));

vi.mock('../fork', () => ({
  openPageFork: async () => fork,
  PAGE_META_KEY: 'meta',
  readPageTitle: () => 'Title',
}));

vi.mock('../persist', () => ({ persistPageState: vi.fn() }));

vi.mock('../roomClient', () => ({
  createPageRoomClient: () => ({
    getState: async () => ({ bootstrapped: true, update: state.update }),
    pushUpdate,
  }),
  PageRoomConflictError: class extends Error {},
}));

vi.mock('yjs', () => ({ encodeStateAsUpdate: () => new Uint8Array() }));

const writerOf = (writeSource: PageWriter['writeSource']): PageWriter => ({
  saveSource: 'llm_call',
  userId: 'u1',
  workspaceId: 'ws_1',
  writeSource,
});

/** Opens a session whose page is `before` long, then edits it to `after`. */
const commitWith = async (
  writeSource: PageWriter['writeSource'],
  before: number,
  after: number,
) => {
  fork.editor.export.mockReturnValueOnce({ markdown: 'x'.repeat(before) });
  const session = await new RoomPageSessions({} as any, writerOf(writeSource)).openLiveSession(
    'doc_1',
  );
  fork.editor.export.mockReturnValue({ markdown: 'x'.repeat(after) });
  return session!.commit();
};

describe('RoomPageSessions character limit', () => {
  beforeEach(() => {
    pushUpdate.mockReset();
    fork.editor.export.mockReset();
    vi.mocked(persistPageState).mockReset();
  });

  it('refuses a commit that grows the page over the limit and pushes nothing', async () => {
    await expect(commitWith('agent', 5, 20)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(pushUpdate).not.toHaveBeenCalled();
  });

  it('allows a commit that shrinks a page already over the limit', async () => {
    await expect(commitWith('agent', 30, 20)).resolves.toBe(true);
    expect(pushUpdate).toHaveBeenCalledTimes(1);
  });

  it('allows a commit under the limit', async () => {
    await expect(commitWith('user', 2, 8)).resolves.toBe(true);
    expect(pushUpdate).toHaveBeenCalledTimes(1);
  });

  it('exempts a system writer', async () => {
    await expect(commitWith('system', 5, 500)).resolves.toBe(true);
    expect(pushUpdate).toHaveBeenCalledTimes(1);
  });

  it('persists under the writer source, so a system write is not refused by the projection', async () => {
    await commitWith('system', 5, 500);

    expect(vi.mocked(persistPageState).mock.calls[0][3]).toMatchObject({ writeSource: 'system' });
  });
});

describe('RoomPageSessions.persistAs character limit', () => {
  const openSession = async () => {
    fork.editor.export.mockReturnValue({ markdown: 'x' });
    return (await new RoomPageSessions({} as any, writerOf('user')).openLiveSession('doc_1'))!;
  };

  it('reports a version refused for its length instead of a saved one', async () => {
    const refusal = new TRPCError({
      cause: { data: { actual: 20, code: 'DocumentCharLimitExceeded', limit: 10 } },
      code: 'BAD_REQUEST',
    });
    vi.mocked(persistPageState).mockRejectedValue(refusal);

    await expect((await openSession()).persistAs('manual')).rejects.toBe(refusal);
  });

  it('keeps other persist failures quiet: the room still holds the edit', async () => {
    vi.mocked(persistPageState).mockRejectedValue(new Error('db down'));

    await expect((await openSession()).persistAs('manual')).resolves.toBeUndefined();
  });
});
