// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { hookDispatcher } from '../hooks';
import { CompletionLifecycle } from '.';

const { releaseAgentRunSlot, settleAgentRunFee } = vi.hoisted(() => ({
  releaseAgentRunSlot: vi.fn(),
  settleAgentRunFee: vi.fn(async () => {}),
}));

vi.mock('@/business/server/agent-run/runConcurrency', () => ({ releaseAgentRunSlot }));
vi.mock('@/business/server/agent-run/runFee', () => ({ settleAgentRunFee }));
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
  ...(await importOriginal<object>()),
  registerWorksForOperation: vi.fn(),
}));

const buildLifecycle = () => {
  const lifecycle = new CompletionLifecycle({} as any, 'user-1');
  (lifecycle as any).agentOperationModel = {
    findById: vi.fn(async () => null),
    recordCompletion: vi.fn(async () => true),
    sumChildUsage: vi.fn(async () => undefined),
  };
  (lifecycle as any).messageModel = { update: vi.fn(async () => ({ success: true })) };
  vi.spyOn(hookDispatcher, 'dispatch').mockResolvedValue(undefined as any);
  vi.spyOn(hookDispatcher, 'unregister').mockImplementation(function () {});
  return lifecycle;
};

const state = (status: string) => ({
  host: { hooks: [] },
  messages: [{ content: 'reply', role: 'assistant' }],
  origin: { agentId: 'agt_1', userId: 'user-1' },
  status,
});

describe('CompletionLifecycle.dispatchHooks — concurrency slot', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    releaseAgentRunSlot.mockReset();
  });

  it.each(['done', 'error', 'interrupted'])(
    'frees the slot when the run ends in %s',
    async (reason) => {
      await buildLifecycle().dispatchHooks('op-1', state(reason), reason, {
        skipErrorMessageWrite: true,
      });

      expect(releaseAgentRunSlot).toHaveBeenCalledWith('user-1', 'op-1');
    },
  );

  it('frees the slot while the run waits on a human decision', async () => {
    await buildLifecycle().dispatchHooks('op-1', state('waiting_for_human'), 'waiting_for_human');

    expect(releaseAgentRunSlot).toHaveBeenCalledWith('user-1', 'op-1');
  });

  it.each(['waiting_for_async_tool', 'waiting_for_client'])(
    'keeps the slot while the same run is parked in %s',
    async (reason) => {
      await buildLifecycle().dispatchHooks('op-1', state(reason), reason);

      expect(releaseAgentRunSlot).not.toHaveBeenCalled();
    },
  );
});

describe('CompletionLifecycle.dispatchHooks — run fee', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    settleAgentRunFee.mockReset();
    settleAgentRunFee.mockImplementation(async () => {});
  });

  it.each(['done', 'error', 'interrupted', 'waiting_for_human'])(
    'settles the fee with the terminal reason %s',
    async (reason) => {
      await buildLifecycle().dispatchHooks(
        'op-1',
        { ...state(reason), createdAt: new Date(Date.now() - 45_000).toISOString() },
        reason,
        { skipErrorMessageWrite: true },
      );

      expect(settleAgentRunFee).toHaveBeenCalledWith({
        durationMs: expect.any(Number),
        operationId: 'op-1',
        reason,
        userId: 'user-1',
      });
      expect(settleAgentRunFee.mock.calls[0][0].durationMs).toBeGreaterThanOrEqual(45_000);
    },
  );

  it.each(['waiting_for_async_tool', 'waiting_for_client'])(
    'leaves the fee held while the same run is parked in %s',
    async (reason) => {
      await buildLifecycle().dispatchHooks('op-1', state(reason), reason);

      expect(settleAgentRunFee).not.toHaveBeenCalled();
    },
  );

  it('still dispatches completion hooks when settling the fee fails', async () => {
    settleAgentRunFee.mockRejectedValue(new Error('db down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await buildLifecycle().dispatchHooks('op-1', state('done'), 'done');

    expect(hookDispatcher.dispatch).toHaveBeenCalledWith(
      'op-1',
      'onComplete',
      expect.anything(),
      [],
    );
  });
});
