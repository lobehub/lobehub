import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createHeteroControlFakeRedis } from '@/server/services/redis/heteroControl.fake';

import { reportHeteroControlResult, takeHeteroControl } from './heteroControl';
import { stopHeteroBackgroundTask, toHeteroStopTaskResult } from './heteroStopTask';

const getRedisServiceClient = vi.hoisted(() => vi.fn());
vi.mock('@/server/services/redis/client', () => ({ getRedisServiceClient }));

beforeEach(() => {
  getRedisServiceClient.mockResolvedValue(createHeteroControlFakeRedis());
});

describe('stopHeteroBackgroundTask', () => {
  it('queues stop_task for the run and reports the run accepting it', async () => {
    const stopping = stopHeteroBackgroundTask('op-1', 'bys1w0wxo', { pollMs: 5, timeoutMs: 2000 });

    let message: Awaited<ReturnType<typeof takeHeteroControl>>;
    await vi.waitFor(async () => {
      message ??= await takeHeteroControl('op-1');
      expect(message).toBeDefined();
    });
    expect(message!).toMatchObject({ command: 'stop_task', params: { taskId: 'bys1w0wxo' } });
    await reportHeteroControlResult('op-1', message!.id, { status: 'ok' });

    await expect(stopping).resolves.toEqual({ status: 'accepted' });
  });

  it('calls a run nobody polls for unreachable', async () => {
    await expect(
      stopHeteroBackgroundTask('op-quiet', 'bys1w0wxo', { pollMs: 5, timeoutMs: 30 }),
    ).resolves.toEqual({ status: 'unreachable' });
  });
});

describe('toHeteroStopTaskResult', () => {
  it('maps every control state', () => {
    expect(toHeteroStopTaskResult({ status: 'unsupported' })).toEqual({ status: 'unsupported' });
    expect(toHeteroStopTaskResult({ error: 'No task found', status: 'error' })).toEqual({
      error: 'No task found',
      status: 'failed',
    });
    expect(toHeteroStopTaskResult({ status: 'claimed' })).toEqual({ status: 'timeout' });
    expect(toHeteroStopTaskResult({ status: 'pending' })).toEqual({ status: 'timeout' });
    expect(toHeteroStopTaskResult(undefined)).toEqual({ status: 'timeout' });
  });
});
