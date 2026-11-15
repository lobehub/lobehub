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

  it('paints a file found past folder-only pages after a reload', async () => {
    const first = await reload();
    queryResources
      .mockResolvedValueOnce(page([folder('d1')], true, 51))
      .mockResolvedValueOnce(page([file('f4')], false, 51));
    const visit = first();
    await waitFor(() => expect(ids(visit.result.current.files)).toEqual(['f4']));
    await settle();

    const render = await reload();
    queryResources.mockImplementation(pending);
    const { result } = render();

    await waitFor(() => expect(ids(result.current.files)).toEqual(['f4']));
    expect(result.current.isLoading).toBe(false);
  });

  it('never offers a restored file past the head before its page is re-listed', async () => {
    const first = await reload();
    queryResources
      .mockResolvedValueOnce(page([folder('d1')], true, 51))
      .mockResolvedValueOnce(page([file('f4')], false, 51));
    const visit = first();
    await waitFor(() => expect(ids(visit.result.current.files)).toEqual(['f4']));
    await settle();

    // f4 was deleted since: page 2 now holds f5 instead.
    const { useLibraryFiles } = await (async () => {
      cleanup();
      vi.resetModules();
      queryResources.mockReset();
      return import('./useLibraryFiles');
    })();
    let answerHead: (value: unknown) => void = () => {};
    let answerTail: (value: unknown) => void = () => {};
    queryResources.mockImplementation(({ offset }: { offset: number }) =>
      offset === 0
        ? new Promise((resolve) => (answerHead = resolve))
        : new Promise((resolve) => (answerTail = resolve)),
    );
    const attachableIds = new Set<string>();
    const { result } = renderHook(
      () => {
        const value = useLibraryFiles();
        if (value.isAttachable) for (const item of value.files) attachableIds.add(item.id);
        return value;
      },
      { wrapper },
    );

    await waitFor(() => expect(ids(result.current.files)).toEqual(['f4']));
    expect(result.current.isAttachable).toBe(false);

    await act(async () => answerHead(page([folder('d1')], true, 51)));
    await settle();
    // The head is confirmed, but f4 sits on a restored page that is not.
    expect(ids(result.current.files)).toEqual(['f4']);
    expect(result.current.isAttachable).toBe(false);

    await act(async () => answerTail(page([file('f5')], false, 51)));

    await waitFor(() => expect(ids(result.current.files)).toEqual(['f5']));
    expect(result.current.isAttachable).toBe(true);
    expect(attachableIds.has('f4')).toBe(false);
  });

  it('offers a retry of the later page when it fails after the head confirmed', async () => {
    const first = await reload();
    queryResources
      .mockResolvedValueOnce(page([folder('d1')], true, 51))
      .mockResolvedValueOnce(page([file('f4')], false, 51));
    const visit = first();
    await waitFor(() => expect(ids(visit.result.current.files)).toEqual(['f4']));
    await settle();

    const render = await reload();
    let answerHead: (value: unknown) => void = () => {};
    let tailCalls = 0;
    queryResources.mockImplementation(({ offset }: { offset: number }) => {
      if (offset === 0) return new Promise((resolve) => (answerHead = resolve));
      tailCalls += 1;
      return tailCalls === 1
        ? Promise.reject(new Error('offline'))
        : Promise.resolve(page([file('f5')], false, 51));
    });
    const { result } = render();
    await waitFor(() => expect(ids(result.current.files)).toEqual(['f4']));

    await act(async () => answerHead(page([folder('d1')], true, 51)));

    await waitFor(() => expect(result.current.refreshError).toBeInstanceOf(Error));
    expect(ids(result.current.files)).toEqual(['f4']);
    expect(result.current.isAttachable).toBe(false);

    await act(async () => {
      await result.current.retry();
    });

    await waitFor(() => expect(ids(result.current.files)).toEqual(['f5']));
    expect(result.current.isAttachable).toBe(true);
    expect(result.current.refreshError).toBeUndefined();
  });

  it('keeps the last files, without an error, when the refresh fails', async () => {
    await visitOnce();

    const render = await reload();
    queryResources.mockRejectedValue(new Error('offline'));
    const { result } = render();
    await settle();

    expect(ids(result.current.files)).toEqual(['f1']);
    expect(result.current.error).toBeUndefined();
    // The restored files cannot be attached yet, so the failure stays retryable.
    expect(result.current.isAttachable).toBe(false);
    expect(result.current.refreshError).toBeInstanceOf(Error);

    queryResources.mockReset();
    queryResources.mockResolvedValue(page([file('f1', 'https://files.example.com/f1?sig=3')]));
    await act(async () => {
      await result.current.retry();
    });

    await waitFor(() => expect(result.current.isAttachable).toBe(true));
    expect(result.current.refreshError).toBeUndefined();
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
