// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SteerQueueWriteUnknownError } from '@/server/services/redis/steerQueue';

import { agentSteerQueueRouter } from '../agentSteerQueue';

const mocks = vi.hoisted(() => ({
  append: vi.fn(),
  entryState: vi.fn(),
  isRunningOperationAlive: vi.fn(),
  list: vi.fn(),
  liveCandidates: vi.fn(),
  remove: vi.fn(),
  resolveAgentSender: vi.fn(),
  snapshot: vi.fn(),
}));

vi.mock('@/server/services/aiAgent/agentSenderResolver', () => ({
  resolveAgentSender: mocks.resolveAgentSender,
}));

vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn().mockImplementation(function () {
    return { isRunningOperationAlive: mocks.isRunningOperationAlive };
  }),
}));
vi.mock('@/server/services/redis', () => ({
  redisService: {
    steerQueue: {
      append: mocks.append,
      entryState: mocks.entryState,
      remove: mocks.remove,
      snapshot: mocks.snapshot,
    },
  },
}));
vi.mock('@/server/routers/lambda/_helpers/workspaceAgentGuard', () => ({
  assertCanUseWorkspaceAgent: vi.fn(),
}));
vi.mock('@/server/routers/lambda/aiAgent/guards', () => ({
  assertCanUseAgentRunConversation: vi.fn(),
}));
vi.mock('@/business/server/trpc-middlewares/rbacPermission', async () => {
  const mod = await vi.importActual<{ trpc: any }>('@/libs/trpc/lambda/init');
  return { withScopedPermission: () => mod.trpc.middleware(async (opts: any) => opts.next()) };
});
vi.mock('@/business/server/trpc-middlewares/workspaceAuth', async () => {
  const mod = await vi.importActual<{ trpc: any }>('@/libs/trpc/lambda/init');
  return { wsCompatProcedure: mod.trpc.procedure };
});
vi.mock('@/libs/trpc/lambda/middleware', () => ({
  serverDatabase: async (opts: any) => opts.next({ ctx: opts.ctx }),
}));

// The scope / owner / status filtering itself runs against a real DB in
// agentSteerQueue.liveness.test.ts; here the query only yields candidates.
const serverDB = {
  select: () => ({
    from: () => ({
      where: () => ({ orderBy: () => ({ limit: async () => mocks.liveCandidates() }) }),
    }),
  }),
};

const caller = () =>
  agentSteerQueueRouter.createCaller({
    clientIp: '1.2.3.4',
    serverDB,
    userAgent: 'test',
    userId: 'user-1',
  } as any);

const appendInput = {
  id: 'q-1',
  request: {
    agentId: 'agt-1',
    appContext: { projectWorkingDirectoryId: 'pwd-1', topicId: 'tpc-1' },
    prompt: 'also check the tests',
    streamFeatures: ['file_works'],
  },
};

describe('agentSteerQueueRouter.append', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.liveCandidates.mockReturnValue([{ id: 'op-1' }]);
    mocks.isRunningOperationAlive.mockResolvedValue(true);
    mocks.append.mockResolvedValue(1);
    mocks.remove.mockResolvedValue(true);
    mocks.entryState.mockResolvedValue('absent');
  });

  // ROOT CAUSE:
  //
  // A retry of an append whose answer was lost went through the liveness
  // check first. Had the run ended meanwhile, it answered `idle` and the
  // client sent the follow-up itself while the server still held (or had
  // delivered) the first copy — the follow-up ran twice.
  //
  // Before: liveness decided first.
  // After: what the server already holds for that id decides.
  it.each([
    ['still waiting', 'queued', 1],
    ['being delivered', 'delivering', 0],
    ['delivered', 'taken', 0],
  ] as const)(
    'answers a retry of an entry %s as queued, whatever the run',
    async (_l, state, length) => {
      mocks.entryState.mockResolvedValue(state);
      mocks.liveCandidates.mockReturnValue([]);

      // `state` lets a client tell delivered (`taken`) from still on its way.
      await expect(caller().append(appendInput)).resolves.toEqual({
        id: 'q-1',
        length,
        queued: true,
        state,
      });
      expect(mocks.append).not.toHaveBeenCalled();
    },
  );

  it('queues behind the caller’s own live run, keeping only what a later turn can use', async () => {
    await expect(caller().append(appendInput)).resolves.toEqual({
      id: 'q-1',
      length: 1,
      queued: true,
      state: 'queued',
    });

    const [scope, entry, behindOperationId] = mocks.append.mock.calls[0];
    expect(behindOperationId).toBe('op-1');
    expect(scope).toEqual({ threadId: null, topicId: 'tpc-1', userId: 'user-1' });
    expect(entry).toMatchObject({
      audit: { clientIp: '1.2.3.4', userAgent: 'test' },
      id: 'q-1',
      request: {
        acceptsFileWorks: true,
        acceptsMemberRuntimeEnd: false,
        prompt: 'also check the tests',
      },
      userId: 'user-1',
    });
    expect(entry.request.appContext.projectWorkingDirectoryId).toBeUndefined();
    expect(entry.request.streamFeatures).toBeUndefined();
  });

  it('stores the sending agent, resolved while its run can still vouch for it', async () => {
    const sender = { agentId: 'agt-writer', hop: 2, topicId: 'tpc-writer' };
    mocks.resolveAgentSender.mockResolvedValue(sender);

    await caller().append({
      ...appendInput,
      request: { ...appendInput.request, sourceOperationId: 'op-writer' },
    });

    expect(mocks.resolveAgentSender).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1' }),
      { destinationAgentId: 'agt-1', sourceOperationId: 'op-writer' },
    );
    const [, entry] = mocks.append.mock.calls[0];
    expect(entry.agentSender).toEqual(sender);
    // The follow-up usually starts after the sending run settled: only the
    // resolved sender is kept, never the operation id.
    expect(entry.request).not.toHaveProperty('sourceOperationId');
  });

  it('refuses an agent send past the relay bound, queueing nothing', async () => {
    mocks.resolveAgentSender.mockResolvedValue({ agentId: 'agt-writer', hop: 6 });

    await expect(
      caller().append({
        ...appendInput,
        request: { ...appendInput.request, sourceOperationId: 'op-writer' },
      }),
    ).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
    expect(mocks.append).not.toHaveBeenCalled();
  });

  it('resolves no sender for a person’s follow-up', async () => {
    await caller().append(appendInput);

    expect(mocks.resolveAgentSender).not.toHaveBeenCalled();
    expect(mocks.append.mock.calls[0][1].agentSender).toBeUndefined();
  });

  it('keeps the composer state it was sent from, up to a cap', async () => {
    const editorData = { root: { children: [], type: 'root' } };
    await caller().append({ ...appendInput, composer: { editorData } });
    expect(mocks.append.mock.calls[0][1].composer).toEqual({ editorData });

    const huge = { root: { text: 'x'.repeat(40 * 1024) } };
    await caller().append({ ...appendInput, composer: { editorData: huge } });
    expect(mocks.append.mock.calls[1][1].composer).toBeUndefined();
  });

  // ROOT CAUSE:
  //
  // One cap over the whole composer state dropped the attachment previews
  // with a long editor document (and the reverse), so a reload lost both.
  //
  // Before: all or nothing.
  // After: each part is kept or dropped on its own.
  it('keeps the attachment previews when only the editor document is too large', async () => {
    const filesPreview = [{ id: 'f1', name: 'a.png' }];
    const huge = { root: { text: 'x'.repeat(40 * 1024) } };

    await caller().append({ ...appendInput, composer: { editorData: huge, filesPreview } });

    expect(mocks.append.mock.calls[0][1].composer).toEqual({
      editorData: undefined,
      filesPreview,
    });
  });

  it('stores a follow-up sent in the old shape with its selections as attached content', async () => {
    const quote = { content: 'Quoted reply', id: 'selection-1', source: 'text' as const };

    await caller().append({
      ...appendInput,
      request: { ...appendInput.request, contextSelections: [quote] },
    });

    const [, entry] = mocks.append.mock.calls[0];
    expect(entry.request.userMessage).toEqual({ metadata: { contextSelections: [quote] } });
    expect(entry.request).not.toHaveProperty('contextSelections');
  });

  it('tells the client to send directly when no run is live', async () => {
    mocks.isRunningOperationAlive.mockResolvedValue(false);

    await expect(caller().append(appendInput)).resolves.toEqual({ queued: false, reason: 'idle' });
    expect(mocks.append).not.toHaveBeenCalled();
  });

  it('does not queue when no own top-level run is on the surface', async () => {
    mocks.liveCandidates.mockReturnValue([]);

    await expect(caller().append(appendInput)).resolves.toEqual({ queued: false, reason: 'idle' });
    expect(mocks.append).not.toHaveBeenCalled();
  });

  it.each(['a\tb', 'a\nb', ''])(
    'rejects an entry id the queue header cannot carry: %j',
    async (id) => {
      await expect(caller().append({ ...appendInput, id })).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });
      expect(mocks.append).not.toHaveBeenCalled();
    },
  );

  it('reports queued for a retry its run already took, so the client does not send it again', async () => {
    mocks.append.mockResolvedValue('taken');

    await expect(caller().append(appendInput)).resolves.toEqual({
      id: 'q-1',
      length: 0,
      queued: true,
      state: 'taken',
    });
  });

  // ROOT CAUSE:
  //
  // A run whose answer is done keeps its row `running` until its last step
  // commits, which took minutes. A follow-up typed behind the next run then saw
  // two live runs and was refused as ambiguous: the client kept it locally, the
  // run handed its turn back without answering, and the follow-up waited for
  // both runs to end.
  //
  // Before: two live runs refused the follow-up.
  // After: it queues behind the newest run, the one the user is looking at.
  it('queues behind the newest run while an older one still reads as live', async () => {
    mocks.liveCandidates.mockReturnValue([{ id: 'op-new' }, { id: 'op-old' }]);

    await expect(caller().append(appendInput)).resolves.toMatchObject({
      queued: true,
      state: 'queued',
    });
    expect(mocks.append).toHaveBeenCalledWith(
      { threadId: null, topicId: 'tpc-1', userId: 'user-1' },
      expect.objectContaining({ id: 'q-1' }),
      'op-new',
    );
  });

  it('answers neither queued nor send-directly when the write outcome is unknown', async () => {
    mocks.append.mockRejectedValue(new SteerQueueWriteUnknownError(new Error('timeout')));

    await expect(caller().append(appendInput)).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
    });
  });

  it('takes the entry back when the run ended after its drain', async () => {
    mocks.isRunningOperationAlive.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await expect(caller().append(appendInput)).resolves.toEqual({ queued: false, reason: 'idle' });
    expect(mocks.remove).toHaveBeenCalledWith(
      { threadId: null, topicId: 'tpc-1', userId: 'user-1' },
      'q-1',
    );
  });

  it('reports queued when the drain already took the entry it tried to take back', async () => {
    mocks.isRunningOperationAlive.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    mocks.remove.mockResolvedValue(false);

    await expect(caller().append(appendInput)).resolves.toMatchObject({ queued: true });
  });

  it.each([
    ['notStored', 'unavailable'],
    ['full', 'full'],
  ] as const)('falls back to a direct send when append returns %s', async (result, reason) => {
    mocks.append.mockResolvedValue(result);

    await expect(caller().append(appendInput)).resolves.toEqual({ queued: false, reason });
  });

  // ROOT CAUSE:
  //
  // A retried append whose earlier try may be stored looked its id up first,
  // but a Redis that could not be read fell through to the liveness
  // check: with the run ended it answered `idle`, and the client sent its copy
  // while the first one could still run later.
  //
  // Before: an unreadable lookup counted as "not there".
  // After: it is an unknown outcome, whatever the run.
  it('answers unknown when the retry lookup cannot read Redis', async () => {
    mocks.entryState.mockResolvedValue(undefined);
    mocks.liveCandidates.mockReturnValue([]);

    await expect(caller().append(appendInput)).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
    });
    expect(mocks.append).not.toHaveBeenCalled();
  });

  // ROOT CAUSE:
  //
  // A Redis outage (circuit open) looked like "not stored", so a retry of an
  // append that had landed earlier was answered `unavailable` and sent by the
  // client while the server still held the first copy.
  //
  // Before: no client meant "send directly".
  // After: no client is an unknown outcome (Redis is a deployment requirement).
  it('answers unknown, not send-directly, while Redis is out', async () => {
    mocks.append.mockResolvedValue(undefined);

    await expect(caller().append(appendInput)).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
    });
  });
});

describe('agentSteerQueueRouter.list / remove', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.snapshot.mockResolvedValue({
      delivering: [],
      waiting: [
        { createdAt: 1, id: 'mine', request: { prompt: 'a' }, userId: 'user-1' },
        { createdAt: 2, id: 'theirs', request: { prompt: 'b' }, userId: 'user-2' },
      ],
    });
  });

  it('lists only the caller’s own follow-ups', async () => {
    await expect(caller().list({ topicId: 'tpc-1' })).resolves.toEqual([
      expect.objectContaining({ createdAt: 1, delivering: false, id: 'mine', prompt: 'a' }),
    ]);
  });

  // ROOT CAUSE:
  //
  // A drained entry left the waiting list before its run confirmed it, so a
  // client treated it as delivered and dropped it, though a failed delivery
  // returns it to the queue — invisible until another run or a reload.
  //
  // Before: only waiting entries were listed.
  // After: taken-but-unconfirmed ones are listed as `delivering`, from one
  // atomic read, with what a reloaded client needs to resend them as typed.
  it('lists follow-ups a run took but has not confirmed as delivering', async () => {
    const composer = { editorData: { root: { type: 'root' } }, filesPreview: [{ id: 'f1' }] };
    mocks.snapshot.mockResolvedValue({
      delivering: [
        {
          composer,
          createdAt: 0,
          id: 'taken',
          request: { prompt: 'z', selectedSkillIds: ['s1'] },
          userId: 'user-1',
        },
        { createdAt: 3, id: 'other', request: { prompt: 'y' }, userId: 'user-2' },
      ],
      waiting: [{ createdAt: 1, id: 'mine', request: { prompt: 'a' }, userId: 'user-1' }],
    });

    await expect(caller().list({ topicId: 'tpc-1' })).resolves.toEqual([
      expect.objectContaining({
        delivering: true,
        editorData: composer.editorData,
        filesPreview: composer.filesPreview,
        id: 'taken',
        selectedSkillIds: ['s1'],
      }),
      expect.objectContaining({ delivering: false, id: 'mine' }),
    ]);
  });

  // ROOT CAUSE:
  //
  // Without a Redis client the entry's state is unknown, but the withdrawal
  // answered `absent`: Delete reported success and Edit / Send now resent a
  // follow-up the server could still deliver.
  //
  // Before: an outage read as "never stored".
  // After: it is an error, so the client keeps the row and retries.
  it('refuses to answer a withdrawal while Redis is out', async () => {
    mocks.entryState.mockResolvedValue(undefined);

    await expect(caller().remove({ id: 'mine', topicId: 'tpc-1' })).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
    });
  });

  it('refuses to list while Redis is out, rather than reporting an empty queue', async () => {
    mocks.snapshot.mockRejectedValue(new Error('Redis is unavailable'));

    await expect(caller().list({ topicId: 'tpc-1' })).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
    });
  });

  it.each([
    ['removed', true],
    ['delivering', false],
    ['taken', false],
    ['absent', false],
  ] as const)('withdraws in one step and says where it is: %s', async (state, removed) => {
    mocks.entryState.mockResolvedValue(state);

    await expect(caller().remove({ id: 'mine', topicId: 'tpc-1' })).resolves.toEqual({
      removed,
      state,
    });
    expect(mocks.entryState).toHaveBeenCalledWith(
      { threadId: null, topicId: 'tpc-1', userId: 'user-1' },
      'mine',
      { remove: true },
    );
  });
});
