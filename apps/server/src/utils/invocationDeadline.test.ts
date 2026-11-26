import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createInvocationDeadlineSignal,
  isInvocationDeadlineAbort,
  runWithInvocationDeadline,
} from './invocationDeadline';

describe('createInvocationDeadlineSignal', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns nothing when the host declared no deadline', () => {
    expect(createInvocationDeadlineSignal({ marginMs: 30_000, minMs: 15_000 })).toBeUndefined();
  });

  it('aborts the margin before the deadline with a recognizable reason', async () => {
    await runWithInvocationDeadline(Date.now() + 100_000, async () => {
      const deadline = createInvocationDeadlineSignal({ marginMs: 30_000, minMs: 15_000 })!;

      vi.advanceTimersByTime(69_999);
      expect(deadline.signal.aborted).toBe(false);

      vi.advanceTimersByTime(1);
      expect(isInvocationDeadlineAbort(deadline.signal)).toBe(true);
    });
  });

  it('still gives work that starts late its minimum window', async () => {
    await runWithInvocationDeadline(Date.now() + 20_000, async () => {
      const deadline = createInvocationDeadlineSignal({ marginMs: 30_000, minMs: 15_000 })!;

      vi.advanceTimersByTime(14_999);
      expect(deadline.signal.aborted).toBe(false);

      vi.advanceTimersByTime(1);
      expect(deadline.signal.aborted).toBe(true);
    });
  });

  it('never fires once disposed', async () => {
    await runWithInvocationDeadline(Date.now() + 100_000, async () => {
      const deadline = createInvocationDeadlineSignal({ marginMs: 30_000, minMs: 15_000 })!;
      deadline.dispose();

      vi.advanceTimersByTime(100_000);
      expect(deadline.signal.aborted).toBe(false);
    });
  });
});

describe('isInvocationDeadlineAbort', () => {
  it('ignores other aborts, such as a user stop', () => {
    const controller = new AbortController();
    controller.abort(new Error('user stop'));

    expect(isInvocationDeadlineAbort(controller.signal)).toBe(false);
    expect(isInvocationDeadlineAbort(undefined)).toBe(false);
  });
});
