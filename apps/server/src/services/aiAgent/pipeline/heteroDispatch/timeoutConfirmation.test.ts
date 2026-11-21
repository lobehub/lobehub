import { beforeEach, describe, expect, it, vi } from 'vitest';

import { confirmTimedOutDispatch, HETERO_DISPATCH_CONFIRM_WINDOW_MS } from './timeoutConfirmation';
import type { HeteroDispatchDeps, HeteroRun } from './types';

const mocks = vi.hoisted(() => ({
  failHeteroDispatch: vi.fn(),
  settleUnconfirmedRunning: vi.fn(),
}));

vi.mock('@/database/models/agentOperation', () => ({
  AgentOperationModel: vi.fn().mockImplementation(function () {
    return { settleUnconfirmedRunning: mocks.settleUnconfirmedRunning };
  }),
}));

vi.mock('./utils', () => ({ failHeteroDispatch: mocks.failHeteroDispatch }));

const deps = { db: {}, userId: 'user-1' } as unknown as HeteroDispatchDeps;
const run = { operationId: 'op-1', topicId: 'topic-1' } as HeteroRun;
const dispatchedAt = new Date('2026-10-28T02:43:56.000Z');
const finalize = { detail: '{"error":"TIMEOUT"}', message: 'timeout' };
const result = { error: '{"error":"TIMEOUT"}', message: 'Hetero agent device dispatch failed' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('confirmTimedOutDispatch', () => {
  it('keeps a run whose CLI started after the ack timed out', async () => {
    // The device spawned the CLI and its first batch refreshed the row.
    mocks.settleUnconfirmedRunning.mockResolvedValue(false);
    const wait = vi.fn().mockResolvedValue(undefined);

    await expect(
      confirmTimedOutDispatch(deps, run, { dispatchedAt, finalize, result, wait }),
    ).resolves.toBe('confirmed');

    expect(wait).toHaveBeenCalledWith(HETERO_DISPATCH_CONFIRM_WINDOW_MS);
    expect(mocks.settleUnconfirmedRunning).toHaveBeenCalledWith('op-1', dispatchedAt);
    expect(mocks.failHeteroDispatch).not.toHaveBeenCalled();
  });

  it('fails a run that never showed up with the original timeout', async () => {
    mocks.settleUnconfirmedRunning.mockResolvedValue(true);
    const wait = vi.fn().mockResolvedValue(undefined);

    await expect(
      confirmTimedOutDispatch(deps, run, { dispatchedAt, finalize, result, wait }),
    ).resolves.toBe('failed');

    expect(mocks.failHeteroDispatch).toHaveBeenCalledWith(deps, run, finalize, result);
  });

  it('claims the run only after the confirmation window', async () => {
    let release!: () => void;
    const wait = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));
    mocks.settleUnconfirmedRunning.mockResolvedValue(true);

    const pending = confirmTimedOutDispatch(deps, run, { dispatchedAt, finalize, result, wait });
    await Promise.resolve();
    expect(mocks.settleUnconfirmedRunning).not.toHaveBeenCalled();

    release();
    await pending;
    expect(mocks.settleUnconfirmedRunning).toHaveBeenCalledTimes(1);
  });
});
