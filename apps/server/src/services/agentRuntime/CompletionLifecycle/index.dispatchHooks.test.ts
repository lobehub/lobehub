// @vitest-environment node
import { ChatErrorType } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as WorkRegistrationModule from '@/server/services/workRegistration';

import { CriticalHookDeliveryError, hookDispatcher } from '../hooks';
import { CompletionLifecycle } from '.';
import { mockSettleRunningOperation } from './testUtils';

vi.mock('@/database/models/work', () => import('./testUtils').then((m) => m.workModelModule()));
vi.mock('@/database/models/topic', () => import('./testUtils').then((m) => m.topicModelModule()));
vi.mock('@/business/server/agent-run/agentInterventionReview', () =>
  import('./testUtils').then((m) => m.agentInterventionReviewModule()),
);
vi.mock('@/business/server/agent-run/notifyAgentRunCompleted', () =>
  import('./testUtils').then((m) => m.notifyAgentRunCompletedModule()),
);
vi.mock('../agentInterventionNotification', () =>
  import('./testUtils').then((m) => m.agentInterventionNotificationModule()),
);
vi.mock('@/server/services/workRegistration', async (importOriginal) => ({
  // Keep the real scope resolver: it is pure, and the share-visitor test
  // asserts the scope it derives reaches both the scan and the anchor lookup.
  ...(await importOriginal<typeof WorkRegistrationModule>()),
  registerWorksForOperation: vi.fn(),
}));

const buildLifecycle = () => new CompletionLifecycle({} as any, 'user-1');

describe('CompletionLifecycle.dispatchHooks — error persistence', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('persists budget errors without downgrading them to AgentRuntimeError', async () => {
    const lifecycle = buildLifecycle();
    const updateMessage = vi.fn().mockResolvedValue({ success: true });
    const budget = { required: 12 };

    (lifecycle as any).messageModel = { update: updateMessage };
    vi.spyOn(lifecycle as any, 'persistCompletion').mockResolvedValue(undefined);
    vi.spyOn(hookDispatcher, 'dispatch').mockResolvedValue(undefined as any);
    vi.spyOn(hookDispatcher, 'unregister').mockImplementation(function () {});

    await lifecycle.dispatchHooks(
      'op-1',
      {
        error: {
          budget,
          error: { message: 'Budget exceeded' },
          errorType: ChatErrorType.FreePlanLimit,
          provider: 'lobehub',
        },
        metadata: { assistantMessageId: 'msg-1' },
        host: { hooks: [] },
        status: 'error',
      },
      'error',
    );

    expect(updateMessage).toHaveBeenCalledWith('msg-1', {
      error: expect.objectContaining({
        body: expect.objectContaining({
          budget,
          message: 'Budget exceeded',
          provider: 'lobehub',
        }),
        message: 'Budget exceeded',
        type: ChatErrorType.FreePlanLimit,
      }),
    });
  });

  it("writes the error onto the run's own assistant row when a server run carries no assistantMessageId", async () => {
    // A server `execAgent` turn leaves `metadata.assistantMessageId` unset; with
    // no client online (a closed tab, a bot, a schedule) nothing else writes
    // the error, so the reply row would stay an empty bubble.
    const lifecycle = buildLifecycle();
    const updateMessage = vi.fn().mockResolvedValue({ success: true });
    const findLatestAssistantByOperationId = vi.fn().mockResolvedValue({ id: 'msg-run' });

    (lifecycle as any).messageModel = { findLatestAssistantByOperationId, update: updateMessage };
    vi.spyOn(lifecycle as any, 'persistCompletion').mockResolvedValue(undefined);
    vi.spyOn(hookDispatcher, 'dispatch').mockResolvedValue(undefined as any);
    vi.spyOn(hookDispatcher, 'unregister').mockImplementation(function () {});

    await lifecycle.dispatchHooks(
      'op-1',
      {
        error: {
          error: { reason: 'claim_timeout', recoverable: true },
          errorType: 'ClientLlmExecutorUnavailable',
          provider: 'lmstudio',
        },
        host: { hooks: [] },
        metadata: {},
        origin: { topicId: 'tpc-1' },
        status: 'error',
      },
      'error',
    );

    expect(findLatestAssistantByOperationId).toHaveBeenCalledWith({
      operationId: 'op-1',
      topicId: 'tpc-1',
    });
    expect(updateMessage).toHaveBeenCalledWith('msg-run', {
      error: expect.objectContaining({ type: 'ClientLlmExecutorUnavailable' }),
    });
  });

  it('rethrows critical webhook failures after terminal persistence', async () => {
    const lifecycle = buildLifecycle();
    const persistCompletion = vi
      .spyOn(lifecycle as any, 'persistCompletion')
      .mockResolvedValue(undefined);
    const dispatch = vi
      .spyOn(hookDispatcher, 'dispatch')
      .mockRejectedValue(
        new CriticalHookDeliveryError('task-on-complete', new Error('qstash down')),
      );
    vi.spyOn(hookDispatcher, 'unregister').mockImplementation(function () {});

    await expect(
      lifecycle.dispatchHooks(
        'op-1',
        { host: { hooks: [] }, status: 'interrupted' },
        'interrupted',
      ),
    ).rejects.toThrow('Critical webhook delivery failed: task-on-complete');

    expect(persistCompletion).toHaveBeenCalledBefore(dispatch);
  });

  it('does not dispatch hooks when another owner already interrupted the operation', async () => {
    const lifecycle = buildLifecycle();
    vi.spyOn(lifecycle as any, 'persistCompletion').mockResolvedValue(false);
    const dispatch = vi.spyOn(hookDispatcher, 'dispatch').mockResolvedValue(undefined as any);
    vi.spyOn(hookDispatcher, 'unregister').mockImplementation(function () {});

    await lifecycle.dispatchHooks('op-reclaimed', { host: { hooks: [] }, status: 'done' }, 'done');

    expect(dispatch).not.toHaveBeenCalled();
  });

  describe('a row the caller already retired as abandoned', () => {
    // Mirrors `recordCompletion`'s guard: a row the stale-lease CAS moved to
    // `abandoned` only accepts a write that keeps that status.
    const retiredRowModel = () => ({
      findById: vi.fn(async () => ({ id: 'op-stale', status: 'abandoned' })),
      recordCompletion: vi.fn(async (_id: string, params: { status: string }) => {
        return params.status === 'abandoned';
      }),
      sumChildUsage: vi.fn(async () => undefined),
    });

    it('persists onto the abandoned status and still fires the hooks', async () => {
      const lifecycle = buildLifecycle();
      const model = retiredRowModel();
      (lifecycle as any).agentOperationModel = model;
      const dispatch = vi.spyOn(hookDispatcher, 'dispatch').mockResolvedValue(undefined as any);
      vi.spyOn(hookDispatcher, 'unregister').mockImplementation(function () {});

      await lifecycle.dispatchHooks('op-stale', { host: { hooks: [] }, status: 'error' }, 'error', {
        settledAsAbandoned: true,
        skipErrorMessageWrite: true,
      });

      expect(model.recordCompletion).toHaveBeenCalledWith(
        'op-stale',
        expect.objectContaining({ completionReason: 'lease_expired', status: 'abandoned' }),
      );
      expect(dispatch).toHaveBeenCalled();
    });

    it('is refused as a conflicting owner without the flag, so no hooks fire', async () => {
      const lifecycle = buildLifecycle();
      (lifecycle as any).agentOperationModel = retiredRowModel();
      const dispatch = vi.spyOn(hookDispatcher, 'dispatch').mockResolvedValue(undefined as any);
      vi.spyOn(hookDispatcher, 'unregister').mockImplementation(function () {});

      await lifecycle.dispatchHooks('op-stale', { host: { hooks: [] }, status: 'error' }, 'error', {
        skipErrorMessageWrite: true,
      });

      expect(dispatch).not.toHaveBeenCalled();
    });
  });
});

describe('CompletionLifecycle.dispatchHooks — the topic running mark', () => {
  /**
   * `recordCompletion` must land for the mark to be converged: the lifecycle
   * treats an ending whose own row write failed as unproven, and a mark cleared
   * on an unproven ending reads settled while `agent_operations` still says
   * `running`.
   */
  const acceptingOperationModel = () => ({
    findById: vi.fn(async () => null),
    recordCompletion: vi.fn(async () => true),
    sumChildUsage: vi.fn(async () => undefined),
  });

  const state = (overrides: Record<string, unknown> = {}) => ({
    host: { hooks: [] },
    messages: [{ content: 'final reply', role: 'assistant' }],
    origin: { agentId: 'agt_1', topicId: 'tpc_1' },
    status: 'interrupted',
    ...overrides,
  });

  beforeEach(() => {
    mockSettleRunningOperation.mockReset().mockResolvedValue({ status: 'settled' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('drops the mark when an interrupted run reaches its terminal row', async () => {
    const lifecycle = buildLifecycle();
    (lifecycle as any).agentOperationModel = acceptingOperationModel();

    await lifecycle.dispatchHooks('op-1', state(), 'interrupted');

    // A Stop is a visible ending the user already saw: `active`, the same status
    // the client writes for an interrupted run.
    expect(mockSettleRunningOperation).toHaveBeenCalledWith('tpc_1', 'op-1', 'active');
  });

  it('drops the mark for a clean finish, as unread', async () => {
    const lifecycle = buildLifecycle();
    (lifecycle as any).agentOperationModel = acceptingOperationModel();

    await lifecycle.dispatchHooks('op-1', state({ status: 'done' }), 'done');

    expect(mockSettleRunningOperation).toHaveBeenCalledWith('tpc_1', 'op-1', 'unread');
  });

  it('drops the mark for a run the step cap stopped, which never runs `finish`', async () => {
    const lifecycle = buildLifecycle();
    (lifecycle as any).agentOperationModel = acceptingOperationModel();

    await lifecycle.dispatchHooks('op-1', state({ status: 'done' }), 'max_steps');

    expect(mockSettleRunningOperation).toHaveBeenCalledWith('tpc_1', 'op-1', 'unread');
  });

  it.each(['waiting_for_async_tool', 'waiting_for_client', 'waiting_for_human'])(
    'leaves the mark while the same operation is parked in %s',
    async (reason) => {
      const lifecycle = buildLifecycle();
      (lifecycle as any).agentOperationModel = acceptingOperationModel();

      await lifecycle.dispatchHooks('op-1', state({ status: reason }), reason);

      expect(mockSettleRunningOperation).not.toHaveBeenCalled();
    },
  );

  it('does nothing for a run with no topic', async () => {
    const lifecycle = buildLifecycle();
    (lifecycle as any).agentOperationModel = acceptingOperationModel();

    await lifecycle.dispatchHooks('op-1', state({ origin: { agentId: 'agt_1' } }), 'interrupted');

    expect(mockSettleRunningOperation).not.toHaveBeenCalled();
  });

  it('leaves a lease-expired abandon to the path that settles it', async () => {
    const lifecycle = buildLifecycle();
    (lifecycle as any).agentOperationModel = {
      findById: vi.fn(async () => ({ id: 'op-1', status: 'abandoned' })),
      recordCompletion: vi.fn(
        async (_id: string, params: { status: string }) => params.status === 'abandoned',
      ),
      sumChildUsage: vi.fn(async () => undefined),
    };

    await lifecycle.dispatchHooks('op-1', state({ status: 'error' }), 'error', {
      settledAsAbandoned: true,
      skipErrorMessageWrite: true,
    });

    // `AbandonOperationService` owns the topic there, with its own status.
    expect(mockSettleRunningOperation).not.toHaveBeenCalled();
  });

  it('leaves the mark when the terminal row could not be written', async () => {
    const lifecycle = buildLifecycle();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    (lifecycle as any).agentOperationModel = {
      findById: vi.fn(async () => null),
      recordCompletion: vi.fn(async () => {
        throw new Error('db is down');
      }),
      sumChildUsage: vi.fn(async () => undefined),
    };

    await lifecycle.dispatchHooks('op-1', state(), 'interrupted');

    // The operation's own end is unproven, so the topic must keep saying so.
    expect(mockSettleRunningOperation).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('leaves the mark when no durable row exists to prove the ending', async () => {
    const lifecycle = buildLifecycle();
    (lifecycle as any).agentOperationModel = {
      findById: vi.fn(async () => null),
      recordCompletion: vi.fn(async () => false),
      sumChildUsage: vi.fn(async () => undefined),
    };

    await lifecycle.dispatchHooks('op-1', state(), 'interrupted');

    expect(mockSettleRunningOperation).not.toHaveBeenCalled();
  });

  it('still converges when another owner already wrote the terminal row', async () => {
    const lifecycle = buildLifecycle();
    const dispatch = vi.spyOn(hookDispatcher, 'dispatch').mockResolvedValue(undefined as any);
    vi.spyOn(hookDispatcher, 'unregister').mockImplementation(function () {});
    (lifecycle as any).agentOperationModel = {
      findById: vi.fn(async () => ({ id: 'op-1', status: 'interrupted' })),
      recordCompletion: vi.fn(async () => false),
      sumChildUsage: vi.fn(async () => undefined),
    };

    await lifecycle.dispatchHooks('op-1', state(), 'interrupted');

    // The run is over — someone else just recorded it — and hooks still stay
    // parked with that owner.
    expect(mockSettleRunningOperation).toHaveBeenCalledWith('tpc_1', 'op-1', 'active');
    expect(dispatch).not.toHaveBeenCalled();
  });

  /**
   * Two terminal callbacks can race for the same operation: `recordCompletion`
   * accepts the first and refuses the second — its `where` matches every
   * in-flight status plus an equal one, so a refusal proves the row already
   * landed and carries a DIFFERENT outcome. The topic must then be settled for
   * what landed. Settling for the late callback instead would flip `unread`
   * (a clean finish) to `active` (an interruption) or the other way round,
   * depending purely on which of the two reached its settle first.
   */
  it('settles for a `done` row when a late `interrupted` callback loses the race', async () => {
    const lifecycle = buildLifecycle();
    (lifecycle as any).agentOperationModel = {
      findById: vi.fn(async () => ({ id: 'op-1', status: 'done' })),
      recordCompletion: vi.fn(async () => false),
      sumChildUsage: vi.fn(async () => undefined),
    };

    await lifecycle.dispatchHooks('op-1', state({ status: 'interrupted' }), 'interrupted');

    // The run finished cleanly, so the user may not have watched it.
    expect(mockSettleRunningOperation).toHaveBeenCalledWith('tpc_1', 'op-1', 'unread');
  });

  it('settles for an `interrupted` row when a late `done` callback loses the race', async () => {
    const lifecycle = buildLifecycle();
    (lifecycle as any).agentOperationModel = {
      findById: vi.fn(async () => ({ id: 'op-1', status: 'interrupted' })),
      recordCompletion: vi.fn(async () => false),
      sumChildUsage: vi.fn(async () => undefined),
    };

    await lifecycle.dispatchHooks('op-1', state({ status: 'done' }), 'done');

    // The stopping point was a visible interruption, not a clean finish.
    expect(mockSettleRunningOperation).toHaveBeenCalledWith('tpc_1', 'op-1', 'active');
  });

  it('leaves the mark when the refused row is not an ending either', async () => {
    const lifecycle = buildLifecycle();
    (lifecycle as any).agentOperationModel = {
      // `idle` is outside `recordCompletion`'s in-flight set, so a row that
      // never started can refuse a terminal write while still not being over.
      findById: vi.fn(async () => ({ id: 'op-1', status: 'idle' })),
      recordCompletion: vi.fn(async () => false),
      sumChildUsage: vi.fn(async () => undefined),
    };

    await lifecycle.dispatchHooks('op-1', state({ status: 'done' }), 'done');

    expect(mockSettleRunningOperation).not.toHaveBeenCalled();
  });

  it('treats losing the race to a newer run as a no-op', async () => {
    const lifecycle = buildLifecycle();
    (lifecycle as any).agentOperationModel = acceptingOperationModel();
    mockSettleRunningOperation.mockResolvedValue({ status: 'conflict' });

    await expect(lifecycle.dispatchHooks('op-1', state(), 'interrupted')).resolves.toBeUndefined();

    expect(mockSettleRunningOperation).toHaveBeenCalledTimes(1);
  });

  it('never fails the completion when the topic cannot be settled', async () => {
    const lifecycle = buildLifecycle();
    (lifecycle as any).agentOperationModel = acceptingOperationModel();
    mockSettleRunningOperation.mockRejectedValue(new Error('topic row is locked'));

    await expect(lifecycle.dispatchHooks('op-1', state(), 'interrupted')).resolves.toBeUndefined();
  });
});
