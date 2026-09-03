/**
 * @vitest-environment happy-dom
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAgentShare } from './useAgentShare';

const swr = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const state = { data: undefined as any, error: undefined as any };

  return {
    listeners,
    seed(data: any) {
      state.data = data;
      state.error = undefined;
    },
    seedError(error: any) {
      state.data = undefined;
      state.error = error;
    },
    set(data: any) {
      state.data = data;
      state.error = undefined;
      for (const listener of listeners) listener();
    },
    state,
  };
});

// Stand-in for `useSWR` that keeps the cached row in module scope and
// re-renders subscribers on `mutate`, so the hook's optimistic writes and the
// idle re-sync effect behave as they do in the app.
vi.mock('swr', async () => {
  const React = await import('react');

  return {
    default: () => {
      const [, force] = React.useState(0);

      React.useEffect(() => {
        const listener = () => force((version) => version + 1);
        swr.listeners.add(listener);
        return () => {
          swr.listeners.delete(listener);
        };
      }, []);

      return {
        data: swr.state.data,
        error: swr.state.error,
        isLoading: false,
        mutate: async (input?: any) => {
          // Bare `mutate()` revalidates: re-read through the (mocked) fetcher.
          if (input === undefined) {
            const fresh = await service.getShareStatus();
            if (fresh !== undefined) swr.set(fresh);
            return swr.state.data;
          }
          swr.set(typeof input === 'function' ? input(swr.state.data) : input);
          return swr.state.data;
        },
      };
    },
  };
});

const service = vi.hoisted(() => ({
  disableShare: vi.fn(),
  enableShare: vi.fn(),
  getShareStatus: vi.fn(),
  updateShareConfig: vi.fn(),
  updateSlug: vi.fn(),
  updateVisibility: vi.fn(),
}));

vi.mock('@/services/agentShare', () => ({ agentShareService: service }));

const buildShare = (config: Record<string, unknown> = {}) => ({
  id: 'share-1',
  shareConfig: {
    allowReadMemory: false,
    toolGrants: [],
    maxTopicsPerVisitor: 5,
    maxTurnsPerTopic: 20,
    ...config,
  },
  userViewCount: 0,
  visibility: 'link',
});

beforeEach(() => {
  vi.clearAllMocks();
  swr.seed(buildShare());
  service.updateShareConfig.mockImplementation(async (_agentId: string, patch: any) => ({
    ...buildShare(),
    shareConfig: { ...swr.state.data?.shareConfig, ...patch },
  }));
});

describe('useAgentShare · updateConfig', () => {
  it('composes consecutive functional patches instead of losing the first', async () => {
    // The first write stays in flight while the second is issued — the exact
    // window in which a payload built from the last rendered config would
    // overwrite the earlier toggle.
    let releaseFirst: (value: any) => void = () => {};
    service.updateShareConfig.mockImplementationOnce(
      (_agentId: string, patch: any) =>
        new Promise((resolve) => {
          releaseFirst = () =>
            resolve({ ...buildShare(), shareConfig: { ...buildShare().shareConfig, ...patch } });
        }),
    );

    const { result } = renderHook(() => useAgentShare('agent-1'));

    await act(async () => {
      void result.current.updateConfig((current) => ({
        toolGrants: [...(current.toolGrants ?? []), { identifier: 'tool-a' }],
      }));
      void result.current.updateConfig((current) => ({
        toolGrants: [...(current.toolGrants ?? []), { identifier: 'tool-b' }],
      }));
    });

    // Only the first request has been issued; the second is queued behind it.
    await waitFor(() => expect(service.updateShareConfig).toHaveBeenCalledTimes(1));

    await act(async () => {
      releaseFirst(undefined);
    });

    await waitFor(() => expect(service.updateShareConfig).toHaveBeenCalledTimes(2));

    expect(service.updateShareConfig.mock.calls[0][1]).toEqual({
      toolGrants: [{ identifier: 'tool-a' }],
    });
    expect(service.updateShareConfig.mock.calls[1][1]).toEqual({
      toolGrants: [{ identifier: 'tool-a' }, { identifier: 'tool-b' }],
    });
  });

  it('does not resend a failed write when a later queued write lands (happy-path contrast)', async () => {
    // Paired with the failure regression below: on the happy path, B's
    // outgoing payload still composes on top of A once A is confirmed to
    // have succeeded — the fix must not turn this into a diff-only send.
    let releaseFirst: (value: any) => void = () => {};
    service.updateShareConfig.mockImplementationOnce(
      (_agentId: string, patch: any) =>
        new Promise((resolve) => {
          releaseFirst = () =>
            resolve({ ...buildShare(), shareConfig: { ...buildShare().shareConfig, ...patch } });
        }),
    );

    const { result } = renderHook(() => useAgentShare('agent-1'));

    await act(async () => {
      void result.current.updateConfig((current) => ({
        toolGrants: [...(current.toolGrants ?? []), { identifier: 'tool-a' }],
      }));
      void result.current.updateConfig((current) => ({
        toolGrants: [...(current.toolGrants ?? []), { identifier: 'tool-b' }],
      }));
    });

    await waitFor(() => expect(service.updateShareConfig).toHaveBeenCalledTimes(1));

    await act(async () => {
      releaseFirst(undefined);
    });

    await waitFor(() => expect(service.updateShareConfig).toHaveBeenCalledTimes(2));

    expect(service.updateShareConfig.mock.calls[1][1]).toEqual({
      toolGrants: [{ identifier: 'tool-a' }, { identifier: 'tool-b' }],
    });
  });

  it("does not let A's failed write leak into B's outgoing payload", async () => {
    // A fails outright while B is already queued behind it. Pre-fix, B's
    // payload was baked at CALL time from the optimistic `[A, B]`
    // projection, so it silently re-persisted A's edit server-side even
    // though A's own write was reported failed — because `updateShareConfig`
    // overwrites the whole `toolGrants` array rather than diffing it.
    let rejectFirst: (reason: unknown) => void = () => {};
    service.updateShareConfig.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectFirst = reject;
        }),
    );
    service.updateShareConfig.mockImplementationOnce(async (_agentId: string, patch: any) => ({
      ...buildShare(),
      shareConfig: { ...buildShare().shareConfig, ...patch },
    }));

    const { result } = renderHook(() => useAgentShare('agent-1'));

    let editingA: Promise<unknown> = Promise.resolve();
    await act(async () => {
      editingA = result.current.updateConfig((current) => ({
        toolGrants: [...(current.toolGrants ?? []), { identifier: 'tool-a' }],
      }));
      void result.current.updateConfig((current) => ({
        toolGrants: [...(current.toolGrants ?? []), { identifier: 'tool-b' }],
      }));
    });
    // The queue must not stall on A's eventual rejection.
    editingA.catch(() => undefined);

    await waitFor(() => expect(service.updateShareConfig).toHaveBeenCalledTimes(1));

    await act(async () => {
      rejectFirst(new Error('write A failed'));
    });

    await waitFor(() => expect(service.updateShareConfig).toHaveBeenCalledTimes(2));

    // B's outgoing payload must be resolved as if A never happened, not
    // against the optimistic `[A, B]` UI projection A was already baked into.
    expect(service.updateShareConfig.mock.calls[1][1]).toEqual({
      toolGrants: [{ identifier: 'tool-b' }],
    });
  });

  it('does not let an earlier response revert a later queued write before it lands (A/B/C interleaving)', async () => {
    // Reproduces the lost-update window exactly: A is in flight, B is toggled
    // while A is still pending (queued behind it), and A's response lands
    // BEFORE B's request is even sent. Pre-fix, `commitIfCurrent` would
    // unconditionally adopt A's response into `latestConfigRef`, regressing
    // the local projection from [A, B] back to just [A] — so when C is then
    // toggled off that regressed snapshot, C's whole-array write silently
    // drops B server-side once it lands, even though B's own write already
    // succeeded. With the fix, an intermediate response is only adopted once
    // it is the LAST pending write, so the projection (and what the UI reads
    // off SWR) never regresses mid-flight.
    let releaseA: (value: any) => void = () => {};
    let releaseB: (value: any) => void = () => {};
    let releaseC: (value: any) => void = () => {};

    service.updateShareConfig
      .mockImplementationOnce(
        (_agentId: string, patch: any) =>
          new Promise((resolve) => {
            releaseA = () =>
              resolve({ ...buildShare(), shareConfig: { ...buildShare().shareConfig, ...patch } });
          }),
      )
      .mockImplementationOnce(
        (_agentId: string, patch: any) =>
          new Promise((resolve) => {
            releaseB = () =>
              resolve({ ...buildShare(), shareConfig: { ...buildShare().shareConfig, ...patch } });
          }),
      )
      .mockImplementationOnce(
        (_agentId: string, patch: any) =>
          new Promise((resolve) => {
            releaseC = () =>
              resolve({ ...buildShare(), shareConfig: { ...buildShare().shareConfig, ...patch } });
          }),
      );

    const { result } = renderHook(() => useAgentShare('agent-1'));

    await act(async () => {
      void result.current.updateConfig((current) => ({
        toolGrants: [...(current.toolGrants ?? []), { identifier: 'tool-a' }],
      }));
      void result.current.updateConfig((current) => ({
        toolGrants: [...(current.toolGrants ?? []), { identifier: 'tool-b' }],
      }));
    });

    await waitFor(() => expect(service.updateShareConfig).toHaveBeenCalledTimes(1));

    await act(async () => {
      releaseA(undefined);
    });
    await waitFor(() => expect(service.updateShareConfig).toHaveBeenCalledTimes(2));

    // A's response landed while B was still queued — the projection (and the
    // SWR cache the UI reads) must not have regressed back to just A.
    expect(result.current.share?.shareConfig.toolGrants).toEqual([
      { identifier: 'tool-a' },
      { identifier: 'tool-b' },
    ]);

    await act(async () => {
      void result.current.updateConfig((current) => ({
        toolGrants: [...(current.toolGrants ?? []), { identifier: 'tool-c' }],
      }));
    });

    await act(async () => {
      releaseB(undefined);
    });
    await waitFor(() => expect(service.updateShareConfig).toHaveBeenCalledTimes(3));

    await act(async () => {
      releaseC(undefined);
    });

    expect(service.updateShareConfig.mock.calls[0][1]).toEqual({
      toolGrants: [{ identifier: 'tool-a' }],
    });
    expect(service.updateShareConfig.mock.calls[1][1]).toEqual({
      toolGrants: [{ identifier: 'tool-a' }, { identifier: 'tool-b' }],
    });
    // The final persisted patch for C must still contain B — it was never
    // reverted by A's earlier, now-stale response.
    expect(service.updateShareConfig.mock.calls[2][1]).toEqual({
      toolGrants: [{ identifier: 'tool-a' }, { identifier: 'tool-b' }, { identifier: 'tool-c' }],
    });
    expect(result.current.share?.shareConfig.toolGrants).toEqual([
      { identifier: 'tool-a' },
      { identifier: 'tool-b' },
      { identifier: 'tool-c' },
    ]);
  });

  it('keeps granted tools the picker never renders', async () => {
    swr.seed(
      buildShare({
        toolGrants: [{ identifier: 'lobe-local-system' }, { identifier: 'mcp-github' }],
      }),
    );

    const { result } = renderHook(() => useAgentShare('agent-1'));

    await act(async () => {
      await result.current.updateConfig((current) => ({
        toolGrants: [...(current.toolGrants ?? []), { identifier: 'calculator' }],
      }));
    });

    expect(service.updateShareConfig.mock.calls[0][1]).toEqual({
      toolGrants: [
        { identifier: 'lobe-local-system' },
        { identifier: 'mcp-github' },
        { identifier: 'calculator' },
      ],
    });
  });

  it('projects the patch into the cache immediately', async () => {
    const { result } = renderHook(() => useAgentShare('agent-1'));

    await act(async () => {
      await result.current.updateConfig({ maxTurnsPerTopic: 30 });
    });

    expect(result.current.share?.shareConfig.maxTurnsPerTopic).toBe(30);
  });

  it('keeps the paused row in the cache instead of dropping it', async () => {
    service.disableShare.mockResolvedValue({ ...buildShare(), visibility: 'private' });

    const { result } = renderHook(() => useAgentShare('agent-1'));

    await act(async () => {
      await result.current.disable();
    });

    // Disabling only pauses the share: the row (hence its id and slug) stays,
    // so the same link resumes on the next enable.
    expect(result.current.share?.id).toBe('share-1');
    expect(result.current.share?.visibility).toBe('private');
  });

  it('still lands an edit made while a disable is in flight', async () => {
    let completeDisable: () => void = () => {};
    service.disableShare.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          completeDisable = () => resolve({ ...buildShare(), visibility: 'private' });
        }),
    );

    const { result } = renderHook(() => useAgentShare('agent-1'));

    let disabling: Promise<unknown> = Promise.resolve();
    await act(async () => {
      disabling = result.current.disable();
    });
    await waitFor(() => expect(service.disableShare).toHaveBeenCalledTimes(1));

    // A debounced limit patch flushing on unmount races the disable. The row
    // survives the disable, so the edit must be written, not dropped.
    let editing: Promise<unknown> = Promise.resolve();
    await act(async () => {
      editing = result.current.updateConfig({ maxTurnsPerTopic: 30 });
    });

    await act(async () => {
      completeDisable();
      await disabling;
      await editing;
    });

    expect(service.updateShareConfig).toHaveBeenCalledTimes(1);
    expect(service.updateShareConfig.mock.calls[0][1]).toEqual({ maxTurnsPerTopic: 30 });
  });

  it('re-reads the server after a later queued write fails so a discarded earlier response is not lost', async () => {
    // Disable succeeds but its response is discarded because a slug write is
    // already queued behind it; the slug write then fails. The cache must end
    // up showing the server truth (disabled), not the pre-disable row.
    let completeDisable: () => void = () => {};
    service.disableShare.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          completeDisable = () => resolve({ ...buildShare(), visibility: 'private' });
        }),
    );
    service.updateSlug.mockRejectedValueOnce(new Error('slug taken'));
    service.getShareStatus.mockResolvedValue({ ...buildShare(), visibility: 'private' });

    const { result } = renderHook(() => useAgentShare('agent-1'));

    let disabling: Promise<unknown> = Promise.resolve();
    await act(async () => {
      disabling = result.current.disable();
    });
    await waitFor(() => expect(service.disableShare).toHaveBeenCalledTimes(1));

    let saving: Promise<unknown> = Promise.resolve();
    await act(async () => {
      saving = result.current.updateSlug('new-slug').catch(() => undefined);
    });

    await act(async () => {
      completeDisable();
      await disabling;
      await saving;
    });

    await waitFor(() => expect(result.current.share?.visibility).toBe('private'));
  });

  it('still writes when a disable failed outright', async () => {
    service.disableShare.mockRejectedValue(new Error('nope'));

    const { result } = renderHook(() => useAgentShare('agent-1'));

    await act(async () => {
      await result.current.disable().catch(() => undefined);
    });
    await act(async () => {
      await result.current.updateConfig({ maxTurnsPerTopic: 30 });
    });

    expect(service.updateShareConfig).toHaveBeenCalledTimes(1);
  });
});

describe('useAgentShare · agent identity change', () => {
  // The settings page component is not remounted when navigating between two
  // agents' share pages — it just receives a new `agentId` prop (mirrors
  // `useDebouncedLimitPatch`'s doc). Without the identity guard, a write still
  // in flight for agent A would land its response in the SAME shared
  // `latestConfigRef` agent B's edits derive from.
  it("does not let agent A's in-flight write pollute agent B's config after navigating without unmount", async () => {
    const shareA = buildShare({ maxTurnsPerTopic: 20 });
    const shareB = buildShare({ maxTurnsPerTopic: 99 });
    swr.seed(shareA);

    let releaseA: () => void = () => {};
    service.updateShareConfig.mockImplementationOnce(
      (_agentId: string, patch: any) =>
        new Promise((resolve) => {
          releaseA = () => resolve({ ...shareA, shareConfig: { ...shareA.shareConfig, ...patch } });
        }),
    );

    const { result, rerender } = renderHook(({ agentId }) => useAgentShare(agentId), {
      initialProps: { agentId: 'agent-A' },
    });

    // Kick off an edit on A that stays in flight (server hasn't responded yet).
    let editingA: Promise<unknown> = Promise.resolve();
    await act(async () => {
      editingA = result.current.updateConfig({ maxTurnsPerTopic: 5 });
    });
    await waitFor(() => expect(service.updateShareConfig).toHaveBeenCalledTimes(1));
    expect(service.updateShareConfig).toHaveBeenNthCalledWith(1, 'agent-A', {
      maxTurnsPerTopic: 5,
    });

    // Navigate to agent B without unmounting. Simulate SWR's own key switch
    // resolving to B's row (a real key change would trigger a fresh fetch).
    act(() => {
      rerender({ agentId: 'agent-B' });
    });
    act(() => {
      swr.set(shareB);
    });

    // B's server snapshot must be adopted — not blocked behind A's pending
    // write count, which belongs to a hook instance the component reused.
    expect(result.current.share?.shareConfig.maxTurnsPerTopic).toBe(99);

    // The next edit on B must derive its patch from B's config (99), not from
    // whatever `latestConfigRef` held for A.
    service.updateShareConfig.mockImplementationOnce(async (_agentId: string, patch: any) => ({
      ...shareB,
      shareConfig: { ...shareB.shareConfig, ...patch },
    }));
    await act(async () => {
      await result.current.updateConfig((current) => ({
        maxTurnsPerTopic: (current.maxTurnsPerTopic ?? 0) + 1,
      }));
    });
    expect(service.updateShareConfig).toHaveBeenNthCalledWith(2, 'agent-B', {
      maxTurnsPerTopic: 100,
    });
    expect(result.current.share?.shareConfig.maxTurnsPerTopic).toBe(100);

    // A's stale write finally resolves — its response must be dropped rather
    // than clobbering the config B's edits now derive from.
    await act(async () => {
      releaseA();
      await editingA;
    });
    expect(result.current.share?.shareConfig.maxTurnsPerTopic).toBe(100);
  });

  // Comparing the bare `agentId` string is not enough: after an A → B → A
  // round trip the hook tracks `agent-A` again, so a write issued under the
  // FIRST visit would pass an id-only check, decrement the second visit's
  // pending-write counter, and adopt its stale response over edits issued
  // after the return. Each write must be pinned to an identity generation.
  it("drops agent A's write from a previous visit after navigating A → B → A", async () => {
    const shareA = buildShare({ maxTurnsPerTopic: 20 });
    const shareB = buildShare({ maxTurnsPerTopic: 99 });
    swr.seed(shareA);

    let releaseFirst: () => void = () => {};
    service.updateShareConfig.mockImplementationOnce(
      (_agentId: string, patch: any) =>
        new Promise((resolve) => {
          releaseFirst = () =>
            resolve({ ...shareA, shareConfig: { ...shareA.shareConfig, ...patch } });
        }),
    );

    const { result, rerender } = renderHook(({ agentId }) => useAgentShare(agentId), {
      initialProps: { agentId: 'agent-A' },
    });

    // First visit to A: an edit that stays in flight across the round trip.
    let firstEdit: Promise<unknown> = Promise.resolve();
    await act(async () => {
      firstEdit = result.current.updateConfig({ maxTurnsPerTopic: 5 });
    });
    await waitFor(() => expect(service.updateShareConfig).toHaveBeenCalledTimes(1));

    // A → B → A without unmount; SWR resolves each key switch to its row.
    act(() => {
      rerender({ agentId: 'agent-B' });
    });
    act(() => {
      swr.set(shareB);
    });
    act(() => {
      rerender({ agentId: 'agent-A' });
    });
    act(() => {
      swr.set(shareA);
    });
    expect(result.current.share?.shareConfig.maxTurnsPerTopic).toBe(20);

    // Second visit to A: a new edit whose request also stays in flight, so the
    // first visit's late response has a pending write to race against.
    let releaseSecond: () => void = () => {};
    service.updateShareConfig.mockImplementationOnce(
      (_agentId: string, patch: any) =>
        new Promise((resolve) => {
          releaseSecond = () =>
            resolve({ ...shareA, shareConfig: { ...shareA.shareConfig, ...patch } });
        }),
    );
    let secondEdit: Promise<unknown> = Promise.resolve();
    await act(async () => {
      secondEdit = result.current.updateConfig({ maxTurnsPerTopic: 8 });
    });
    await waitFor(() => expect(service.updateShareConfig).toHaveBeenCalledTimes(2));
    expect(service.updateShareConfig).toHaveBeenNthCalledWith(2, 'agent-A', {
      maxTurnsPerTopic: 8,
    });
    expect(result.current.share?.shareConfig.maxTurnsPerTopic).toBe(8);

    // The FIRST visit's response lands while the second edit is still
    // pending. It must be dropped: the optimistic 8 stays, not the stale 5.
    await act(async () => {
      releaseFirst();
      await firstEdit;
    });
    expect(result.current.share?.shareConfig.maxTurnsPerTopic).toBe(8);

    // The second edit's own response is still adopted normally — proving the
    // pending-write counter was not corrupted by the late first response.
    await act(async () => {
      releaseSecond();
      await secondEdit;
    });
    expect(result.current.share?.shareConfig.maxTurnsPerTopic).toBe(8);

    // With the queue drained, a server re-seed is adopted again (idle path):
    // the counter is back at zero rather than negative or stuck.
    act(() => {
      swr.set(buildShare({ maxTurnsPerTopic: 42 }));
    });
    expect(result.current.share?.shareConfig.maxTurnsPerTopic).toBe(42);
    service.updateShareConfig.mockImplementationOnce(async (_agentId: string, patch: any) => ({
      ...shareA,
      shareConfig: { ...shareA.shareConfig, ...patch },
    }));
    await act(async () => {
      await result.current.updateConfig((current) => ({
        maxTurnsPerTopic: (current.maxTurnsPerTopic ?? 0) + 1,
      }));
    });
    expect(service.updateShareConfig).toHaveBeenNthCalledWith(3, 'agent-A', {
      maxTurnsPerTopic: 43,
    });
  });
});

describe('useAgentShare · getShareStatus failure', () => {
  it('exposes the fetch error instead of swallowing it', () => {
    const fetchError = new Error('network down');
    swr.seedError(fetchError);

    const { result } = renderHook(() => useAgentShare('agent-1'));

    expect(result.current.error).toBe(fetchError);
    expect(result.current.share).toBeUndefined();
  });
});
