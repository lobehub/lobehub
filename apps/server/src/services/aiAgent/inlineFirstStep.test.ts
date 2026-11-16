// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getInvocationDeadline } from '@/server/utils/invocationDeadline';

import {
  INLINE_FIRST_STEP_MAX_DURATION_MS,
  INLINE_FIRST_STEP_START_DEADLINE_MS,
  type InlineFirstStepDeps,
  isInlineFirstStepEnabled,
  runInlineFirstStep,
  shouldRunFirstStepInline,
} from './inlineFirstStep';

const { mockFeatureFlags } = vi.hoisted(() => ({ mockFeatureFlags: vi.fn() }));

vi.mock('@/server/featureFlags', () => ({
  getServerFeatureFlagsStateFromRuntimeConfig: mockFeatureFlags,
}));

vi.mock('@/server/services/agentRuntime/opportunisticSweep', () => ({
  scheduleOpportunisticStaleSweep: vi.fn(),
  scheduleOpportunisticVerifySweep: vi.fn(),
}));

const OP = 'op-1';
const OWNER = 'op-1:owner';
const placeholderContext = { phase: 'user_input', session: { sessionId: OP } };

const doneResult = () => ({
  nextStepScheduled: false,
  state: { status: 'done', stepCount: 1 },
  success: true,
});

/**
 * An operation lock with the claim semantics the queue worker relies on: one
 * owner at a time, re-entrant for that owner.
 */
const createLock = () => {
  let holder: string | undefined;
  return {
    claim: (owner: string) => {
      if (holder && holder !== owner) return false;
      holder = owner;
      return true;
    },
    get holder() {
      return holder;
    },
    release: (owner: string) => {
      if (holder === owner) holder = undefined;
    },
  };
};

const setup = (
  state: Record<string, unknown> | null = { initialContext: placeholderContext, stepCount: 0 },
) => {
  const lock = createLock();
  const settled = new Set<string>();
  const service = {
    createOperationLockOwner: vi.fn(() => OWNER),
    executeStep: vi.fn(async (params: { stepLockOwner?: string }) => {
      // The step claims the lock itself, exactly as a queue delivery does.
      if (!lock.claim(params.stepLockOwner!)) return { locked: true, state: {}, success: false };
      return doneResult();
    }),
    releaseOperationLock: vi.fn(async (_operationId: string, owner: string) => lock.release(owner)),
    scheduleContinuation: vi.fn(async () => {}),
  };
  const coordinator = {
    clearInlineResume: vi.fn(async () => {}),
    getOperationMetadata: vi.fn(async () => ({ userId: 'user-1', workspaceId: 'ws-1' })),
    loadAgentState: vi.fn(async () => state),
    loadInlineResume: vi.fn(async () => null),
    markInlineFirstStepSettled: vi.fn(async (operationId: string) => {
      settled.add(operationId);
    }),
    tryClaimStep: vi.fn(
      async (_operationId: string, _stepIndex: number, _ttl?: number, owner?: string) =>
        lock.claim(owner!),
    ),
  };
  const createService = vi.fn(() => service);
  const deps = { coordinator, createService } as unknown as InlineFirstStepDeps;

  /** The queued fallback delivery, as `/api/agent/run` treats it. */
  const queuedDelivery = async () => {
    if (settled.has(OP)) return 'noop' as const;
    const owner = 'queue:owner';
    const result = await service.executeStep({ stepLockOwner: owner } as any);
    lock.release(owner);
    return result.locked ? ('locked' as const) : ('ran' as const);
  };

  return { coordinator, createService, deps, lock, queuedDelivery, service, settled };
};

describe('shouldRunFirstStepInline', () => {
  const enabled = () => Promise.resolve(true);
  const input = { deferredInit: true, requestStartedAt: 1, stepIndex: 0 };

  it('runs a deferred-init send that the route opted in, when the flag is on', async () => {
    await expect(shouldRunFirstStepInline(input, enabled)).resolves.toBe(true);
  });

  it.each([
    ['the init ran on the send path', { deferredInit: false }],
    ['no route asked for it', { requestStartedAt: undefined }],
    ['the run does not start at step 0', { stepIndex: 3 }],
  ])('keeps step 0 on the queue when %s', async (_label, override) => {
    const isEnabled = vi.fn(enabled);

    await expect(shouldRunFirstStepInline({ ...input, ...override }, isEnabled)).resolves.toBe(
      false,
    );
    expect(isEnabled).not.toHaveBeenCalled();
  });

  it('keeps step 0 on the queue when the flag is off or unreadable', async () => {
    mockFeatureFlags.mockResolvedValueOnce({ enableInlineFirstStep: false });
    await expect(
      shouldRunFirstStepInline(input, () => isInlineFirstStepEnabled('u')),
    ).resolves.toBe(false);

    mockFeatureFlags.mockRejectedValueOnce(new Error('edge config down'));
    await expect(
      shouldRunFirstStepInline(input, () => isInlineFirstStepEnabled('u')),
    ).resolves.toBe(false);
  });
});

describe('runInlineFirstStep', () => {
  const run = { operationId: OP, requestStartedAt: Date.now(), stepIndex: 0 };

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs step 0 once under the step claim, and the queued delivery is then a no-op', async () => {
    const { coordinator, deps, lock, queuedDelivery, service } = setup();

    await expect(runInlineFirstStep(deps, run)).resolves.toBe('ran');

    expect(coordinator.tryClaimStep).toHaveBeenCalledWith(OP, 0, expect.any(Number), OWNER);
    expect(service.executeStep).toHaveBeenCalledTimes(1);
    expect(service.executeStep).toHaveBeenCalledWith(
      expect.objectContaining({
        context: placeholderContext,
        firstStepDispatch: 'inline',
        operationId: OP,
        retainStepLock: true,
        stepIndex: 0,
        stepLockOwner: OWNER,
      }),
    );
    expect(coordinator.markInlineFirstStepSettled).toHaveBeenCalledWith(OP);
    expect(lock.holder).toBeUndefined();

    await expect(queuedDelivery()).resolves.toBe('noop');
    expect(service.executeStep).toHaveBeenCalledTimes(1);
  });

  it('builds the step service from the run metadata, not the send', async () => {
    const { createService, deps } = setup();

    await runInlineFirstStep(deps, run);

    expect(createService).toHaveBeenCalledWith({
      streamOwnerUserId: undefined,
      userId: 'user-1',
      workspaceId: 'ws-1',
    });
  });

  it('is a no-op when the queued delivery claimed the step first', async () => {
    const { coordinator, deps, lock, service } = setup();
    lock.claim('queue:owner');

    await expect(runInlineFirstStep(deps, run)).resolves.toBe('claim_lost');

    expect(service.executeStep).not.toHaveBeenCalled();
    expect(coordinator.markInlineFirstStepSettled).not.toHaveBeenCalled();
    // The queue's claim is untouched.
    expect(lock.holder).toBe('queue:owner');
  });

  it('is a no-op when the queued delivery already ran the step', async () => {
    const { coordinator, deps, lock, service } = setup({ stepCount: 1 });

    await expect(runInlineFirstStep(deps, run)).resolves.toBe('already_ran');

    expect(service.executeStep).not.toHaveBeenCalled();
    expect(coordinator.markInlineFirstStepSettled).not.toHaveBeenCalled();
    expect(lock.holder).toBeUndefined();
  });

  it('leaves a run without runtime metadata to the queued delivery', async () => {
    const { coordinator, deps, service } = setup();
    coordinator.getOperationMetadata.mockResolvedValueOnce(null as any);

    await expect(runInlineFirstStep(deps, run)).resolves.toBe('missing_operation');

    expect(coordinator.tryClaimStep).not.toHaveBeenCalled();
    expect(service.executeStep).not.toHaveBeenCalled();
  });

  it('leaves a failed step to the queued delivery as its redelivery', async () => {
    const { coordinator, deps, lock, queuedDelivery, service } = setup();
    service.executeStep.mockRejectedValueOnce(new Error('durable status unavailable'));

    await expect(runInlineFirstStep(deps, run)).resolves.toBe('failed');

    expect(coordinator.markInlineFirstStepSettled).not.toHaveBeenCalled();
    expect(lock.holder).toBeUndefined();
    await expect(queuedDelivery()).resolves.toBe('ran');
  });

  it('runs a stopped run through the step, which settles the stop', async () => {
    // Stop pressed between the response and the inline start: the run is
    // already interrupted, and `executeStep` settles it without a step.
    const { deps, service } = setup({
      initialContext: placeholderContext,
      status: 'interrupted',
      stepCount: 0,
    });
    service.executeStep.mockResolvedValueOnce({
      nextStepScheduled: false,
      state: { status: 'interrupted', stepCount: 0 },
      stepResult: null,
      success: true,
    } as any);

    await expect(runInlineFirstStep(deps, run)).resolves.toBe('ran');

    expect(service.executeStep).toHaveBeenCalledTimes(1);
    expect(service.scheduleContinuation).not.toHaveBeenCalled();
  });

  describe('time budget', () => {
    const continuation = (stepIndex: number) => ({
      context: { phase: 'llm_result' },
      operationId: OP,
      stepIndex,
    });

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(1_000_000);
    });

    it('keeps stepping inline while the deadline allows', async () => {
      const { deps, service } = setup();
      service.executeStep
        .mockResolvedValueOnce({ continuation: continuation(1), state: {}, success: true } as any)
        .mockResolvedValueOnce(doneResult() as any);

      await runInlineFirstStep(deps, { ...run, requestStartedAt: Date.now() });

      expect(service.executeStep).toHaveBeenCalledTimes(2);
      expect(service.executeStep).toHaveBeenLastCalledWith(
        expect.not.objectContaining({ firstStepDispatch: expect.anything() }),
      );
      expect(service.scheduleContinuation).not.toHaveBeenCalled();
    });

    it('hands the next step to the queue once the deadline has passed', async () => {
      const { coordinator, deps, service } = setup();
      const requestStartedAt = Date.now();
      service.executeStep.mockImplementationOnce(async () => {
        // Step 0 ran past the point at which another step may start.
        vi.setSystemTime(requestStartedAt + INLINE_FIRST_STEP_START_DEADLINE_MS);
        return { continuation: continuation(1), state: {}, success: true } as any;
      });

      await expect(runInlineFirstStep(deps, { ...run, requestStartedAt })).resolves.toBe('ran');

      expect(service.executeStep).toHaveBeenCalledTimes(1);
      expect(service.scheduleContinuation).toHaveBeenCalledWith(continuation(1));
      expect(coordinator.clearInlineResume).toHaveBeenCalledWith(OP, OWNER);
      expect(coordinator.markInlineFirstStepSettled).toHaveBeenCalledWith(OP);
    });

    it('sizes long waits inside the step to the execAgent route, not the worker route', async () => {
      const { deps, service } = setup();
      const requestStartedAt = Date.now();
      let deadline: number | undefined;
      service.executeStep.mockImplementationOnce(async () => {
        deadline = getInvocationDeadline();
        return doneResult() as any;
      });

      await runInlineFirstStep(deps, { ...run, requestStartedAt });

      expect(deadline).toBe(requestStartedAt + INLINE_FIRST_STEP_MAX_DURATION_MS);
    });
  });
});
