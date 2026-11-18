// @vitest-environment node
import { ThreadStatus } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { settleRunThread } from './persistence';

const { mockFindById, mockSettleRun } = vi.hoisted(() => ({
  mockFindById: vi.fn(),
  mockSettleRun: vi.fn(),
}));

vi.mock('@/database/models/thread', () => ({
  ThreadModel: vi.fn(function () {
    return { findById: mockFindById, settleRun: mockSettleRun };
  }),
}));

const deps = { serverDB: {}, userId: 'user-1' } as any;
const origin = { threadId: 'thd-1', userId: 'user-1' };

describe('settleRunThread', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindById.mockResolvedValue({
      metadata: {
        operationId: 'op-1',
        sourceToolCallId: 'call-1',
        runUsageBaseline: { totalTokens: 100 },
        startedAt: '2026-10-01T00:00:00.000Z',
        totalTokens: 130,
      },
    });
    mockSettleRun.mockResolvedValue(true);
  });

  it.each([
    ['done', ThreadStatus.Completed],
    ['max_steps', ThreadStatus.Completed],
    ['error', ThreadStatus.Failed],
    ['interrupted', ThreadStatus.Cancel],
  ])('maps %s to %s', async (reason, status) => {
    await settleRunThread(deps, 'op-1', { origin }, reason);

    expect(mockSettleRun).toHaveBeenCalledWith(
      'thd-1',
      'op-1',
      expect.objectContaining({ status }),
    );
  });

  it('keeps earlier metadata and adds this run on top of earlier usage', async () => {
    await settleRunThread(
      deps,
      'op-1',
      { origin, usage: { llm: { tokens: { total: 50 } } } },
      'done',
    );

    expect(mockSettleRun.mock.calls[0][2].metadata).toMatchObject({
      completedAt: expect.any(String),
      operationId: 'op-1',
      sourceToolCallId: 'call-1',
      startedAt: '2026-10-01T00:00:00.000Z',
      totalTokens: 150,
    });
  });

  it('ignores usage that polling wrote for the same run', async () => {
    mockFindById.mockResolvedValue({
      metadata: { operationId: 'op-1', startedAt: '2026-10-01T00:00:00.000Z', totalTokens: 100 },
    });

    await settleRunThread(
      deps,
      'op-1',
      { origin, usage: { llm: { tokens: { total: 150 } } } },
      'done',
    );

    expect(mockSettleRun.mock.calls[0][2].metadata.totalTokens).toBe(150);
  });

  it('settles a run that ends before its operation id is written', async () => {
    mockFindById.mockResolvedValue({ metadata: { startedAt: '2026-10-01T00:00:00.000Z' } });

    await settleRunThread(deps, 'op-1', { createdAt: '2026-10-01T00:00:01.000Z', origin }, 'done');

    expect(mockSettleRun).toHaveBeenCalled();
  });

  it('does not settle a follow-up claim that started after this run', async () => {
    mockFindById.mockResolvedValue({ metadata: { startedAt: '2026-10-01T00:05:00.000Z' } });

    await settleRunThread(deps, 'op-1', { createdAt: '2026-10-01T00:00:01.000Z', origin }, 'done');

    expect(mockSettleRun).not.toHaveBeenCalled();
  });

  it('does not settle a thread owned by another run', async () => {
    mockFindById.mockResolvedValue({
      metadata: { operationId: 'op-2', startedAt: '2026-10-01T00:00:00.000Z' },
    });

    await settleRunThread(deps, 'op-1', { origin }, 'done');

    expect(mockSettleRun).not.toHaveBeenCalled();
  });

  it('records the run error on the thread', async () => {
    await settleRunThread(deps, 'op-1', { error: new Error('boom'), origin }, 'error');

    expect(mockSettleRun.mock.calls[0][2].metadata.error).toMatchObject({ message: 'boom' });
  });

  it('skips runs without a thread and runs parked for approval', async () => {
    await settleRunThread(deps, 'op-1', { origin: {} }, 'done');
    await settleRunThread(deps, 'op-1', { origin }, 'waiting_for_human');

    expect(mockFindById).not.toHaveBeenCalled();
  });

  it('does not throw when the thread write fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockSettleRun.mockRejectedValue(new Error('db down'));

    await expect(settleRunThread(deps, 'op-1', { origin }, 'done')).resolves.toBeUndefined();
    consoleError.mockRestore();
  });
});
