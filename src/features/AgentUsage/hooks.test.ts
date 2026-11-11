/**
 * @vitest-environment happy-dom
 *
 * An agent's usage tab paints from the local copy after a reload: the numbers
 * the last session saw are there before the network answers, then the server's
 * answer replaces them.
 */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAgentUsageStats: vi.fn(),
  scope: 'agent-usage-user:personal',
}));

vi.mock(import('@/libs/swr/useCacheScope'), async (importOriginal) => ({
  ...(await importOriginal()),
  getCacheScope: () => mocks.scope,
  isScopeTrusted: () => true,
  useCacheScope: () => mocks.scope,
}));

vi.mock('@/services/usage', () => ({
  usageService: { getAgentUsageStats: mocks.getAgentUsageStats },
}));

// Each boot re-imports the hook's module graph from scratch.
vi.setConfig({ testTimeout: 30_000 });

/** A reload: fresh modules (stores, SWR cache) over the same browser storage. */
const boot = async (agentId = 'agent-1') => {
  vi.resetModules();
  const { setScopedMutate } = await import('@/libs/swr/mutate');
  const { useAgentUsageStats } = await import('./hooks');

  const MutateBridge = () => {
    const { mutate } = useSWRConfig();
    useEffect(() => setScopedMutate(mutate), [mutate]);
    return null;
  };
  const wrapper = ({ children }: PropsWithChildren) =>
    createElement(
      SWRConfig,
      { value: { dedupingInterval: 0, provider: () => new Map() } },
      createElement(MutateBridge),
      children,
    );

  return renderHook(() => useAgentUsageStats(agentId, '30d', 'day'), { wrapper });
};

const never = () => new Promise<never>(() => {});

const stats = (totalSpend: number) => ({ buckets: [], byModel: [], summary: { totalSpend } });

/** Let the server answer reach the persisted copy. */
const flushPersist = () => act(() => new Promise((resolve) => setTimeout(resolve, 100)));

describe('useAgentUsageStats', () => {
  beforeEach(() => {
    mocks.scope = `agent-usage-${Math.random().toString(36).slice(2)}:personal`;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('returns the last stats after a reload before the network answers', async () => {
    mocks.getAgentUsageStats.mockResolvedValue(stats(42));
    const first = await boot();
    await waitFor(() => expect(first.result.current.data).toEqual(stats(42)));
    await flushPersist();
    first.unmount();

    mocks.getAgentUsageStats.mockImplementation(never);
    const second = await boot();

    await waitFor(() => expect(second.result.current.data).toEqual(stats(42)));
    expect(second.result.current.isLoading).toBe(false);
  });

  it('replaces the restored stats with the server answer', async () => {
    mocks.getAgentUsageStats.mockResolvedValue(stats(42));
    const first = await boot();
    await waitFor(() => expect(first.result.current.data).toEqual(stats(42)));
    await flushPersist();
    first.unmount();

    mocks.getAgentUsageStats.mockResolvedValue(stats(50));
    const second = await boot();

    await waitFor(() => expect(second.result.current.data).toEqual(stats(50)));
  });

  it("does not return another identity's stats", async () => {
    mocks.getAgentUsageStats.mockResolvedValue(stats(42));
    const first = await boot();
    await waitFor(() => expect(first.result.current.data).toEqual(stats(42)));
    await flushPersist();
    first.unmount();

    mocks.scope = 'agent-usage-other-user:personal';
    mocks.getAgentUsageStats.mockImplementation(never);
    const second = await boot();

    await flushPersist();
    expect(second.result.current.data).toBeUndefined();
    expect(second.result.current.isLoading).toBe(true);
  });

  it('keeps each agent under its own entry', async () => {
    mocks.getAgentUsageStats.mockResolvedValue(stats(42));
    const first = await boot('agent-1');
    await waitFor(() => expect(first.result.current.data).toEqual(stats(42)));
    await flushPersist();
    first.unmount();

    mocks.getAgentUsageStats.mockImplementation(never);
    const second = await boot('agent-2');

    await flushPersist();
    expect(second.result.current.data).toBeUndefined();
  });
});
