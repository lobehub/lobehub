/**
 * @vitest-environment happy-dom
 *
 * The entity preview replica behind internal links. Each "reload" re-imports
 * the module graph (fresh stores, fresh SWR cache) over the same localStorage.
 */
import { randomUUID } from 'node:crypto';

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { createElement, type PropsWithChildren } from 'react';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { InternalLinkReference } from '../internalLink';

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

const GOAL: InternalLinkReference = { goalId: 'goal_1', pathname: '/goal/goal_1', type: 'goal' };
const graph = (title: string, status = 'running') => ({
  decisions: [],
  goal: { requirement: 'Ship the replica migration', status, title },
  nodes: [
    { kind: 'task', status: 'resolved' },
    { kind: 'task', status: 'running' },
  ],
});

const pending = () => new Promise<never>(() => {});

/** A fresh module graph: what a page reload starts from (localStorage survives). */
const reload = async () => {
  cleanup();
  vi.resetModules();
  const [{ useEntityPreview }, { goalService }, { useGoalStore }] = await Promise.all([
    import('./useEntityPreview'),
    import('@/services/goal'),
    import('@/store/goal'),
  ]);
  const getGraph = vi.spyOn(goalService, 'getGraph');
  const renderPreview = () => renderHook(() => useEntityPreview(GOAL, true), { wrapper });
  /** The link label and its hover card (or the same entity linked twice) on one screen. */
  const renderTwo = () =>
    renderHook(
      () => {
        useEntityPreview(GOAL, true);
        return useEntityPreview(GOAL, true);
      },
      { wrapper },
    );
  return { getGraph, renderPreview, renderTwo, useGoalStore };
};

/** Let the server answer reach the persisted copy before the next reload. */
const settle = () =>
  act(async () => {
    for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  });

/** Persist one server answer in the current scope. */
const remember = async (title: string) => {
  const first = await reload();
  first.getGraph.mockResolvedValue(graph(title) as never);
  const { result } = first.renderPreview();
  await waitFor(() => expect(result.current.title).toBe(title));
  await settle();
};

describe('useEntityPreview across a reload', { timeout: 60_000 }, () => {
  beforeEach(() => {
    scope.current = `entity-preview-user-${randomUUID()}:personal`;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('paints the remembered preview before the network answers', async () => {
    await remember('Replica migration');

    const second = await reload();
    second.getGraph.mockImplementation(pending);
    const { result } = second.renderPreview();
    await settle();

    expect(result.current.title).toBe('Replica migration');
    expect(result.current.preview?.description).toBe('Ship the replica migration');
  });

  it('treats remembered statuses as unconfirmed until the server answers', async () => {
    await remember('Replica migration');

    const second = await reload();
    let answer!: (value: unknown) => void;
    second.getGraph.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }) as never,
    );
    const { result } = second.renderPreview();
    await settle();
    expect(result.current.isConfirmed).toBe(false);

    await act(async () => {
      answer(graph('Replica migration', 'achieved'));
    });
    await waitFor(() => expect(result.current.isConfirmed).toBe(true));
    expect(result.current.preview?.goal?.status).toBe('achieved');
  });

  it('keeps the remembered preview when the refresh fails', async () => {
    await remember('Replica migration');

    const second = await reload();
    second.getGraph.mockRejectedValue(new Error('offline'));
    const { result } = second.renderPreview();
    await waitFor(() => expect(second.getGraph).toHaveBeenCalled());
    await settle();

    expect(result.current.title).toBe('Replica migration');
  });

  it('does not restore an entity the server no longer has', async () => {
    await remember('Replica migration');

    const second = await reload();
    // `goal.graph` rejects a deleted goal with NOT_FOUND.
    second.getGraph.mockRejectedValue(
      Object.assign(new Error('Goal not found'), { data: { code: 'NOT_FOUND' } }),
    );
    const { result } = second.renderPreview();
    await waitFor(() => expect(result.current.preview).toBeUndefined());
    await settle();

    const third = await reload();
    third.getGraph.mockImplementation(pending);
    const reloaded = third.renderPreview();
    await settle();

    expect(reloaded.result.current.preview).toBeUndefined();
    expect(reloaded.result.current.title).toBeUndefined();
  });

  it('drops the title another surface loaded once the server says the entity is gone', async () => {
    const first = await reload();
    // The goal was opened earlier in the session, so its graph is still in the goal store.
    first.useGoalStore.setState({
      goalGraphById: { goal_1: { goal: { title: 'Stale goal title' } } as never },
    });
    first.getGraph.mockRejectedValue(
      Object.assign(new Error('Goal not found'), { data: { code: 'NOT_FOUND' } }),
    );
    const { result } = first.renderPreview();
    await waitFor(() => expect(first.getGraph).toHaveBeenCalled());
    await settle();

    expect(result.current.title).toBeUndefined();
  });

  it('shows another identity nothing of the previous one', async () => {
    await remember('Replica migration');

    const second = await reload();
    second.getGraph.mockImplementation(pending);
    scope.current = `entity-preview-user-${randomUUID()}:ws-2`;
    const { result } = second.renderPreview();
    await settle();

    expect(result.current.preview).toBeUndefined();
    expect(result.current.title).toBeUndefined();
  });

  it('asks the server once for the same entity mounted twice', async () => {
    const first = await reload();
    first.getGraph.mockResolvedValue(graph('Replica migration') as never);
    first.renderTwo();
    await settle();

    expect(first.getGraph).toHaveBeenCalledTimes(1);
  });
});
