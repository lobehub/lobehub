// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  enqueueHeteroControl,
  readHeteroControlResult,
} from '@/server/services/aiAgent/steerQueue/heteroControl';
import { createHeteroControlFakeRedis } from '@/server/services/redis/heteroControl.fake';

import { heteroRouter } from './hetero';

const mocks = vi.hoisted(() => ({
  getRedisServiceClient: vi.fn(),
  operation: undefined as Record<string, unknown> | undefined,
  readFollowUpMode: vi.fn(),
  renewHeteroSteers: vi.fn(),
  takeHeteroSteer: vi.fn(),
}));

vi.mock('@/server/services/redis/client', () => ({
  getRedisServiceClient: mocks.getRedisServiceClient,
}));
vi.mock('@/server/services/aiAgent/steerQueue/hetero', () => ({
  renewHeteroSteers: mocks.renewHeteroSteers,
  returnHeteroSteer: vi.fn(),
  takeHeteroSteer: mocks.takeHeteroSteer,
}));
vi.mock('@/server/services/aiAgent/steerQueue/followUpMode', () => ({
  readFollowUpMode: mocks.readFollowUpMode,
}));
vi.mock('./procedures', async () => {
  const { trpc } = await import('@/libs/trpc/lambda/init');
  // The operation row every `select().from().where().limit()` reads.
  const serverDB = {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => (mocks.operation ? [mocks.operation] : []) }),
      }),
    }),
  };
  const procedure = trpc.procedure.use((opts) =>
    opts.next({ ctx: { ...opts.ctx, serverDB: serverDB as never } }),
  );
  return {
    aiAgentBaseProcedure: procedure,
    aiAgentWriteProcedure: procedure,
    heteroAgentProcedure: procedure,
  };
});

const caller = heteroRouter.createCaller({ heteroAuthKind: 'user', userId: 'user-1' } as never);

const mainRun = {
  agentId: 'agent-1',
  parentOperationId: null,
  threadId: null,
  topicId: 'topic-1',
  userId: 'user-1',
  workspaceId: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getRedisServiceClient.mockResolvedValue(createHeteroControlFakeRedis());
  mocks.operation = mainRun;
  mocks.takeHeteroSteer.mockResolvedValue(undefined);
  mocks.readFollowUpMode.mockResolvedValue('legacy');
});

describe('waitHeteroSteer and the Follow-up behavior', () => {
  it('takes no follow-up into the live session in Queue mode', async () => {
    mocks.readFollowUpMode.mockResolvedValue('queue');
    mocks.takeHeteroSteer.mockResolvedValue({ content: 'hi', messageId: 'msg-1' });

    expect(await caller.waitHeteroSteer({ blockMs: 1, operationId: 'op-1' })).toEqual({
      message: null,
    });
    expect(mocks.takeHeteroSteer).not.toHaveBeenCalled();
  });

  it('hands out no follow-up while the session waits for the user', async () => {
    mocks.readFollowUpMode.mockResolvedValue('steer');

    await caller.waitHeteroSteer({ blockMs: 1, holdSteer: true, operationId: 'op-1' });

    expect(mocks.takeHeteroSteer).not.toHaveBeenCalled();
  });

  it('asks for a merged steer in Steer mode', async () => {
    mocks.readFollowUpMode.mockResolvedValue('steer');

    await caller.waitHeteroSteer({ blockMs: 1, operationId: 'op-1' });

    expect(mocks.takeHeteroSteer).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ mode: 'steer', operationId: 'op-1' }),
    );
  });
});

describe('waitHeteroSteer control messages', () => {
  it('answers an older poller exactly as before, and hands it no control message', async () => {
    const id = await enqueueHeteroControl('op-1', 'test_command', { a: 1 });

    const empty = await caller.waitHeteroSteer({ blockMs: 1, operationId: 'op-1' });
    expect(empty).toEqual({ message: null });
    expect(Object.keys(empty)).toEqual(['message']);

    const steer = { content: 'hi', messageId: 'msg-1' };
    mocks.takeHeteroSteer.mockResolvedValueOnce(steer);
    expect(await caller.waitHeteroSteer({ blockMs: 1, operationId: 'op-1' })).toEqual({
      message: steer,
    });

    // Still waiting for a poller that takes it.
    expect(await readHeteroControlResult('op-1', id)).toEqual({ status: 'pending' });
  });

  it('keeps the child-run answer for an older poller', async () => {
    mocks.operation = { ...mainRun, parentOperationId: 'parent-op' };
    await enqueueHeteroControl('op-1', 'test_command');

    expect(await caller.waitHeteroSteer({ blockMs: 1, operationId: 'op-1' })).toEqual({
      message: null,
      steerable: false,
    });
  });

  it('hands a control message to a poller that declares acceptsControl, once', async () => {
    const id = await enqueueHeteroControl('op-1', 'test_command', { a: 1 });

    const first = await caller.waitHeteroSteer({
      acceptsControl: true,
      blockMs: 1,
      operationId: 'op-1',
    });
    expect(first).toEqual({
      control: { command: 'test_command', createdAt: expect.any(Number), id, params: { a: 1 } },
      message: null,
    });
    expect(await readHeteroControlResult('op-1', id)).toEqual({ status: 'claimed' });

    expect(
      await caller.waitHeteroSteer({ acceptsControl: true, blockMs: 1, operationId: 'op-1' }),
    ).toEqual({ control: null, message: null });
  });

  it('delivers control ahead of a waiting follow-up', async () => {
    const id = await enqueueHeteroControl('op-1', 'test_command');
    const steer = { content: 'hi', messageId: 'msg-1' };
    mocks.takeHeteroSteer.mockResolvedValue(steer);

    const first = await caller.waitHeteroSteer({
      acceptsControl: true,
      blockMs: 1,
      operationId: 'op-1',
    });
    expect(first.control?.id).toBe(id);
    expect(first.message).toBeNull();
    expect(mocks.takeHeteroSteer).not.toHaveBeenCalled();

    expect(
      await caller.waitHeteroSteer({ acceptsControl: true, blockMs: 1, operationId: 'op-1' }),
    ).toEqual({ control: null, message: steer });
  });

  it('serves control messages to a child run without taking follow-ups', async () => {
    mocks.operation = { ...mainRun, parentOperationId: 'parent-op' };
    const id = await enqueueHeteroControl('op-1', 'test_command');

    const answer = await caller.waitHeteroSteer({
      acceptsControl: true,
      blockMs: 1,
      operationId: 'op-1',
    });
    expect(answer).toMatchObject({ control: { id }, message: null, steerable: false });
    expect(
      await caller.waitHeteroSteer({ acceptsControl: true, blockMs: 1, operationId: 'op-1' }),
    ).toEqual({ control: null, message: null, steerable: false });
    expect(mocks.takeHeteroSteer).not.toHaveBeenCalled();
    expect(mocks.renewHeteroSteers).not.toHaveBeenCalled();
  });

  it('claims nothing for a poller that already went away', async () => {
    const id = await enqueueHeteroControl('op-1', 'test_command');
    const gone = new AbortController();
    gone.abort();
    const abandoned = heteroRouter.createCaller(
      { heteroAuthKind: 'user', userId: 'user-1' } as never,
      { signal: gone.signal },
    );

    expect(
      await abandoned.waitHeteroSteer({ acceptsControl: true, blockMs: 1, operationId: 'op-1' }),
    ).toEqual({ control: null, message: null });
    expect(await readHeteroControlResult('op-1', id)).toEqual({ status: 'pending' });
  });

  it('stops holding the poll once the poller goes away', async () => {
    const leaving = new AbortController();
    const held = heteroRouter
      .createCaller({ heteroAuthKind: 'user', userId: 'user-1' } as never, {
        signal: leaving.signal,
      })
      .waitHeteroSteer({ acceptsControl: true, blockMs: 20_000, operationId: 'op-1' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const id = await enqueueHeteroControl('op-1', 'test_command');
    leaving.abort();

    expect(await held).toEqual({ control: null, message: null });
    expect(await readHeteroControlResult('op-1', id)).toEqual({ status: 'pending' });
  });

  it("refuses another user's operation", async () => {
    mocks.operation = { ...mainRun, userId: 'someone-else' };
    await expect(
      caller.waitHeteroSteer({ acceptsControl: true, blockMs: 1, operationId: 'op-1' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('reportHeteroControlResult', () => {
  const claimOne = async () => {
    const id = await enqueueHeteroControl('op-1', 'test_command');
    await caller.waitHeteroSteer({ acceptsControl: true, blockMs: 1, operationId: 'op-1' });
    return id;
  };

  it.each([
    [{ data: { done: true }, status: 'ok' as const }],
    [{ status: 'unsupported' as const }],
    [{ error: 'handler failed', status: 'error' as const }],
  ])('stores %o for the queuing code to read', async (report) => {
    const id = await claimOne();

    expect(
      await caller.reportHeteroControlResult({ controlId: id, operationId: 'op-1', ...report }),
    ).toEqual({ outcome: 'recorded' });
    expect(await readHeteroControlResult('op-1', id)).toEqual(report);
  });

  it('keeps the first report', async () => {
    const id = await claimOne();
    await caller.reportHeteroControlResult({ controlId: id, operationId: 'op-1', status: 'ok' });

    expect(
      await caller.reportHeteroControlResult({
        controlId: id,
        error: 'late',
        operationId: 'op-1',
        status: 'error',
      }),
    ).toEqual({ outcome: 'ok' });
    expect(await readHeteroControlResult('op-1', id)).toEqual({ status: 'ok' });
  });

  it('rejects an error report without a message', async () => {
    const id = await claimOne();
    await expect(
      caller.reportHeteroControlResult({
        controlId: id,
        operationId: 'op-1',
        status: 'error',
      } as never),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it("refuses another user's operation", async () => {
    const id = await claimOne();
    mocks.operation = { ...mainRun, userId: 'someone-else' };
    await expect(
      caller.reportHeteroControlResult({ controlId: id, operationId: 'op-1', status: 'ok' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await readHeteroControlResult('op-1', id)).toEqual({ status: 'claimed' });
  });
});
