/**
 * @vitest-environment happy-dom
 *
 * The library file picker paints the previous session's head page before the
 * network answers. Each "reload" re-imports the module graph (fresh stores,
 * fresh SWR cache) over the same IndexedDB.
 */
import { randomUUID } from 'node:crypto';

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { createElement, type PropsWithChildren } from 'react';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const scope = vi.hoisted(() => ({ current: '' }));
const queryResources = vi.hoisted(() => vi.fn());

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
vi.mock('@/services/resource', () => ({ resourceService: { queryResources } }));

const file = (id: string, url = `https://files.example.com/${id}?sig=1`) => ({
  createdAt: new Date('2026-11-01'),
  fileType: 'application/pdf',
  id,
  name: `${id}.pdf`,
  size: 1,
  sourceType: 'file',
  url,
});
const folder = (id: string) => ({ ...file(id), sourceType: 'document', url: undefined });
/** `total` counts every row of the query, not just this page's. */
const page = (items: unknown[], hasMore = false, total = items.length) => ({
  hasMore,
  items,
  total,
});

const pending = () => new Promise<never>(() => {});

const wrapper = ({ children }: PropsWithChildren) =>
  createElement(SWRConfig, { value: { dedupingInterval: 0, provider: () => new Map() } }, children);

/** A fresh module graph: what a page reload starts from (IndexedDB survives). */
const reload = async () => {
  cleanup();
  vi.resetModules();
  queryResources.mockReset();
  const { useLibraryFiles } = await import('./useLibraryFiles');
  return () => renderHook(() => useLibraryFiles(), { wrapper });
};

/** Let the server answer reach the persisted copy before the next reload. */
const settle = () =>
  act(async () => {
    for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  });

const ids = (files: { id: string }[]) => files.map((item) => item.id);

describe('useLibraryFiles across a reload', { timeout: 60_000 }, () => {
  beforeEach(() => {
    scope.current = `file-picker-user-${randomUUID()}:personal`;
  });

  afterEach(() => {
    cleanup();
  });

  const visitOnce = async (items: unknown[] = [file('f1')]) => {
    const render = await reload();
    queryResources.mockResolvedValue(page(items));
    const { result } = render();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await settle();
  };

  it('paints the last files before the network answers, attachable only once confirmed', async () => {
    await visitOnce();

    const render = await reload();
    let answer: (value: unknown) => void = () => {};
    queryResources.mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    const { result } = render();

    await waitFor(() => expect(ids(result.current.files)).toEqual(['f1']));
    expect(result.current.isLoading).toBe(false);
    // The restored row's signed URL may have expired: no attaching it yet.
    expect(result.current.isAttachable).toBe(false);

    await act(async () => answer(page([file('f1', 'https://files.example.com/f1?sig=2')])));

    await waitFor(() => expect(result.current.isAttachable).toBe(true));
    expect(result.current.files[0].url).toBe('https://files.example.com/f1?sig=2');
  });

  it('treats a restored empty page as loading until the server confirms it', async () => {
    await visitOnce([]);

    const render = await reload();
    let answer: (value: unknown) => void = () => {};
    queryResources.mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    const { result } = render();
    await settle();

    expect(result.current.isLoading).toBe(true);

    await act(async () => answer(page([file('f2')])));
    await waitFor(() => expect(ids(result.current.files)).toEqual(['f2']));
  });

  it('keeps paging past pages without attachable files', async () => {
    const render = await reload();
    queryResources
      .mockResolvedValueOnce(page([folder('d1')], true, 51))
      .mockResolvedValueOnce(page([file('f3')], false, 51));
    const { result } = render();

    await waitFor(() => expect(ids(result.current.files)).toEqual(['f3']));
    expect(queryResources).toHaveBeenLastCalledWith(
      expect.objectContaining({ limit: 50, offset: 50, showFilesInKnowledgeBase: true }),
    );
  });

  it('keeps the last files, without an error, when the refresh fails', async () => {
    await visitOnce();

    const render = await reload();
    queryResources.mockRejectedValue(new Error('offline'));
    const { result } = render();
    await settle();

    expect(ids(result.current.files)).toEqual(['f1']);
    expect(result.current.error).toBeUndefined();
  });

  it('does not paint another identity’s files', async () => {
    await visitOnce();

    scope.current = `file-picker-user-${randomUUID()}:personal`;
    const render = await reload();
    queryResources.mockImplementation(pending);
    const { result } = render();
    await settle();

    expect(result.current.files).toEqual([]);
    expect(result.current.isLoading).toBe(true);
  });
});
