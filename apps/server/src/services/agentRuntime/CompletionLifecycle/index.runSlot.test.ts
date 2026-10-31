// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { hookDispatcher } from '../hooks';
import { CompletionLifecycle } from '.';

const { releaseAgentRunSlot } = vi.hoisted(() => ({ releaseAgentRunSlot: vi.fn() }));

vi.mock('@/business/server/agent-run/runConcurrency', () => ({ releaseAgentRunSlot }));
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
