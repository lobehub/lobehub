// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  OPPORTUNISTIC_SWEEP_INTERVAL_MS,
  OPPORTUNISTIC_SWEEP_SLOT_KEY,
  OPPORTUNISTIC_VERIFY_SWEEP_INTERVAL_MS,
  OPPORTUNISTIC_VERIFY_SWEEP_SLOT_KEY,
  runOpportunisticSweep,
  runPeriodicStaleSweepTick,
  scheduleOpportunisticStaleSweep,
  scheduleOpportunisticVerifySweep,
  startPeriodicStaleSweep,
} from '../opportunisticSweep';
import { StaleOperationReaper } from '../StaleOperationReaper';

const sweepMock = vi.fn().mockResolvedValue({ abandoned: 0, redriven: 1 });
vi.mock('../StaleOperationReaper', () => ({
  StaleOperationReaper: vi.fn().mockImplementation(function () {
    return { sweep: sweepMock };
  }),
}));

const verifySweepMock = vi.fn().mockResolvedValue({ abandoned: [], redriven: [], settled: [] });
vi.mock('@/server/services/verify/sweep', () => ({
  sweepStuckVerifyRuns: (...args: any[]) => verifySweepMock(...args),
}));

let queueModeEnabled = false;
vi.mock('@/server/services/queue/impls', () => ({
  isQueueAgentRuntimeEnabled: () => queueModeEnabled,
}));

const getServerDBMock = vi.fn().mockResolvedValue({ db: 'server' });
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: (...args: any[]) => getServerDBMock(...args),
}));

const redisSetMock = vi.fn().mockResolvedValue('OK');
let redisClient: { set: typeof redisSetMock } | null = { set: redisSetMock };
vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: () => redisClient,
}));

/** Captured `after()` callbacks, so a test can choose when (and whether) to run them. */
const afterQueue: Array<() => Promise<unknown>> = [];
vi.mock('@/server/utils/scheduleAfterResponse', () => ({
  after: (work: () => Promise<unknown>) => {
    afterQueue.push(work);
  },
}));

describe('runOpportunisticSweep', () => {
  beforeEach(() => {
    sweepMock.mockReset().mockResolvedValue({ abandoned: 0, redriven: 1 });
  });

  it('sweeps when it wins the slot', async () => {
    const onError = vi.fn();
    const swept = await runOpportunisticSweep({
      claim: async () => true,
      onError,
      sweep: sweepMock,
    });

    expect(swept).toBe(true);
    expect(sweepMock).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it('does not sweep when another caller holds the slot', async () => {
    const swept = await runOpportunisticSweep({ claim: async () => false, sweep: sweepMock });

    expect(swept).toBe(false);
    expect(sweepMock).not.toHaveBeenCalled();
  });

  it('swallows a claim failure instead of failing the delivery that carried it', async () => {
    const onError = vi.fn();
    const swept = await runOpportunisticSweep({
      claim: async () => {
        throw new Error('redis down');
      },
      onError,
      sweep: sweepMock,
    });

    expect(swept).toBe(false);
    expect(sweepMock).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.any(Error), 'claim');
  });

  it('keeps the claim consumed when the sweep itself throws', async () => {
    // The slot must not be handed back: a sweep that failed once would then be
    // retried on every following step delivery, in a hot loop.
    const onError = vi.fn();
    sweepMock.mockRejectedValueOnce(new Error('pg down'));

    const swept = await runOpportunisticSweep({
      claim: async () => true,
      onError,
      sweep: sweepMock,
    });

    expect(swept).toBe(true);
    expect(onError).toHaveBeenCalledWith(expect.any(Error), 'sweep');
  });
});

describe('scheduleOpportunisticStaleSweep', () => {
  beforeEach(() => {
    afterQueue.length = 0;
    sweepMock.mockReset().mockResolvedValue({ abandoned: 0, redriven: 1 });
    redisSetMock.mockReset().mockResolvedValue('OK');
    redisClient = { set: redisSetMock };
  });

  const flush = async () => {
    const pending = [...afterQueue];
    afterQueue.length = 0;
    await Promise.all(pending.map((work) => work()));
  };

  it('does not claim or sweep when the runtime has no Redis', async () => {
    redisClient = null;

    scheduleOpportunisticStaleSweep();
    await flush();

    expect(redisSetMock).not.toHaveBeenCalled();
    expect(sweepMock).not.toHaveBeenCalled();
  });

  it('claims one slot per interval and sweeps the stale operations', async () => {
    scheduleOpportunisticStaleSweep();
    await flush();

    expect(redisSetMock).toHaveBeenCalledWith(
      OPPORTUNISTIC_SWEEP_SLOT_KEY,
      expect.any(String),
      'PX',
      OPPORTUNISTIC_SWEEP_INTERVAL_MS,
      'NX',
    );
    expect(getServerDBMock).toHaveBeenCalled();
    expect(sweepMock).toHaveBeenCalledTimes(1);
  });

  it('skips the sweep while the slot TTL is still held', async () => {
    // A step path is hot: without the slot every delivery would sweep.
    redisSetMock.mockResolvedValue(null);

    scheduleOpportunisticStaleSweep();
    scheduleOpportunisticStaleSweep();
    await flush();

    expect(redisSetMock).toHaveBeenCalledTimes(2);
    expect(sweepMock).not.toHaveBeenCalled();
  });

  it('never rejects, so a hosting delivery is unaffected', async () => {
    redisSetMock.mockRejectedValue(new Error('redis down'));

    scheduleOpportunisticStaleSweep();

    await expect(flush()).resolves.toBeUndefined();
    expect(sweepMock).not.toHaveBeenCalled();
  });
});

describe('scheduleOpportunisticVerifySweep', () => {
  beforeEach(() => {
    afterQueue.length = 0;
    verifySweepMock.mockReset().mockResolvedValue({ abandoned: [], redriven: [], settled: [] });
    redisSetMock.mockReset().mockResolvedValue('OK');
    redisClient = { set: redisSetMock };
  });

  const flush = async () => {
    const pending = [...afterQueue];
    afterQueue.length = 0;
    await Promise.all(pending.map((work) => work()));
  };

  it('claims its own slot and sweeps stranded verification rounds', async () => {
    // Its route expects a QStash Schedule no deployment registers, so the step
    // path is the only thing that ever runs this sweep.
    scheduleOpportunisticVerifySweep();
    await flush();

    expect(redisSetMock).toHaveBeenCalledWith(
      OPPORTUNISTIC_VERIFY_SWEEP_SLOT_KEY,
      expect.any(String),
      'PX',
      OPPORTUNISTIC_VERIFY_SWEEP_INTERVAL_MS,
      'NX',
    );
    expect(OPPORTUNISTIC_VERIFY_SWEEP_SLOT_KEY).not.toBe(OPPORTUNISTIC_SWEEP_SLOT_KEY);
    expect(verifySweepMock).toHaveBeenCalledWith({ db: 'server' });
  });

  it('skips the sweep while its slot TTL is still held', async () => {
    redisSetMock.mockResolvedValue(null);

    scheduleOpportunisticVerifySweep();
    await flush();

    expect(verifySweepMock).not.toHaveBeenCalled();
  });

  it('never rejects when the sweep throws', async () => {
    verifySweepMock.mockRejectedValue(new Error('pg down'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    scheduleOpportunisticVerifySweep();

    await expect(flush()).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

describe('periodic stale sweep', () => {
  beforeEach(() => {
    sweepMock.mockReset().mockResolvedValue({ abandoned: 0, failed: 0, redriven: 0 });
    redisSetMock.mockReset().mockResolvedValue('OK');
    redisClient = { set: redisSetMock };
    queueModeEnabled = false;
    vi.mocked(StaleOperationReaper).mockClear();
  });

  it('claims the shared slot, so replicas and the step-borne sweep run once per interval', async () => {
    await expect(runPeriodicStaleSweepTick()).resolves.toBe(true);

    expect(redisSetMock).toHaveBeenCalledWith(
      OPPORTUNISTIC_SWEEP_SLOT_KEY,
      expect.any(String),
      'PX',
      OPPORTUNISTIC_SWEEP_INTERVAL_MS,
      'NX',
    );
    expect(sweepMock).toHaveBeenCalledTimes(1);
  });

  it('skips the tick while another sweeper holds the slot', async () => {
    redisSetMock.mockResolvedValue(null);

    await expect(runPeriodicStaleSweepTick()).resolves.toBe(false);
    expect(sweepMock).not.toHaveBeenCalled();
  });

  it('sweeps every tick when the single-process runtime has no Redis', async () => {
    // Unlike the step-borne sweep, which needs Redis: this one is the only
    // sweep a Redis-less self-hosted server ever runs.
    redisClient = null;

    await expect(runPeriodicStaleSweepTick()).resolves.toBe(true);
    expect(redisSetMock).not.toHaveBeenCalled();
    expect(sweepMock).toHaveBeenCalledTimes(1);
  });

  it('gives the reaper no queue on the in-process runtime, so it never redrives into nothing', async () => {
    await runPeriodicStaleSweepTick();

    expect(StaleOperationReaper).toHaveBeenCalledWith({ db: 'server' }, { queueService: null });
  });

  it('keeps the default queue when steps run through the queue', async () => {
    queueModeEnabled = true;

    await runPeriodicStaleSweepTick();

    expect(StaleOperationReaper).toHaveBeenCalledWith(
      { db: 'server' },
      { queueService: undefined },
    );
  });

  it('never rejects when the sweep throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    sweepMock.mockRejectedValue(new Error('db down'));

    await expect(runPeriodicStaleSweepTick()).resolves.toBe(true);
    expect(consoleError).toHaveBeenCalledWith(
      '[periodic-stale-sweep] sweep failed: %O',
      expect.any(Error),
    );
    consoleError.mockRestore();
  });

  describe('timer', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('sweeps once per interval until stopped, and starts only one timer', async () => {
      const stop = startPeriodicStaleSweep(1000);
      expect(startPeriodicStaleSweep(1000)).toBe(stop);

      await vi.advanceTimersByTimeAsync(1000);
      expect(sweepMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1000);
      expect(sweepMock).toHaveBeenCalledTimes(2);

      stop();
      await vi.advanceTimersByTimeAsync(5000);
      expect(sweepMock).toHaveBeenCalledTimes(2);

      // A stopped timer can be started again.
      const restarted = startPeriodicStaleSweep(1000);
      expect(restarted).not.toBe(stop);
      restarted();
    });
  });
});
