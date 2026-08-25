// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
 * Regression: the completion-time verify gate used to be launched with a bare
 * `void`. Nobody held that promise, so on the serverless path the instance was
 * free to stop scheduling it as soon as the step response returned — and since
 * entering `verifying` is a durable write, a run cut off mid-judge stayed
 * `verifying` forever (acceptance and goal card stuck with it). It must be
 * handed to the host as post-response work instead.
 */
describe('CompletionLifecycle — verify gate scheduling', () => {
  beforeEach(() => {
    after.mockReset();
  });

  it('schedules the verify gate as post-response work, not a detached promise', async () => {
    const lifecycle = new CompletionLifecycle({} as any, 'user-1');
    vi.spyOn(lifecycle as any, 'persistCompletion').mockResolvedValue(undefined);
    vi.spyOn(lifecycle as any, 'createVerifyMessage').mockResolvedValue(undefined);
    vi.spyOn(hookDispatcher, 'dispatch').mockResolvedValue(undefined as any);
    vi.spyOn(hookDispatcher, 'unregister').mockImplementation(() => {});
    const runVerify = vi
      .spyOn(verifyServices, 'runVerifyOnCompletion')
      .mockResolvedValue(undefined);

    await lifecycle.dispatchHooks(
      'op-1',
      { metadata: { _hooks: [], agentId: 'a' }, status: 'done' },
      'done',
    );

    // Handed over, and not started behind the scheduler's back.
    expect(after).toHaveBeenCalledTimes(1);
    expect(runVerify).not.toHaveBeenCalled();

    // What was handed over is the gate itself.
    await after.mock.calls[0][0]();
    expect(runVerify).toHaveBeenCalledTimes(1);
    expect(runVerify.mock.calls[0][2]).toMatchObject({ operationId: 'op-1' });
  });
});
