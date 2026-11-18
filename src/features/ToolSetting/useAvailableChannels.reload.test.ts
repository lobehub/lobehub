/**
 * @vitest-environment happy-dom
 *
 * The Web Search settings page paints the previous session's channel list
 * before the network answers. Each "reload" re-imports the module graph (fresh
 * stores, fresh SWR cache) over the same localStorage.
 */
import { randomUUID } from 'node:crypto';

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { createElement, type PropsWithChildren } from 'react';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const scope = vi.hoisted(() => ({ current: '' }));
const getAvailableChannels = vi.hoisted(() => vi.fn());

vi.mock('@/libs/swr/useCacheScope', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getCacheScope: () => scope.current,
  isScopeTrusted: () => true,
  useCacheScope: () => scope.current,
}));
vi.mock('@/libs/swr', async (importOriginal) => {
  const swr = await import('swr');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    mutate: swr.mutate,
    useClientDataSWR: swr.default,
  };
});
vi.mock('@/services/search', () => ({ searchService: { getAvailableChannels } }));

const channels = (searchProviders: string[], crawlerImpls = ['naive']) => ({
  crawlerImpls: crawlerImpls.map((id) => ({ id })),
  searchProviders: searchProviders.map((id) => ({ id })),
});

const pending = () => new Promise<never>(() => {});

const wrapper = ({ children }: PropsWithChildren) =>
  createElement(SWRConfig, { value: { dedupingInterval: 0, provider: () => new Map() } }, children);

/** A fresh module graph: what a page reload starts from (storage survives). */
const reload = async () => {
  cleanup();
  vi.resetModules();
  getAvailableChannels.mockReset();
  const { useAvailableChannels } = await import('./useAvailableChannels');
  return () => renderHook(() => useAvailableChannels(), { wrapper });
};

/** Let the server answer reach the persisted copy before the next reload. */
const settle = () =>
  act(async () => {
    for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  });

describe('useAvailableChannels across a reload', { timeout: 60_000 }, () => {
  beforeEach(() => {
    scope.current = `tool-setting-user-${randomUUID()}:personal`;
  });

  afterEach(() => {
    cleanup();
  });

  const visitOnce = async () => {
    const render = await reload();
    getAvailableChannels.mockResolvedValue(channels(['tavily', 'searxng']));
    const { result } = render();
    await waitFor(() => expect(result.current.data).toEqual(channels(['tavily', 'searxng'])));
    await settle();
  };

  it('paints the last channel list before the network answers, then swaps in the fresh one', async () => {
    await visitOnce();

    const render = await reload();
    let answer: (value: unknown) => void = () => {};
    getAvailableChannels.mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    const { result } = render();

    await waitFor(() => expect(result.current.data).toEqual(channels(['tavily', 'searxng'])));
    expect(result.current.isLoading).toBe(false);
    expect(getAvailableChannels).toHaveBeenCalledTimes(1);

    await act(async () => answer(channels(['exa'])));
    await waitFor(() => expect(result.current.data).toEqual(channels(['exa'])));
  });

  it('keeps the last channel list, without an error, when the refresh fails', async () => {
    await visitOnce();

    const render = await reload();
    getAvailableChannels.mockRejectedValue(new Error('offline'));
    const { result } = render();
    await settle();

    expect(result.current.data).toEqual(channels(['tavily', 'searxng']));
    expect(result.current.error).toBeUndefined();
  });

  it('surfaces the error of a first load with nothing to paint', async () => {
    const render = await reload();
    getAvailableChannels.mockRejectedValue(new Error('offline'));
    const { result } = render();

    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
    expect(result.current.isLoading).toBe(false);
  });

  it('does not paint another identity’s copy', async () => {
    await visitOnce();

    scope.current = `tool-setting-user-${randomUUID()}:personal`;
    const render = await reload();
    getAvailableChannels.mockImplementation(pending);
    const { result } = render();
    await settle();

    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(true);
  });
});
