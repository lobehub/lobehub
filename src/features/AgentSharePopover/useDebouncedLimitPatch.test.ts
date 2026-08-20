import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDebouncedLimitPatch } from './useDebouncedLimitPatch';

describe('useDebouncedLimitPatch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('commits edits to both fields as one patch', () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() => useDebouncedLimitPatch(onCommit));

    act(() => {
      result.current('maxTopicsPerVisitor', 8);
      result.current('maxTurnsPerTopic', 30);
      vi.advanceTimersByTime(500);
    });

    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit).toHaveBeenCalledWith({
      maxTopicsPerVisitor: 8,
      maxTurnsPerTopic: 30,
    });
  });

  it('flushes the latest valid edit when the settings modal unmounts', () => {
    const onCommit = vi.fn();
    const { result, unmount } = renderHook(() => useDebouncedLimitPatch(onCommit));

    act(() => {
      result.current('maxTurnsPerTopic', 40);
    });
    unmount();

    expect(onCommit).toHaveBeenCalledWith({ maxTurnsPerTopic: 40 });
  });

  it('does not let an invalid edit cancel a pending valid field', () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() => useDebouncedLimitPatch(onCommit));

    act(() => {
      result.current('maxTopicsPerVisitor', 12);
      result.current('maxTurnsPerTopic', null);
      vi.advanceTimersByTime(500);
    });

    expect(onCommit).toHaveBeenCalledWith({ maxTopicsPerVisitor: 12 });
  });

  it('cancels a pending field when a later edit to that field is invalid', () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() => useDebouncedLimitPatch(onCommit));

    act(() => {
      result.current('maxTopicsPerVisitor', 12);
      result.current('maxTopicsPerVisitor', null);
      vi.advanceTimersByTime(500);
    });

    expect(onCommit).not.toHaveBeenCalled();
  });

  it('reports the exact patch when a debounced commit fails', async () => {
    const onCommit = vi.fn().mockRejectedValue(new Error('network down'));
    const onCommitError = vi.fn();
    const { result } = renderHook(() => useDebouncedLimitPatch(onCommit, onCommitError));

    act(() => {
      result.current('maxTurnsPerTopic', 40);
      vi.advanceTimersByTime(500);
    });
    await act(async () => {});

    expect(onCommitError).toHaveBeenCalledWith({ maxTurnsPerTopic: 40 });
  });
});
