// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as verifyServices from '@/server/services/verify';

import { CompletionLifecycle } from '../CompletionLifecycle';
import { hookDispatcher } from '../hooks';

const { after } = vi.hoisted(() => ({ after: vi.fn() }));

vi.mock('@/server/utils/scheduleAfterResponse', () => ({ after }));
vi.mock('@/business/server/agent-run/notifyAgentRunCompleted', () => ({
  notifyAgentRunCompleted: vi.fn(async () => {}),
}));
vi.mock('@/server/services/workRegistration', () => ({ registerWorksForOperation: vi.fn() }));

/**
 * Regression: the completion-time verify gate used to run as post-response work
 * of the completing request. A heterogeneous `heteroFinish` past the 120 s edge
 * timeout took the gate down with it after it had claimed `verifying`, so the
 * round was never judged. The gate is handed to `scheduleVerifyOnCompletion`,
 * which runs it in its own QStash delivery.
 */
describe('CompletionLifecycle — verify gate scheduling', () => {
  afterEach(() => vi.restoreAllMocks());
  beforeEach(() => {
    after.mockReset();
  });

  it('hands the verify gate to its own delivery instead of this request', async () => {
    const lifecycle = new CompletionLifecycle({} as any, 'user-1');
    vi.spyOn(lifecycle as any, 'persistCompletion').mockResolvedValue(undefined);
    vi.spyOn(lifecycle as any, 'createVerifyMessage').mockResolvedValue(undefined);
    vi.spyOn(hookDispatcher, 'dispatch').mockResolvedValue(undefined as any);
    vi.spyOn(hookDispatcher, 'unregister').mockImplementation(function () {});
    const schedule = vi
      .spyOn(verifyServices, 'scheduleVerifyOnCompletion')
      .mockResolvedValue(undefined);
    const runVerify = vi.spyOn(verifyServices, 'runVerifyOnCompletion');

    await lifecycle.dispatchHooks(
      'op-1',
      { host: { hooks: [] }, origin: { agentId: 'a' }, status: 'done' },
      'done',
    );

    expect(schedule).toHaveBeenCalledTimes(1);
    expect(schedule.mock.calls[0][2]).toMatchObject({ operationId: 'op-1' });
    // Not judged on this request, nor queued behind its response.
    expect(runVerify).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
  });
  it.each(['error', 'interrupted'])(
    'does not wait for unfinished plan generation on %s',
    async (reason) => {
      const lifecycle = new CompletionLifecycle({} as any, 'user-1');
      vi.spyOn(lifecycle as any, 'persistCompletion').mockResolvedValue(undefined);
      const dispatch = vi.spyOn(hookDispatcher, 'dispatch').mockResolvedValue(undefined as any);
      vi.spyOn(hookDispatcher, 'unregister').mockImplementation(function () {});
      let release!: () => void;
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      (lifecycle as any).verifyPlanInstantiations.set('top-level-op', pending);
      let completed = false;
      const completion = lifecycle
        .dispatchHooks('top-level-op', { host: { hooks: [] }, origin: {}, status: reason }, reason)
        .then(() => {
          completed = true;
        });
      try {
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(completed).toBe(true);
        expect(dispatch).toHaveBeenCalled();
      } finally {
        release();
        await completion;
      }
    },
  );

  it.each(['error', 'interrupted'])('settles an aborted repair on %s', async (reason) => {
    const lifecycle = new CompletionLifecycle({} as any, 'user-1');
    vi.spyOn(lifecycle as any, 'persistCompletion').mockResolvedValue(undefined);
    vi.spyOn(hookDispatcher, 'dispatch').mockResolvedValue(undefined as any);
    vi.spyOn(hookDispatcher, 'unregister').mockImplementation(function () {});
    const settle = vi.spyOn(verifyServices, 'settleFailedRepair').mockResolvedValue(false);
    vi.spyOn(verifyServices, 'releaseUndeliveredRound').mockResolvedValue(false);

    await lifecycle.dispatchHooks(
      'repair-op',
      { host: { hooks: [] }, origin: {}, status: 'error' },
      reason,
    );
    await Promise.all(after.mock.calls.map(([callback]) => callback()));
    expect(settle).toHaveBeenCalledWith(expect.anything(), 'user-1', 'repair-op', undefined);
  });

  it('releases the round of a task run that ended in error', async () => {
    vi.spyOn(verifyServices, 'settleFailedRepair').mockResolvedValue(false);
    const release = vi.spyOn(verifyServices, 'releaseUndeliveredRound').mockResolvedValue(true);
    const lifecycle = new CompletionLifecycle({} as any, 'user-1');
    vi.spyOn(lifecycle as any, 'persistCompletion').mockResolvedValue(undefined);
    vi.spyOn(hookDispatcher, 'dispatch').mockResolvedValue(undefined as any);
    vi.spyOn(hookDispatcher, 'unregister').mockImplementation(function () {});

    await lifecycle.dispatchHooks(
      'task-op',
      { host: { hooks: [] }, origin: {}, status: 'error' },
      'error',
    );
    await Promise.all(after.mock.calls.map(([callback]) => callback()));

    expect(release).toHaveBeenCalledWith(expect.anything(), 'user-1', 'task-op', undefined);
  });
});
