/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveLimitCommitTarget, useDebouncedLimitPatch } from './useDebouncedLimitPatch';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useDebouncedLimitPatch', () => {
  it('merges both fields into one patch after the delay', () => {
    const commit = vi.fn();
    const { result } = renderHook(() => useDebouncedLimitPatch('agent-1', commit));

    act(() => {
      result.current({ maxTopicsPerVisitor: 3 });
      result.current({ maxTurnsPerTopic: 9 });
      vi.advanceTimersByTime(500);
    });

    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith({ maxTopicsPerVisitor: 3, maxTurnsPerTopic: 9 }, 'agent-1');
  });

  it('keeps the newest value for a field edited twice', () => {
    const commit = vi.fn();
    const { result } = renderHook(() => useDebouncedLimitPatch('agent-1', commit));

    act(() => {
      result.current({ maxTurnsPerTopic: 9 });
      result.current({ maxTurnsPerTopic: 11 });
      vi.advanceTimersByTime(500);
    });

    expect(commit).toHaveBeenCalledWith({ maxTurnsPerTopic: 11 }, 'agent-1');
  });

  it('flushes a pending patch on unmount so a fast close does not lose the edit', () => {
    const commit = vi.fn();
    const { result, unmount } = renderHook(() => useDebouncedLimitPatch('agent-1', commit));

    act(() => {
      result.current({ maxTopicsPerVisitor: 4 });
    });
    expect(commit).not.toHaveBeenCalled();

    act(() => {
      unmount();
    });

    expect(commit).toHaveBeenCalledWith({ maxTopicsPerVisitor: 4 }, 'agent-1');
  });

  it('does not commit again on unmount once the timer already fired', () => {
    const commit = vi.fn();
    const { result, unmount } = renderHook(() => useDebouncedLimitPatch('agent-1', commit));

    act(() => {
      result.current({ maxTopicsPerVisitor: 4 });
      vi.advanceTimersByTime(500);
    });
    act(() => {
      unmount();
    });

    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('settles the caller even when the commit rejects', async () => {
    const commit = vi.fn().mockRejectedValue(new Error('save failed'));
    const settled = vi.fn();
    const { result } = renderHook(() => useDebouncedLimitPatch('agent-1', commit, settled));

    act(() => {
      result.current({ maxTurnsPerTopic: 7 });
      vi.advanceTimersByTime(500);
    });
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(settled).toHaveBeenCalledWith({ maxTurnsPerTopic: 7 });
  });

  it('flushes a pending patch through the previous identity onCommit when the identity changes, never through the new one', () => {
    // Regression: the share settings page is not remounted when navigating
    // agent A's share page -> agent B's, so without identity scoping A's
    // still-pending edit would flush through B's onCommit within the debounce
    // window instead of A's.
    const commitA = vi.fn();
    const commitB = vi.fn();

    const { result, rerender } = renderHook(
      ({ agentId, commit }) => useDebouncedLimitPatch(agentId, commit),
      { initialProps: { agentId: 'agent-a', commit: commitA } },
    );

    act(() => {
      result.current({ maxTopicsPerVisitor: 4 });
    });
    expect(commitA).not.toHaveBeenCalled();

    act(() => {
      rerender({ agentId: 'agent-b', commit: commitB });
    });

    expect(commitA).toHaveBeenCalledWith({ maxTopicsPerVisitor: 4 }, 'agent-a');
    expect(commitB).not.toHaveBeenCalled();

    // Nothing pending should carry over: advancing time after the identity
    // switch must not trigger anything for either agent.
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(commitA).toHaveBeenCalledTimes(1);
    expect(commitB).not.toHaveBeenCalled();
  });

  it('reports the PREVIOUS identity to onCommit when the identity change triggers the flush', () => {
    // The caller needs the owning identity to route the write: agent A's patch
    // must not go through the shared queue that has already re-scoped to B.
    const commit = vi.fn();
    const { result, rerender } = renderHook(
      ({ agentId }) => useDebouncedLimitPatch(agentId, commit),
      {
        initialProps: { agentId: 'agent-a' },
      },
    );

    act(() => {
      result.current({ maxTurnsPerTopic: 6 });
    });
    act(() => {
      rerender({ agentId: 'agent-b' });
    });

    expect(commit).toHaveBeenCalledWith({ maxTurnsPerTopic: 6 }, 'agent-a');
  });

  it('reports the current identity for a patch scheduled after the switch', () => {
    const commit = vi.fn();
    const { result, rerender } = renderHook(
      ({ agentId }) => useDebouncedLimitPatch(agentId, commit),
      {
        initialProps: { agentId: 'agent-a' },
      },
    );

    act(() => {
      rerender({ agentId: 'agent-b' });
    });
    act(() => {
      result.current({ maxTurnsPerTopic: 8 });
      vi.advanceTimersByTime(500);
    });

    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith({ maxTurnsPerTopic: 8 }, 'agent-b');
  });

  it('reports the current identity on the unmount flush', () => {
    const commit = vi.fn();
    const { result, unmount } = renderHook(() => useDebouncedLimitPatch('agent-1', commit));

    act(() => {
      result.current({ maxTopicsPerVisitor: 2 });
    });
    act(() => {
      unmount();
    });

    expect(commit).toHaveBeenCalledWith({ maxTopicsPerVisitor: 2 }, 'agent-1');
  });
});

describe('resolveLimitCommitTarget', () => {
  it('routes a patch owned by the rendered agent through the shared queue', () => {
    expect(resolveLimitCommitTarget('agent-a', 'agent-a')).toBe('current');
  });

  it('routes a patch owned by an abandoned agent to its own write path', () => {
    expect(resolveLimitCommitTarget('agent-a', 'agent-b')).toBe('previous');
  });
});
