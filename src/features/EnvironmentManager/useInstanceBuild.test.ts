import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useInstanceBuild } from './useEnvironmentData';

interface Options {
  onSuccess?: (data: { chunk: string; logOffset: number; state: string }) => void;
}

const swrState = vi.hoisted(() => ({
  data: undefined as unknown,
  options: [] as any[],
}));

vi.mock('@/libs/swr', () => ({
  useClientDataSWR: (_key: unknown, _fetcher: unknown, options?: Options) => {
    if (options) swrState.options.push(options);
    return { data: swrState.data, error: undefined, isLoading: false, mutate: vi.fn() };
  },
}));

vi.mock('@/services/sandboxWorkspace', () => ({
  sandboxWorkspaceService: { instanceBuildStatus: vi.fn(), listInstances: vi.fn() },
}));

/** The most recent `onSuccess` SWR was handed — this hook's whole update path. */
const poll = (data: { chunk: string; logOffset: number; state?: string }) =>
  act(() => {
    swrState.options.at(-1)?.onSuccess?.({ state: 'running', ...data });
  });

describe('useInstanceBuild', () => {
  beforeEach(() => {
    swrState.data = undefined;
    swrState.options = [];
  });

  it('keeps the log when the row unmounts and comes back', () => {
    // Leaving the settings tab and returning used to show a build with no log
    // and no way to open one, until a poll had refetched the whole thing from
    // the start — the log was on the server all along, the UI had forgotten it.
    const first = renderHook(() => useInstanceBuild('inst-a', true, 'build-1'));
    poll({ chunk: 'cloning...\n', logOffset: 12 });
    expect(first.result.current.log).toBe('cloning...\n');

    first.unmount();
    const second = renderHook(() => useInstanceBuild('inst-a', true, 'build-1'));

    expect(second.result.current.log).toBe('cloning...\n');
  });

  it('resumes from where it left off rather than refetching the whole log', () => {
    const first = renderHook(() => useInstanceBuild('inst-b', true, 'build-2'));
    poll({ chunk: 'installing...\n', logOffset: 40 });
    first.unmount();

    renderHook(() => useInstanceBuild('inst-b', true, 'build-2'));
    poll({ chunk: 'done\n', logOffset: 45 });

    expect(swrState.options.at(-1)).toBeDefined();
    const { result } = renderHook(() => useInstanceBuild('inst-b', true, 'build-2'));
    expect(result.current.log).toBe('installing...\ndone\n');
  });

  it('does not let a rebuild inherit the previous build log', () => {
    const first = renderHook(() => useInstanceBuild('inst-c', true, 'build-3'));
    poll({ chunk: 'first build\n', logOffset: 12 });
    first.unmount();

    const { result } = renderHook(() => useInstanceBuild('inst-c', true, 'build-4'));

    expect(result.current.log).toBe('');
  });

  it('drops what it held once the build ends, where the row takes over', () => {
    // A finished build's log is no longer the runtime's to serve, and the row
    // carries its own record of a failure. Keeping it here would only grow.
    const first = renderHook(() => useInstanceBuild('inst-d', true, 'build-5'));
    poll({ chunk: 'boom\n', logOffset: 5 });
    poll({ chunk: '', logOffset: 5, state: 'failed' });
    first.unmount();

    const { result } = renderHook(() => useInstanceBuild('inst-d', true, 'build-5'));

    expect(result.current.log).toBe('');
  });

  it('switches to another build while staying mounted', () => {
    // The row is not remounted between a build ending and the next starting,
    // so the swap has to happen on the id changing.
    const { rerender, result } = renderHook(
      ({ buildId }: { buildId: string }) => useInstanceBuild('inst-e', true, buildId),
      { initialProps: { buildId: 'build-6' } },
    );
    poll({ chunk: 'old\n', logOffset: 4 });
    expect(result.current.log).toBe('old\n');

    rerender({ buildId: 'build-7' });

    expect(result.current.log).toBe('');
  });
});
