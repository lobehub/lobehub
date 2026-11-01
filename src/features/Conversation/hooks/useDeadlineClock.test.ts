/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type PendingIntervention } from '../store/slices/data/pendingInterventions';
import { useIsTimedOutUnanswered, useUnexpiredInterventions } from './useDeadlineClock';

const card = (toolCallId: string, deadline?: number): PendingIntervention => ({
  apiName: 'askUserQuestion',
  deadline,
  identifier: 'claude-code',
  intervention: { status: 'pending' },
  requestArgs: '{}',
  toolCallId,
  toolMessageId: `tool-${toolCallId}`,
});

describe('useUnexpiredInterventions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-22T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('drops a mounted card the moment its producer deadline passes, with no store change', () => {
    // Regression: the pending list is recomputed only on store updates. A card
    // whose form never writes at expiry (provider-owned options skip the
    // auto-answer) stayed on screen, unanswerable, until some unrelated update.
    const interventions = [
      card('expiring', Date.now() + 10_000),
      card('later', Date.now() + 60_000),
    ];
    const hook = renderHook(({ list }) => useUnexpiredInterventions(list), {
      initialProps: { list: interventions },
    });

    expect(hook.result.current.map((item) => item.toolCallId)).toEqual(['expiring', 'later']);

    act(() => vi.advanceTimersByTime(9999));
    expect(hook.result.current.map((item) => item.toolCallId)).toEqual(['expiring', 'later']);

    act(() => vi.advanceTimersByTime(1));
    expect(hook.result.current.map((item) => item.toolCallId)).toEqual(['later']);

    // Re-arms for the next deadline on its own.
    act(() => vi.advanceTimersByTime(50_000));
    expect(hook.result.current).toEqual([]);
  });

  it('keeps cards whose producer never stamped a deadline', () => {
    const hook = renderHook(() => useUnexpiredInterventions([card('no-deadline')]));

    act(() => vi.advanceTimersByTime(24 * 60 * 60 * 1000));

    expect(hook.result.current.map((item) => item.toolCallId)).toEqual(['no-deadline']);
  });

  it('still expires the card when the timer fires a hair before the deadline', () => {
    const deadline = Date.now() + 5000;
    const hook = renderHook(() => useUnexpiredInterventions([card('edge', deadline)]));

    // Simulate a timer that runs 1ms early: the wall clock reads deadline - 1
    // when the callback executes. The card must still leave, or the next
    // deadline would not change and nothing would re-arm.
    const early = vi.spyOn(Date, 'now').mockReturnValue(deadline - 1);
    act(() => vi.advanceTimersToNextTimer());
    early.mockRestore();

    expect(hook.result.current).toEqual([]);
  });
});

describe('useIsTimedOutUnanswered', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-22T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const stateWith = (deadline: number) => ({ heterogeneousIntervention: { deadline } });

  it('flips a mounted row to timed-out at the deadline, with no re-render from outside', () => {
    // Regression: once the card leaves at the deadline, the inline row is the
    // only place left to say what happened — and it only re-evaluated when
    // something else rendered it, so it sat blank.
    const state = stateWith(Date.now() + 8000);
    const hook = renderHook(() => useIsTimedOutUnanswered({ status: 'pending' }, state));

    expect(hook.result.current).toBe(false);
    act(() => vi.advanceTimersByTime(8000));
    expect(hook.result.current).toBe(true);
  });

  it('never labels an in-flight answer as timed out', () => {
    const hook = renderHook(() =>
      useIsTimedOutUnanswered({ resolving: true, status: 'pending' }, stateWith(Date.now() - 1000)),
    );

    expect(hook.result.current).toBe(false);
  });

  it('ignores settled interventions and rows without a producer deadline', () => {
    const settled = renderHook(() =>
      useIsTimedOutUnanswered({ status: 'approved' }, stateWith(Date.now() - 1000)),
    );
    const noDeadline = renderHook(() => useIsTimedOutUnanswered({ status: 'pending' }, {}));

    expect(settled.result.current).toBe(false);
    expect(noDeadline.result.current).toBe(false);
  });
});
