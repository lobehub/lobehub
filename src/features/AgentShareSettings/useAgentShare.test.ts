/**
 * @vitest-environment happy-dom
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAgentShare } from './useAgentShare';

const swr = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const state = { data: undefined as any };

  return {
    listeners,
    seed(data: any) {
      state.data = data;
    },
    set(data: any) {
      state.data = data;
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
        isLoading: false,
        mutate: async (input?: any) => {
          if (input === undefined) return swr.state.data;
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
    enabledToolIds: [],
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
        enabledToolIds: [...(current.enabledToolIds ?? []), 'tool-a'],
      }));
      void result.current.updateConfig((current) => ({
        enabledToolIds: [...(current.enabledToolIds ?? []), 'tool-b'],
      }));
    });

    // Only the first request has been issued; the second is queued behind it.
    await waitFor(() => expect(service.updateShareConfig).toHaveBeenCalledTimes(1));

    await act(async () => {
      releaseFirst(undefined);
    });

    await waitFor(() => expect(service.updateShareConfig).toHaveBeenCalledTimes(2));

    expect(service.updateShareConfig.mock.calls[0][1]).toEqual({ enabledToolIds: ['tool-a'] });
    expect(service.updateShareConfig.mock.calls[1][1]).toEqual({
      enabledToolIds: ['tool-a', 'tool-b'],
    });
  });

  it('keeps whitelist ids the picker never renders', async () => {
    swr.seed(buildShare({ enabledToolIds: ['lobe-local-system', 'mcp-github'] }));

    const { result } = renderHook(() => useAgentShare('agent-1'));

    await act(async () => {
      await result.current.updateConfig((current) => ({
        enabledToolIds: [...(current.enabledToolIds ?? []), 'calculator'],
      }));
    });

    expect(service.updateShareConfig.mock.calls[0][1]).toEqual({
      enabledToolIds: ['lobe-local-system', 'mcp-github', 'calculator'],
    });
  });

  it('projects the patch into the cache immediately', async () => {
    const { result } = renderHook(() => useAgentShare('agent-1'));

    await act(async () => {
      await result.current.updateConfig({ maxTurnsPerTopic: 30 });
    });

    expect(result.current.share?.shareConfig.maxTurnsPerTopic).toBe(30);
  });

  it('drops a patch that lands after sharing was disabled', async () => {
    service.disableShare.mockResolvedValue({ id: 'share-1' });

    const { result } = renderHook(() => useAgentShare('agent-1'));

    await act(async () => {
      // A debounced limit patch flushing on unmount races the disable; the
      // share row is already gone, so writing would only raise NOT_FOUND.
      const disabling = result.current.disable();
      await result.current.updateConfig({ maxTurnsPerTopic: 30 });
      await disabling;
    });

    expect(service.disableShare).toHaveBeenCalledTimes(1);
    expect(service.updateShareConfig).not.toHaveBeenCalled();
    expect(result.current.share).toBeNull();
  });

  it('still writes when a failed disable left the share in place', async () => {
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
