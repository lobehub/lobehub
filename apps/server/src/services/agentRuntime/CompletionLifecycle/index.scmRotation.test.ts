// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { hookDispatcher } from '../hooks';
import { CompletionLifecycle } from '.';

const { releaseAgentRunSlot, rotateRequesterTokenIfIdle, settleAgentRunFee } = vi.hoisted(() => ({
  releaseAgentRunSlot: vi.fn(),
  rotateRequesterTokenIfIdle: vi.fn(async () => {}),
  settleAgentRunFee: vi.fn(async () => {}),
}));

vi.mock('@/business/server/agent-run/runConcurrency', () => ({ releaseAgentRunSlot }));
vi.mock('@/business/server/agent-run/runFee', () => ({ settleAgentRunFee }));
vi.mock('@/server/services/scm/github/rotateOnIdle', () => ({ rotateRequesterTokenIfIdle }));
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

const db = { tag: 'db' } as any;

const buildLifecycle = () => {
  const lifecycle = new CompletionLifecycle(db, 'user-1');
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

describe('CompletionLifecycle.dispatchHooks — requester GitHub token rotation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    rotateRequesterTokenIfIdle.mockClear();
  });

  it.each(['done', 'error', 'interrupted'])(
    'checks for rotation when the run ends in %s',
    async (reason) => {
      await buildLifecycle().dispatchHooks('op-1', state(reason), reason, {
        skipErrorMessageWrite: true,
      });

      expect(rotateRequesterTokenIfIdle).toHaveBeenCalledWith(db, 'op-1');
    },
  );

  it.each(['waiting_for_async_tool', 'waiting_for_client'])(
    'keeps the token while the same run is parked in %s',
    async (reason) => {
      await buildLifecycle().dispatchHooks('op-1', state(reason), reason);

      expect(rotateRequesterTokenIfIdle).not.toHaveBeenCalled();
    },
  );
});
