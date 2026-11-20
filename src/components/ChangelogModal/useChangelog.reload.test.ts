/**
 * @vitest-environment happy-dom
 *
 * The "What's new" modal paints the previous session's changelog before the
 * network answers. Each "reload" re-imports the module graph (fresh stores,
 * fresh SWR cache) over the same localStorage / IndexedDB.
 */
import { randomUUID } from 'node:crypto';

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { createElement, type PropsWithChildren } from 'react';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const scope = vi.hoisted(() => ({ current: '' }));
const changelog = vi.hoisted(() => ({ getIndex: vi.fn(), getPostById: vi.fn() }));

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
vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    changelog: {
      getIndex: { query: changelog.getIndex },
      getPostById: { query: changelog.getPostById },
    },
  },
}));

const INDEX = [{ date: '2026-11-01', id: 'v2-3', versionRange: ['2.3.0'] }];
const post = (title: string) => ({
  content: `${title} body`,
  date: new Date('2026-11-01'),
  description: 'summary',
  rawTitle: title,
  tags: ['changelog'],
  title,
});

const pending = () => new Promise<never>(() => {});

const wrapper = ({ children }: PropsWithChildren) =>
  createElement(SWRConfig, { value: { dedupingInterval: 0, provider: () => new Map() } }, children);

/** A fresh module graph: what a page reload starts from (storage survives). */
const reload = async () => {
  cleanup();
  vi.resetModules();
  changelog.getIndex.mockReset();
  changelog.getPostById.mockReset();
  const { useChangelogModalIndex, useChangelogModalPost } = await import('./useChangelog');
  return () =>
    renderHook(
      () => ({ index: useChangelogModalIndex(), post: useChangelogModalPost('v2-3', 'en-US') }),
      { wrapper },
    );
};

/** Let the server answer reach the persisted copy before the next reload. */
const settle = () =>
  act(async () => {
    for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  });

describe('changelog modal across a reload', { timeout: 60_000 }, () => {
  beforeEach(() => {
    scope.current = `changelog-user-${randomUUID()}:personal`;
  });

  afterEach(() => {
    cleanup();
  });

  const visitOnce = async () => {
    const render = await reload();
    changelog.getIndex.mockResolvedValue(INDEX);
    changelog.getPostById.mockResolvedValue(post('Release 2.3'));
    const { result } = render();
    await waitFor(() => expect(result.current.post?.title).toBe('Release 2.3'));
    await settle();
  };

  it('paints the last index and post before the network answers, then swaps in the fresh post', async () => {
    await visitOnce();

    const render = await reload();
    changelog.getIndex.mockImplementation(pending);
    let answer: (value: unknown) => void = () => {};
    changelog.getPostById.mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    const { result } = render();

    await waitFor(() => expect(result.current.index).toEqual(INDEX));
    await waitFor(() => expect(result.current.post?.title).toBe('Release 2.3'));
    expect(result.current.post?.content).toBe('Release 2.3 body');
    expect(changelog.getPostById).toHaveBeenCalledWith({ id: 'v2-3', locale: 'en-US' });

    await act(async () => answer(post('Release 2.3 (edited)')));
    await waitFor(() => expect(result.current.post?.title).toBe('Release 2.3 (edited)'));
  });

  it('keeps the last index and post when the refresh fails', async () => {
    await visitOnce();

    const render = await reload();
    changelog.getIndex.mockRejectedValue(new Error('offline'));
    changelog.getPostById.mockRejectedValue(new Error('offline'));
    const { result } = render();
    await settle();

    expect(result.current.index).toEqual(INDEX);
    expect(result.current.post?.title).toBe('Release 2.3');
  });

  it('does not paint another identity’s copy', async () => {
    await visitOnce();

    scope.current = `changelog-user-${randomUUID()}:personal`;
    const render = await reload();
    changelog.getIndex.mockImplementation(pending);
    changelog.getPostById.mockImplementation(pending);
    const { result } = render();
    await settle();

    expect(result.current.index).toBeUndefined();
    expect(result.current.post).toBeUndefined();
  });
});
