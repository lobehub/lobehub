// @vitest-environment node
import { RequestTrigger } from '@lobechat/types';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as verifyServices from '@/server/services/verify';
import type * as WorkRegistrationModule from '@/server/services/workRegistration';

import { hookDispatcher } from '../hooks';
import { CompletionLifecycle } from '.';
import { flushMicrotasks, mockNotifyAgentRunCompleted } from './testUtils';

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

describe('CompletionLifecycle.dispatchHooks — verify plan race', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('awaits the start-time verify-plan instantiation before running the completion gate', async () => {
    const lifecycle = buildLifecycle();
    vi.spyOn(lifecycle as any, 'persistCompletion').mockResolvedValue(undefined);
    vi.spyOn(lifecycle as any, 'createVerifyMessage').mockResolvedValue(undefined);
    vi.spyOn(hookDispatcher, 'dispatch').mockResolvedValue(undefined as any);
    vi.spyOn(hookDispatcher, 'unregister').mockImplementation(function () {});

    // Control exactly when the fire-and-forget instantiation settles.
    let settle: () => void = () => {};
    const instantiation = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const instantiateSpy = vi
      .spyOn(verifyServices, 'instantiateVerifyPlanOnStart')
      .mockReturnValue(instantiation);
    const runVerifySpy = vi
      .spyOn(verifyServices, 'runVerifyOnCompletion')
      .mockResolvedValue(undefined);

    // A top-level task op registers the (still-pending) instantiation at start.
    await lifecycle.recordStart({ operationId: 'op-1', taskId: 'task-1' } as any);
    expect(instantiateSpy).toHaveBeenCalledTimes(1);

    // Completion fires while the plan instantiation is still in flight.
    const doneState = { host: { hooks: [] }, origin: { agentId: 'a' }, status: 'done' };
    const dispatch = lifecycle.dispatchHooks('op-1', doneState, 'done');

    // The gate must stay blocked on the pending instantiation, not race past it.
    await flushMicrotasks();
    expect(runVerifySpy).not.toHaveBeenCalled();

    // Once the plan lands, the gate proceeds against the now-confirmed plan.
    settle();
    await dispatch;
    expect(runVerifySpy).toHaveBeenCalledTimes(1);
  });

  it('does not register an instantiation for a repair / verifier sub-op (parentOperationId set)', async () => {
    const lifecycle = buildLifecycle();
    const instantiateSpy = vi
      .spyOn(verifyServices, 'instantiateVerifyPlanOnStart')
      .mockResolvedValue(undefined);

    await lifecycle.recordStart({
      operationId: 'op-2',
      parentOperationId: 'op-1',
      taskId: 'task-1',
    } as any);

    expect(instantiateSpy).not.toHaveBeenCalled();
  });
});

describe('CompletionLifecycle.dispatchHooks — async-tool park', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const parkedState = {
    host: { hooks: [] },
    origin: { agentId: 'a' },
    status: 'waiting_for_async_tool',
  };

  it('persists the parked status but does NOT fire onComplete or unregister hooks', async () => {
    const lifecycle = buildLifecycle();
    const persistSpy = vi.spyOn(lifecycle as any, 'persistCompletion').mockResolvedValue(undefined);
    const dispatchSpy = vi.spyOn(hookDispatcher, 'dispatch').mockResolvedValue(undefined as any);
    const unregisterSpy = vi.spyOn(hookDispatcher, 'unregister').mockImplementation(function () {});

    await lifecycle.dispatchHooks('op-1', parkedState, 'waiting_for_async_tool');

    expect(persistSpy).toHaveBeenCalledWith(
      'op-1',
      parkedState,
      'waiting_for_async_tool',
      undefined,
    );
    expect(dispatchSpy).not.toHaveBeenCalled();
    expect(unregisterSpy).not.toHaveBeenCalled();
  });

  it('treats a waiting_for_client park the same way: persisted, no onComplete, hooks kept', async () => {
    const lifecycle = buildLifecycle();
    const persistSpy = vi.spyOn(lifecycle as any, 'persistCompletion').mockResolvedValue(undefined);
    const dispatchSpy = vi.spyOn(hookDispatcher, 'dispatch').mockResolvedValue(undefined as any);
    const unregisterSpy = vi.spyOn(hookDispatcher, 'unregister').mockImplementation(function () {});
    const clientPark = { ...parkedState, status: 'waiting_for_client' };

    await lifecycle.dispatchHooks('op-1', clientPark, 'waiting_for_client');

    expect(persistSpy).toHaveBeenCalledWith('op-1', clientPark, 'waiting_for_client', undefined);
    expect(dispatchSpy).not.toHaveBeenCalled();
    expect(unregisterSpy).not.toHaveBeenCalled();
  });

  it('fires onComplete and unregisters on a terminal completion', async () => {
    const lifecycle = buildLifecycle();
    vi.spyOn(lifecycle as any, 'persistCompletion').mockResolvedValue(undefined);
    const dispatchSpy = vi.spyOn(hookDispatcher, 'dispatch').mockResolvedValue(undefined as any);
    const unregisterSpy = vi.spyOn(hookDispatcher, 'unregister').mockImplementation(function () {});

    const doneState = { host: { hooks: [] }, origin: { agentId: 'a' }, status: 'done' };
    await lifecycle.dispatchHooks('op-1', doneState, 'done');

    expect(dispatchSpy).toHaveBeenCalledWith('op-1', 'onComplete', expect.anything(), []);
    expect(unregisterSpy).toHaveBeenCalledWith('op-1');
  });
});

describe('CompletionLifecycle.dispatchHooks — completion notification', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mockNotifyAgentRunCompleted.mockClear();
  });

  const stubSideEffects = (lifecycle: CompletionLifecycle) => {
    vi.spyOn(lifecycle as any, 'persistCompletion').mockResolvedValue(undefined);
    vi.spyOn(lifecycle as any, 'createVerifyMessage').mockResolvedValue(undefined);
    vi.spyOn(hookDispatcher, 'dispatch').mockResolvedValue(undefined as any);
    vi.spyOn(hookDispatcher, 'unregister').mockImplementation(function () {});
    vi.spyOn(verifyServices, 'runVerifyOnCompletion').mockResolvedValue(undefined);
    // The recall gate falls back to the op row when metadata carries no trigger.
    (lifecycle as any).agentOperationModel = { findById: vi.fn(async () => null) };
  };

  const buildDoneState = (origin: Record<string, unknown> = {}) => ({
    createdAt: new Date(Date.now() - 90_000).toISOString(),
    messages: [{ content: 'final reply', role: 'assistant' }],
    host: { hooks: [] },
    origin: { agentId: 'agt_1', topicId: 'tpc_1', ...origin },
    status: 'done',
  });

  it('notifies with fields mapped from the lifecycle event on a done completion', async () => {
    const lifecycle = buildLifecycle();
    stubSideEffects(lifecycle);

    await lifecycle.dispatchHooks('op-1', buildDoneState({ userId: 'user-2' }), 'done');
    await flushMicrotasks();

    expect(mockNotifyAgentRunCompleted).toHaveBeenCalledTimes(1);
    expect(mockNotifyAgentRunCompleted).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agt_1',
        duration: expect.any(Number),
        lastAssistantContent: 'final reply',
        operationId: 'op-1',
        topicId: 'tpc_1',
        userId: 'user-2',
        // Personal lifecycle (no workspaceId) forwards undefined ⇒ bare link.
        workspaceId: undefined,
      }),
    );
  });

  it('forwards the workspace id so a team run gets a workspace-scoped deep link', async () => {
    const lifecycle = new CompletionLifecycle({} as any, 'user-1', 'ws_1');
    stubSideEffects(lifecycle);

    await lifecycle.dispatchHooks('op-1', buildDoneState({ userId: 'user-2' }), 'done');
    await flushMicrotasks();

    expect(mockNotifyAgentRunCompleted).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws_1' }),
    );
  });

  // 'task' is TopicTrigger.RunTask (the task-runner funnel), not a RequestTrigger member.
  it.each(['task', RequestTrigger.Bot, RequestTrigger.Eval, RequestTrigger.Api])(
    'does not notify for background %s-triggered completions',
    async (trigger) => {
      const lifecycle = buildLifecycle();
      stubSideEffects(lifecycle);

      await lifecycle.dispatchHooks('op-1', buildDoneState({ trigger }), 'done');
      await flushMicrotasks();

      expect(mockNotifyAgentRunCompleted).not.toHaveBeenCalled();
    },
  );

  // Scheduled = a user-deferred chat turn; Cron = the rate-limit auto-resume of
  // a user's chat turn. Both are "user walked away" runs the recall exists for.
  it.each([RequestTrigger.Chat, RequestTrigger.Scheduled, RequestTrigger.Cron])(
    'notifies for a user-recallable %s-triggered completion',
    async (trigger) => {
      const lifecycle = buildLifecycle();
      stubSideEffects(lifecycle);

      await lifecycle.dispatchHooks('op-1', buildDoneState({ trigger }), 'done');
      await flushMicrotasks();

      expect(mockNotifyAgentRunCompleted).toHaveBeenCalledTimes(1);
    },
  );

  it('falls back to the op row trigger when metadata carries none (synthetic hetero path)', async () => {
    const lifecycle = buildLifecycle();
    stubSideEffects(lifecycle);
    (lifecycle as any).agentOperationModel = {
      findById: vi.fn(async () => ({ trigger: RequestTrigger.Bot })),
    };

    // heteroFinish/agentNotify build metadata via buildStateFromInput — no trigger.
    await lifecycle.dispatchHooks('op-1', buildDoneState(), 'done');
    await flushMicrotasks();

    expect(mockNotifyAgentRunCompleted).not.toHaveBeenCalled();
  });

  it('does not notify for internal child runs (verifier/repair pass parentOperationId only)', async () => {
    const lifecycle = buildLifecycle();
    stubSideEffects(lifecycle);
    (lifecycle as any).agentOperationModel = {
      findById: vi.fn(async () => ({ parentOperationId: 'op-parent', trigger: null })),
    };

    await lifecycle.dispatchHooks('op-1', buildDoneState(), 'done');
    await flushMicrotasks();

    expect(mockNotifyAgentRunCompleted).not.toHaveBeenCalled();
  });

  it('does not notify for sub-agent completions', async () => {
    const lifecycle = buildLifecycle();
    stubSideEffects(lifecycle);

    await lifecycle.dispatchHooks(
      'op-1',
      buildDoneState({ lineage: { isSubAgent: true } }),
      'done',
    );
    await flushMicrotasks();

    expect(mockNotifyAgentRunCompleted).not.toHaveBeenCalled();
  });

  it('does not notify for in-group member completions (orchestrationRole without isSubAgent)', async () => {
    const lifecycle = buildLifecycle();
    stubSideEffects(lifecycle);

    // execAgentMember stamps in-group members with orchestrationRole: 'member'
    // but NOT isSubAgent — they are internal steps of the supervisor run.
    await lifecycle.dispatchHooks(
      'op-1',
      buildDoneState({ lineage: { orchestrationRole: 'member' } }),
      'done',
    );
    await flushMicrotasks();

    expect(mockNotifyAgentRunCompleted).not.toHaveBeenCalled();
  });

  it('preserves an in-group member role in synthesized completion state', () => {
    const lifecycle = buildLifecycle();

    const state = (lifecycle as any).buildStateFromInput({
      operationId: 'op-member',
      orchestrationRole: 'member',
    });

    expect(state.origin.lineage.orchestrationRole).toBe('member');
  });

  it.each(['max_steps', 'cost_limit'])(
    'notifies on the success-like capped terminal %s (still produced a deliverable)',
    async (reason) => {
      const lifecycle = buildLifecycle();
      stubSideEffects(lifecycle);

      await lifecycle.dispatchHooks('op-1', buildDoneState(), reason);
      await flushMicrotasks();

      expect(mockNotifyAgentRunCompleted).toHaveBeenCalledTimes(1);
    },
  );

  it('does not notify on error / aborted terminals', async () => {
    const lifecycle = buildLifecycle();
    stubSideEffects(lifecycle);

    await lifecycle.dispatchHooks(
      'op-1',
      { host: { hooks: [] }, origin: { agentId: 'agt_1' }, status: 'error' },
      'error',
    );

    expect(mockNotifyAgentRunCompleted).not.toHaveBeenCalled();
  });

  it('a notification rejection never breaks the dispatch pipeline', async () => {
    const lifecycle = buildLifecycle();
    stubSideEffects(lifecycle);
    // Once-only: a persistent mockRejectedValue would survive afterEach
    // (restoreAllMocks skips plain vi.fn, mockClear keeps implementations)
    // and leak into later dispatchHooks('done') tests in this file.
    mockNotifyAgentRunCompleted.mockRejectedValueOnce(new Error('push provider down'));

    const doneState = { host: { hooks: [] }, origin: { agentId: 'agt_1' }, status: 'done' };
    await expect(lifecycle.dispatchHooks('op-1', doneState, 'done')).resolves.toBeUndefined();
    await flushMicrotasks();

    expect(hookDispatcher.dispatch).toHaveBeenCalledWith(
      'op-1',
      'onComplete',
      expect.anything(),
      [],
    );
    expect(hookDispatcher.unregister).toHaveBeenCalledWith('op-1');
  });
});
