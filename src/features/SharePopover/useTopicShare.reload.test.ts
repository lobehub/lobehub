/**
 * @vitest-environment happy-dom
 *
 * The topic Share popover paints the previous session's share record before
 * the network answers. Each "reload" re-imports the module graph (fresh
 * stores, fresh SWR cache) over the same IndexedDB.
 */
import { randomUUID } from 'node:crypto';

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { createElement, type PropsWithChildren } from 'react';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const scope = vi.hoisted(() => ({ current: '' }));

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

const wrapper = ({ children }: PropsWithChildren) =>
  createElement(SWRConfig, { value: { dedupingInterval: 0, provider: () => new Map() } }, children);

const TOPIC_ID = 'topic-share-1';
const record = (visibility: 'link' | 'private') => ({
  id: 'share-1',
  topicId: TOPIC_ID,
  userId: 'user-1',
  visibility,
});

const pending = () => new Promise<never>(() => {});

/** A fresh module graph: what a page reload starts from (IndexedDB survives). */
const reload = async () => {
  cleanup();
  vi.resetModules();
  const [{ useTopicShare }, { topicService }] = await Promise.all([
    import('./useTopicShare'),
    import('@/services/topic'),
  ]);
  const getShareInfo = vi.spyOn(topicService, 'getShareInfo');
  const enableSharing = vi.spyOn(topicService, 'enableSharing');
  const render = () => renderHook(() => useTopicShare(TOPIC_ID, true), { wrapper });
  /** Two popovers in one app (one SWR cache), e.g. the header and the topic menu. */
  const renderTwo = () =>
    renderHook(
      () => {
        useTopicShare(TOPIC_ID, true);
        return useTopicShare(TOPIC_ID, true);
      },
      { wrapper },
    );
  return { enableSharing, getShareInfo, render, renderTwo };
};

/** Let the server answer reach the persisted copy before the next reload. */
const settle = () =>
  act(async () => {
    for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  });

// Re-importing the module graph per reload is slow on a cold transform cache.
describe('useTopicShare across a reload', { timeout: 60_000 }, () => {
  beforeEach(() => {
    scope.current = `share-user-${randomUUID()}:personal`;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('paints the previous session’s share record before the network answers', async () => {
    const first = await reload();
    first.getShareInfo.mockResolvedValue(record('link') as never);
    const { result } = first.render();
    await waitFor(() => expect(result.current.visibility).toBe('link'));
    await settle();

    const second = await reload();
    second.getShareInfo.mockImplementation(pending);
    const reloaded = second.render();

    await waitFor(() => expect(reloaded.result.current.isLoading).toBe(false));
    expect(reloaded.result.current.visibility).toBe('link');
    expect(reloaded.result.current.shareInfo?.id).toBe('share-1');
  });

  it('keeps a visibility change across a reload', async () => {
    const first = await reload();
    first.getShareInfo.mockResolvedValue(null as never);
    first.enableSharing.mockResolvedValue(record('link') as never);
    const { result } = first.render();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.setVisibility('link');
    });
    expect(result.current.visibility).toBe('link');
    await settle();

    const second = await reload();
    second.getShareInfo.mockImplementation(pending);
    const reloaded = second.render();

    await waitFor(() => expect(reloaded.result.current.visibility).toBe('link'));
  });

  it('waits for the server instead of painting a remembered "no share record" as private', async () => {
    const first = await reload();
    first.getShareInfo.mockResolvedValue(null as never);
    const { result } = first.render();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await settle();

    const second = await reload();
    second.getShareInfo.mockImplementation(pending);
    const reloaded = second.render();
    await settle();

    expect(reloaded.result.current.isLoading).toBe(true);
  });

  it('keeps the record on screen, without an error, when the refresh fails', async () => {
    const first = await reload();
    first.getShareInfo.mockResolvedValue(record('link') as never);
    first.render();
    await settle();

    const second = await reload();
    second.getShareInfo.mockRejectedValue(new Error('offline'));
    const { result } = second.render();
    await waitFor(() => expect(second.getShareInfo).toHaveBeenCalled());
    await settle();

    expect(result.current.visibility).toBe('link');
    expect(result.current.error).toBeUndefined();
  });

  it('asks the server once for popovers mounted together', async () => {
    const first = await reload();
    first.getShareInfo.mockResolvedValue(record('private') as never);
    first.renderTwo();
    await settle();

    expect(first.getShareInfo).toHaveBeenCalledTimes(1);
  });

  it('does not adopt a share change into the identity switched to while it was in flight', async () => {
    const first = await reload();
    first.getShareInfo.mockResolvedValue(null as never);
    let answer!: (value: ReturnType<typeof record>) => void;
    first.enableSharing.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve as never;
        }) as never,
    );
    const { rerender, result } = first.render();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let change!: Promise<unknown>;
    act(() => {
      change = result.current.setVisibility('link');
    });

    // The user switches workspace while the request is in flight; the new
    // identity's own read has not answered yet.
    first.getShareInfo.mockImplementation(pending);
    scope.current = `share-user-${randomUUID()}:ws-2`;
    rerender();
    await act(async () => {
      answer(record('link'));
      await change;
    });
    await settle();

    const second = await reload();
    second.getShareInfo.mockImplementation(pending);
    const reloaded = second.render();
    await settle();

    // Nothing was persisted for the new identity: it waits for its own server answer.
    expect(reloaded.result.current.isLoading).toBe(true);
  });
});
