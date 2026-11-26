import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createHeteroControlFakeRedis } from '@/server/services/redis/heteroControl.fake';

import { reportHeteroControlResult, takeHeteroControl } from './heteroControl';
import { setHeteroPermissionMode } from './heteroPermissionMode';

const getRedisServiceClient = vi.hoisted(() => vi.fn());
vi.mock('@/server/services/redis/client', () => ({ getRedisServiceClient }));

beforeEach(() => {
  getRedisServiceClient.mockResolvedValue(createHeteroControlFakeRedis());
});

describe('setHeteroPermissionMode', () => {
  it('queues set_permission_mode for the run and reports Claude Code confirming', async () => {
    const switching = setHeteroPermissionMode('op-1', 'acceptEdits', {
      pollMs: 5,
      timeoutMs: 2000,
    });

    let message: Awaited<ReturnType<typeof takeHeteroControl>>;
    await vi.waitFor(async () => {
      message ??= await takeHeteroControl('op-1');
      expect(message).toBeDefined();
    });
    expect(message!).toMatchObject({
      command: 'set_permission_mode',
      params: { mode: 'acceptEdits' },
    });
    // As root, `lh` takes acceptEdits for a bypass pick and says so.
    await reportHeteroControlResult('op-1', message!.id, {
      data: { mode: 'acceptEdits' },
      status: 'ok',
    });

    await expect(switching).resolves.toEqual({ mode: 'acceptEdits', status: 'accepted' });
  });

  it('tells an lh without the handler apart from an unreachable run', async () => {
    const switching = setHeteroPermissionMode('op-old', 'plan', { pollMs: 5, timeoutMs: 2000 });
    let message: Awaited<ReturnType<typeof takeHeteroControl>>;
    await vi.waitFor(async () => {
      message ??= await takeHeteroControl('op-old');
      expect(message).toBeDefined();
    });
    await reportHeteroControlResult('op-old', message!.id, { status: 'unsupported' });
    await expect(switching).resolves.toEqual({ status: 'unsupported' });

    await expect(
      setHeteroPermissionMode('op-quiet', 'plan', { pollMs: 5, timeoutMs: 30 }),
    ).resolves.toEqual({ status: 'unreachable' });
  });
});
