import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHeteroControlFakeRedis } from '@/server/services/redis/heteroControl.fake';

import {
  enqueueHeteroControl,
  HETERO_CONTROL_DEFAULT_TTL_MS,
  readHeteroControlResult,
  reportHeteroControlResult,
  sendHeteroControl,
  takeHeteroControl,
  waitHeteroControlResult,
} from './heteroControl';

const getRedisServiceClient = vi.hoisted(() => vi.fn());
vi.mock('@/server/services/redis/client', () => ({ getRedisServiceClient }));

beforeEach(() => {
  getRedisServiceClient.mockResolvedValue(createHeteroControlFakeRedis());
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('enqueueHeteroControl', () => {
  it('queues a generic message and returns its id', async () => {
    const id = await enqueueHeteroControl('op-1', 'test_command', { taskId: 't-1' });

    expect(await readHeteroControlResult('op-1', id)).toEqual({ status: 'pending' });
    expect(await takeHeteroControl('op-1')).toEqual({
      command: 'test_command',
      createdAt: expect.any(Number),
      id,
      params: { taskId: 't-1' },
    });
    expect(await readHeteroControlResult('op-1', id)).toEqual({ status: 'claimed' });
  });

  it('stores missing params as null', async () => {
    await enqueueHeteroControl('op-1', 'test_command');
    expect((await takeHeteroControl('op-1'))?.params).toBeNull();
  });

  it('expires after the default ttl when nobody claims it', async () => {
    const now = Date.now();
    const id = await enqueueHeteroControl('op-1', 'test_command');

    vi.spyOn(Date, 'now').mockReturnValue(now + HETERO_CONTROL_DEFAULT_TTL_MS - 1);
    expect(await readHeteroControlResult('op-1', id)).toEqual({ status: 'pending' });
    vi.spyOn(Date, 'now').mockReturnValue(now + HETERO_CONTROL_DEFAULT_TTL_MS + 1);
    expect(await readHeteroControlResult('op-1', id)).toEqual({ status: 'expired' });
    expect(await takeHeteroControl('op-1')).toBeUndefined();
  });

  it('refuses an empty command', async () => {
    await expect(enqueueHeteroControl('op-1', '')).rejects.toThrow('needs a command');
  });

  it('fails without Redis', async () => {
    getRedisServiceClient.mockResolvedValue(null);
    await expect(enqueueHeteroControl('op-1', 'test_command')).rejects.toThrow(
      'Redis is unavailable',
    );
  });
});

describe('waitHeteroControlResult', () => {
  it('resolves with the report once the run sends it', async () => {
    const id = await enqueueHeteroControl('op-1', 'test_command');
    await takeHeteroControl('op-1');

    const waiting = waitHeteroControlResult('op-1', id, { pollMs: 5, timeoutMs: 2000 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await reportHeteroControlResult('op-1', id, { data: 1, status: 'ok' })).toBe('recorded');

    expect(await waiting).toEqual({ data: 1, status: 'ok' });
  });

  it('answers the last state at the timeout', async () => {
    const id = await enqueueHeteroControl('op-1', 'test_command');
    await takeHeteroControl('op-1');

    expect(await waitHeteroControlResult('op-1', id, { pollMs: 5, timeoutMs: 20 })).toEqual({
      status: 'claimed',
    });
  });

  it('answers undefined for an unknown id', async () => {
    expect(await waitHeteroControlResult('op-1', 'nope', { timeoutMs: 20 })).toBeUndefined();
  });
});

describe('sendHeteroControl', () => {
  it('settles as expired when no poller takes it (an older lh)', async () => {
    const { id, state } = await sendHeteroControl('op-1', 'test_command', null, {
      pollMs: 5,
      timeoutMs: 30,
    });

    expect(state).toEqual({ status: 'expired' });
    // Gone for a poller that shows up late, too.
    expect(await takeHeteroControl('op-1')).toBeUndefined();
    expect(await readHeteroControlResult('op-1', id)).toEqual({ status: 'expired' });
  });

  it('returns what the run reported', async () => {
    const sending = sendHeteroControl('op-1', 'test_command', null, {
      pollMs: 5,
      timeoutMs: 2000,
    });
    let message;
    while (!(message = await takeHeteroControl('op-1'))) {
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    await reportHeteroControlResult('op-1', message.id, { status: 'unsupported' });

    expect(await sending).toEqual({ id: message.id, state: { status: 'unsupported' } });
  });
});

describe('reportHeteroControlResult', () => {
  it('ignores a report for a message nobody claimed', async () => {
    const id = await enqueueHeteroControl('op-1', 'test_command');
    expect(await reportHeteroControlResult('op-1', id, { status: 'ok' })).toBe('pending');
    expect(await readHeteroControlResult('op-1', id)).toEqual({ status: 'pending' });
  });
});
