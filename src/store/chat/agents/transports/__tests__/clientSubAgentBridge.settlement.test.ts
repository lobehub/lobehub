import { beforeEach, describe, expect, it, vi } from 'vitest';

import { __resetBridgeForTests, fireClientSubAgentBridge } from '../clientSubAgentBridge';
import {
  childContext,
  makeGet,
  registerArmedSubAgentBridge,
  subAgentRegistration,
} from './testUtils';

vi.mock('@/services/aiAgent', () => ({
  aiAgentService: {
    // P1 (round-23): the fire path routes the child result through the
    // server result-control review before any backfill — tests default to
    // "not blocked, unchanged".
    controlClientSubAgentToolResult: vi
      .fn()
      .mockResolvedValue({ blocked: false, content: undefined }),
    updateClientTaskThreadStatus: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/services/thread', () => ({
  threadService: {
    getThreads: vi.fn().mockResolvedValue([]),
    mergeThreadMetadata: vi.fn().mockResolvedValue(true),
    updateThread: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/services/message', () => ({
  messageService: {
    getMessages: vi.fn().mockResolvedValue([]),
  },
}));

beforeEach(() => {
  // The registry is module-level; a restored claim (retry semantics) from one
  // case must never leak into the next.
  __resetBridgeForTests();
});

describe('clientSubAgentBridge settlement', () => {
  // The bridge is the authoritative stats writer: the deferred placeholder
  // state must be replaced with terminal status + final totals, and the child
  // thread must be settled (the parked child skipped the normal path).
  it('persists terminal plugin state and settles the child thread', async () => {
    registerArmedSubAgentBridge(subAgentRegistration);
    const { get, store } = makeGet();

    await fireClientSubAgentBridge(get, childContext);

    expect(store.optimisticUpdatePluginState).toHaveBeenCalledWith(
      'tool-msg-1',
      expect.objectContaining({ status: 'completed', totalToolCalls: expect.any(Number) }),
    );
  });

  // P1 (round-25): the settlement must settle STATUS only — the thread's
  // `sourceMessageId` is the parent's tool message, and a `resultContent`
  // here made the server publish the RAW child output over it before the
  // result-control review could deny it. The controlled result is published
  // later by the backfill; the settlement must never carry content.
  it('settlement never carries resultContent (raw output must not bypass result control)', async () => {
    registerArmedSubAgentBridge(subAgentRegistration);
    const { get } = makeGet();
    const { aiAgentService } = await import('@/services/aiAgent');

    await fireClientSubAgentBridge(get, childContext);

    const settleCall = (aiAgentService.updateClientTaskThreadStatus as any).mock.calls[0]?.[0];
    expect(settleCall).toBeDefined();
    expect(settleCall.resultContent).toBeUndefined();
    // Failure disposition still rides the metadata-only `error` field.
    expect(settleCall.completionReason).toBe('done');
  });

  // P2 (round-9): a transiently failing settlement must be retried within
  // bounds — the fire continues to the parent resume once it succeeds.
  it('settlement transient failure: retries within bounds and completes the fire', async () => {
    vi.useFakeTimers();
    try {
      registerArmedSubAgentBridge(subAgentRegistration);
      const { get, store } = makeGet();
      const { aiAgentService } = await import('@/services/aiAgent');
      (aiAgentService.updateClientTaskThreadStatus as any)
        .mockRejectedValueOnce(new Error('network blip'))
        .mockRejectedValueOnce(new Error('network blip'))
        .mockResolvedValueOnce(undefined);

      const fire = fireClientSubAgentBridge(get, childContext);
      await vi.runAllTimersAsync();
      await fire;

      expect(aiAgentService.updateClientTaskThreadStatus).toHaveBeenCalledTimes(3);
      expect(store.optimisticUpdateMessageContent).toHaveBeenCalledWith(
        'tool-msg-1',
        'child final answer',
        undefined,
        { operationId: 'op_parent' },
      );
      expect(store.executeClientAgent).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  // P2 (round-9): a persistently failing settlement must abort the fire and
  // restore the claim + barrier slot — the parent must NOT be resumed with
  // the child thread still `processing`, and the automatic retry (P1
  // round-10) settles it once the outage recovers. The retry is driven
  // purely by the scheduled timer: the child's terminal boundary was the only
  // production caller, so no second manual fire is available in production.
  it('settlement persistent failure: restores claim, scheduled retry settles after recovery', async () => {
    vi.useFakeTimers();
    try {
      registerArmedSubAgentBridge(subAgentRegistration);
      const { get, store } = makeGet();
      const { aiAgentService } = await import('@/services/aiAgent');
      (aiAgentService.updateClientTaskThreadStatus as any).mockRejectedValue(
        new Error('server down'),
      );

      // fireClientSubAgentBridge must still resolve — a bridge failure must
      // not fail the child run boundary. Advance only through the in-fire
      // settle backoffs (1s + 2s): the scheduled automatic retry at +5s must
      // NOT run yet, so the recovery below lands within the retry budget.
      const fire = fireClientSubAgentBridge(get, childContext);
      await vi.advanceTimersByTimeAsync(3000);
      await fire;

      expect(aiAgentService.updateClientTaskThreadStatus).toHaveBeenCalledTimes(3);
      // The fire aborted before the parent path: no backfill, no resume.
      expect(store.optimisticUpdateMessageContent).not.toHaveBeenCalled();
      expect(store.executeClientAgent).not.toHaveBeenCalled();

      // The outage recovers BEFORE the next scheduled automatic retry: the
      // timer — not a manual re-fire — drives the settlement and resume.
      (aiAgentService.updateClientTaskThreadStatus as any).mockResolvedValue(undefined);
      await vi.advanceTimersByTimeAsync(5000);

      expect(store.optimisticUpdateMessageContent).toHaveBeenCalledWith(
        'tool-msg-1',
        'child final answer',
        undefined,
        { operationId: 'op_parent' },
      );
      expect(store.executeClientAgent).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  // P1 (round-11): the automatic retry must never leave the bridge without a
  // driver. After the 4-attempt burst, a slow 60s poll keeps firing until the
  // outage recovers — the poll is the only production driver left, so the
  // recovery must land through it (no manual re-fire).
  it('retry burst exhausts into slow poll: poll keeps driving until recovery settles', async () => {
    vi.useFakeTimers();
    try {
      registerArmedSubAgentBridge(subAgentRegistration);
      const { get, store } = makeGet();
      const { aiAgentService } = await import('@/services/aiAgent');
      (aiAgentService.updateClientTaskThreadStatus as any).mockRejectedValue(
        new Error('server down'),
      );

      // Initial fire + burst: burn 3 in-fire attempts, then advance through
      // the 4 scheduled retries (5s/10s/15s/20s), each re-firing 3 attempts.
      const fire = fireClientSubAgentBridge(get, childContext);
      await vi.advanceTimersByTimeAsync(3000);
      await fire;
      expect(store.executeClientAgent).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(60_000);

      // The burst is over (initial + 4 retries × 3 settle attempts = 15 in
      // total, minus boundary-straddling attempts) and the slow poll has
      // fired; exact count depends on timer boundaries, so assert a floor.
      expect(aiAgentService.updateClientTaskThreadStatus.mock.calls.length).toBeGreaterThanOrEqual(
        12,
      );

      // The outage recovers while the slow poll keeps driving: the next 60s
      // tick — not a manual re-fire — settles the thread and resumes.
      (aiAgentService.updateClientTaskThreadStatus as any).mockResolvedValue(undefined);
      await vi.advanceTimersByTimeAsync(120_000);

      expect(store.optimisticUpdateMessageContent).toHaveBeenCalledWith(
        'tool-msg-1',
        'child final answer',
        undefined,
        { operationId: 'op_parent' },
      );
      expect(store.executeClientAgent).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
