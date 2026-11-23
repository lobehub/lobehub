// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { hookDispatcher } from '../hooks';
import { CompletionLifecycle } from '.';

const { recordShareRunResult } = vi.hoisted(() => ({ recordShareRunResult: vi.fn() }));

vi.mock('@/server/services/aiAgent/shareGate/runMetrics', () => ({ recordShareRunResult }));
vi.mock('@/business/server/agent-run/runConcurrency', () => ({ releaseAgentRunSlot: vi.fn() }));
vi.mock('@/business/server/agent-run/runFee', () => ({ settleAgentRunFee: vi.fn(async () => {}) }));
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

interface Row {
  parentOperationId?: string | null;
  previousStatus?: string;
  trigger?: string | null;
}

/**
 * The completion write the lifecycle sees: by default a share run's first move out of `running`.
 * `null` is a write refused because another terminal owner holds the row.
 */
const buildLifecycle = (row: Row | null = {}) => {
  const lifecycle = new CompletionLifecycle({} as any, 'owner');
  (lifecycle as any).agentOperationModel = {
    findById: vi.fn(async () => (row ? null : { status: 'error' })),
    recordCompletion: vi.fn(async () =>
      row
        ? {
            id: 'op',
            parentOperationId: null,
            previousStatus: 'running',
            trigger: 'agent_share',
            ...row,
          }
        : undefined,
    ),
    sumChildUsage: vi.fn(async () => undefined),
  };
  (lifecycle as any).messageModel = {
    findById: vi.fn(async () => null),
    update: vi.fn(async () => ({ success: true })),
  };
  vi.spyOn(hookDispatcher, 'dispatch').mockResolvedValue(undefined as any);
  vi.spyOn(hookDispatcher, 'unregister').mockImplementation(function () {});
  return lifecycle;
};

const shareState = (status: string, extra: Record<string, unknown> = {}) => ({
  host: { hooks: [] },
  messages: [{ content: 'reply', role: 'assistant' }],
  origin: { agentId: 'agt_shared', userId: 'owner' },
  principal: { actor: { shareVisitor: { visitorUserId: 'visitor' } } },
  status,
  ...extra,
});

describe('CompletionLifecycle.dispatchHooks — share run metrics', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    recordShareRunResult.mockReset();
  });

  it.each([
    ['done', 'success'],
    ['max_steps', 'success'],
    ['interrupted', 'interrupted'],
  ])('counts a shared run ending in %s as %s', async (reason, outcome) => {
    await buildLifecycle().dispatchHooks('op', shareState(reason), reason);

    expect(recordShareRunResult).toHaveBeenCalledExactlyOnceWith({ outcome, stage: 'run' });
  });

  it('counts a failed shared run with its error type', async () => {
    await buildLifecycle().dispatchHooks(
      'op',
      shareState('error', { error: { message: 'boom', type: 'ProviderBizError' } }),
      'error',
      { skipErrorMessageWrite: true },
    );

    expect(recordShareRunResult).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ errorType: 'ProviderBizError', outcome: 'error', stage: 'run' }),
    );
  });

  // The Channel fails a reply whose run stopped on a tool call at its step cap; counting it as a
  // success hid a failure the visitor saw.
  it('counts a capped run that left no reply as a failure typed by its cap', async () => {
    await buildLifecycle().dispatchHooks(
      'op',
      shareState('max_steps', { messages: [{ content: '', role: 'assistant', tools: [{}] }] }),
      'max_steps',
    );

    expect(recordShareRunResult).toHaveBeenCalledExactlyOnceWith({
      errorType: 'max_steps',
      outcome: 'error',
      stage: 'run',
    });
  });

  // A device dispatch failure or an abandonment settles through a synthetic state that carries no
  // share visitor; the row's trigger still marks the share run.
  it('counts a share run settled without a share visitor on its state', async () => {
    const { principal: _, ...syntheticState } = shareState('error', {
      error: { message: 'offline', type: 'ShareHeteroDeviceUnavailable' },
    });
    await buildLifecycle().dispatchHooks('op', syntheticState, 'error', {
      skipErrorMessageWrite: true,
    });

    expect(recordShareRunResult).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ errorType: 'ShareHeteroDeviceUnavailable', outcome: 'error' }),
    );
  });

  // A retried hook delivery or a repeated device finish writes the same terminal status again.
  it('does not count a replay of the status the row already holds', async () => {
    await buildLifecycle({ previousStatus: 'done' }).dispatchHooks(
      'op',
      shareState('done'),
      'done',
    );

    expect(recordShareRunResult).not.toHaveBeenCalled();
  });

  // The watchdog's claim writes `error` before the lifecycle persists `error` onto it.
  it('counts an abandonment whose claim already wrote the terminal status', async () => {
    await buildLifecycle({ previousStatus: 'error' }).dispatchHooks(
      'op',
      shareState('error', { error: { message: 'stalled', type: 'AgentRuntimeError' } }),
      'error',
      { skipErrorMessageWrite: true, terminalClaimed: true },
    );

    expect(recordShareRunResult).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ errorType: 'AgentRuntimeError', outcome: 'error' }),
    );
  });

  it('does not count the owner’s own runs', async () => {
    const { principal: _, ...ownerState } = shareState('done');
    await buildLifecycle({ trigger: 'chat' }).dispatchHooks('op', ownerState, 'done');

    expect(recordShareRunResult).not.toHaveBeenCalled();
  });

  it.each([
    ['a sub-agent', {}, { isSubAgent: true }],
    ['a child operation', { parentOperationId: 'op-parent' }, undefined],
    ['a group member', {}, { orchestrationRole: 'member' }],
  ])('does not count %s of a shared run on its own', async (_, row, lineage) => {
    await buildLifecycle(row).dispatchHooks(
      'op',
      shareState('done', { origin: { agentId: 'agt_shared', lineage, userId: 'owner' } }),
      'done',
    );

    expect(recordShareRunResult).not.toHaveBeenCalled();
  });

  it.each(['waiting_for_human', 'waiting_for_async_tool'])(
    'does not count a shared run parked in %s',
    async (reason) => {
      await buildLifecycle().dispatchHooks('op', shareState(reason), reason);

      expect(recordShareRunResult).not.toHaveBeenCalled();
    },
  );

  it('does not count a completion another owner already settled', async () => {
    await buildLifecycle(null).dispatchHooks('op', shareState('done'), 'done');

    expect(recordShareRunResult).not.toHaveBeenCalled();
  });
});
