// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  OPPORTUNISTIC_SWEEP_INTERVAL_MS,
  OPPORTUNISTIC_SWEEP_SLOT_KEY,
  runOpportunisticSweep,
  scheduleOpportunisticStaleSweep,
} from '../opportunisticSweep';

const sweepMock = vi.fn().mockResolvedValue({ abandoned: 0, redriven: 1 });
vi.mock('../StaleOperationReaper', () => ({
  StaleOperationReaper: vi.fn().mockImplementation(function () {
    return { sweep: sweepMock };
  }),
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
