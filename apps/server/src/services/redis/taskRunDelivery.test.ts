import { beforeEach, describe, expect, it, vi } from 'vitest';

import { taskRunDelivery } from './taskRunDelivery';

const { client, getRedisServiceClient } = vi.hoisted(() => {
  const client = { del: vi.fn(), get: vi.fn(), set: vi.fn() };
  return { client, getRedisServiceClient: vi.fn() };
});
vi.mock('./client', () => ({ getRedisServiceClient }));

describe('taskRunDelivery', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getRedisServiceClient.mockResolvedValue(client);
  });

  it('claims the first delivery of an operation under a lease', async () => {
    client.set.mockResolvedValue('OK');

    await expect(taskRunDelivery.claim('op-1')).resolves.toBe('claimed');
    expect(client.set).toHaveBeenCalledWith('task_run_delivery:v1:op-1', 'settling', {
      nx: true,
      px: 10 * 60 * 1000,
    });
  });

  it('reports a redelivery while the first one still holds the lease', async () => {
    client.set.mockResolvedValue(null);
    client.get.mockResolvedValue('settling');

    await expect(taskRunDelivery.claim('op-1')).resolves.toBe('in-progress');
  });

  it('reports a redelivery of a settled operation', async () => {
    client.set.mockResolvedValue(null);
    client.get.mockResolvedValue('settled');

    await expect(taskRunDelivery.claim('op-1')).resolves.toBe('settled');
  });

  it('cannot arbitrate without Redis or when a command fails', async () => {
    getRedisServiceClient.mockResolvedValueOnce(null);
    await expect(taskRunDelivery.claim('op-1')).resolves.toBe('unavailable');

    client.set.mockRejectedValue(new Error('timeout'));
    await expect(taskRunDelivery.claim('op-1')).resolves.toBe('unavailable');
  });

  it('remembers a settled operation past the retry window', async () => {
    client.set.mockResolvedValue('OK');

    await taskRunDelivery.markSettled('op-1');

    expect(client.set).toHaveBeenCalledWith('task_run_delivery:v1:op-1', 'settled', {
      px: 3 * 24 * 60 * 60 * 1000,
    });
  });

  it('releases a failed claim and swallows Redis errors', async () => {
    client.del.mockRejectedValue(new Error('timeout'));

    await expect(taskRunDelivery.release('op-1')).resolves.toBeUndefined();
    expect(client.del).toHaveBeenCalledWith('task_run_delivery:v1:op-1');
  });
});
