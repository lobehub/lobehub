import { TRPCClientError } from '@trpc/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ASYNC_REJECTION_WINDOW_MS,
  isAsyncCallRejectedBeforeRun,
  keepAliveForAsyncRejection,
} from './rejection';

const { afterUnscoped } = vi.hoisted(() => ({ afterUnscoped: vi.fn() }));

vi.mock('@/server/utils/scheduleAfterResponse', () => ({ afterUnscoped }));

const scheduledWork = () => afterUnscoped.mock.calls.at(-1)![0] as () => Promise<void>;

const settledWithin = async (work: Promise<void>, ms: number) => {
  let settled = false;
  void work.then(() => (settled = true));
  await vi.advanceTimersByTimeAsync(ms);
  return settled;
};

describe('isAsyncCallRejectedBeforeRun', () => {
  it('only matches a refusal from the auth middleware', () => {
    const refused = new TRPCClientError('expired', {
      result: { error: { data: { code: 'UNAUTHORIZED' } } },
    } as any);

    expect(isAsyncCallRejectedBeforeRun(refused)).toBe(true);
    expect(isAsyncCallRejectedBeforeRun(new TRPCClientError('fetch failed'))).toBe(false);
    expect(isAsyncCallRejectedBeforeRun(new Error('UNAUTHORIZED'))).toBe(false);
  });
});

describe('keepAliveForAsyncRejection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    afterUnscoped.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the request alive until the async call settles', async () => {
    let settle!: () => void;
    const call = new Promise<void>((resolve) => (settle = resolve));
    keepAliveForAsyncRejection(call, call);
    const work = scheduledWork()();

    expect(await settledWithin(work, 1000)).toBe(false);
    settle();
    expect(await settledWithin(work, 0)).toBe(true);
  });

  it('lets the cleanup of a refusal near the window end run past it', async () => {
    let refuse!: (error: Error) => void;
    const call = new Promise<void>((_, reject) => (refuse = reject));
    // The refund takes 5s once the refusal arrives
    const handled = call.catch(() => new Promise<void>((resolve) => setTimeout(resolve, 5000)));
    keepAliveForAsyncRejection(call, handled);
    const work = scheduledWork()();

    expect(await settledWithin(work, ASYNC_REJECTION_WINDOW_MS - 1000)).toBe(false);
    refuse(new Error('UNAUTHORIZED'));
    expect(await settledWithin(work, 4999)).toBe(false);
    expect(await settledWithin(work, 1)).toBe(true);
  });

  it('stops waiting once the window ends for a call still running', async () => {
    const call = new Promise(() => {});
    keepAliveForAsyncRejection(call, call);
    const work = scheduledWork()();

    expect(await settledWithin(work, ASYNC_REJECTION_WINDOW_MS - 1)).toBe(false);
    expect(await settledWithin(work, 1)).toBe(true);
  });
});
