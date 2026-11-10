import { describe, expect, it, vi } from 'vitest';

import {
  MemoryDeleteScopeChangedError,
  OffsetListPager,
  type OffsetPagedSlice,
} from './offsetListPager';

const deferred = <T = void>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
};

const scopeRef = { current: 'user-1:*' };

const setup = ({ refreshHead = vi.fn(async () => undefined) } = {}) => {
  const log: string[] = [];
  const tokens = { commit: vi.fn(), rollback: vi.fn() };
  const views: Record<string, any> = { all: { items: [] } };
  const slice: OffsetPagedSlice = {
    beginEntityOptimistic: vi.fn(() => {
      log.push('optimistic');
      return [tokens];
    }),
    collapse: vi.fn((key: string) => log.push(`collapse:${key}`)),
    loadMore: vi.fn(async (key: string) => {
      log.push(`loadMore:${key}`);
    }),
    removeEntity: vi.fn((id: string) => log.push(`removeEntity:${id}`)),
    update: vi.fn((key: string, apply: (data: any) => any) => {
      views[key] = apply(views[key]);
    }),
  };
  const pager = new OffsetListPager({
    keys: () => ['all'],
    read: (key) => views[key],
    scope: () => scopeRef.current,
    refreshHead,
    slice,
  });
  return { log, pager, refreshHead, slice, tokens, views };
};

describe('OffsetListPager', () => {
  it('removes optimistically, then collapses every page set and refreshes the head', async () => {
    const { log, pager, refreshHead, tokens } = setup();
    const server = deferred();

    const deleting = pager.delete('a', () => server.promise);
    // The row leaves the view before the server answers.
    expect(log).toEqual(['optimistic']);

    server.resolve();
    await deleting;

    expect(tokens.commit).toHaveBeenCalledTimes(1);
    expect(log).toEqual(['optimistic', 'removeEntity:a', 'collapse:all']);
    expect(refreshHead).toHaveBeenCalledTimes(1);
    expect(pager.isHeadStale('all')).toBe(true);
  });

  it('routes a delete confirmed after an account switch to the account that asked', async () => {
    scopeRef.current = 'user-1:*';
    const { log, pager, refreshHead, slice } = setup();
    const server = deferred();
    const serverDelete = vi.fn(() => server.promise);

    const deleting = pager.delete('a', serverDelete);
    // The account switches while the server deletes (the request was sent).
    await vi.waitFor(() => expect(serverDelete).toHaveBeenCalled());
    scopeRef.current = 'user-2:*';
    server.resolve();
    await deleting;

    expect(slice.removeEntity).toHaveBeenCalledWith('a', { scope: 'user-1:*' });
    // Nothing on screen (the other account's lists) is collapsed or refreshed.
    expect(log).not.toContain('collapse:all');
    expect(refreshHead).not.toHaveBeenCalled();
    expect(pager.isHeadStale('all')).toBe(false);
    scopeRef.current = 'user-1:*';
  });

  it('does not send a queued delete once another account is active', async () => {
    scopeRef.current = 'user-1:*';
    const page = deferred();
    const { pager, slice, tokens } = setup();
    vi.mocked(slice.loadMore).mockImplementation(() => page.promise);
    const serverDelete = vi.fn(async () => undefined);

    // The delete queues behind a page in flight...
    const paging = pager.loadMore('all');
    const deleting = pager.delete('a', serverDelete);
    // ...and the account switches before its turn comes.
    scopeRef.current = 'user-2:*';
    page.resolve();
    await paging;

    await expect(deleting).rejects.toBeInstanceOf(MemoryDeleteScopeChangedError);
    // Never sent under the new account; the optimistic removal is rolled back.
    expect(serverDelete).not.toHaveBeenCalled();
    expect(tokens.rollback).toHaveBeenCalledTimes(1);
    expect(slice.removeEntity).not.toHaveBeenCalled();
    scopeRef.current = 'user-1:*';
  });

  it('rolls the optimistic removal back when the server rejects', async () => {
    const { log, pager, tokens } = setup();

    await expect(pager.delete('a', () => Promise.reject(new Error('offline')))).rejects.toThrow(
      'offline',
    );

    expect(tokens.rollback).toHaveBeenCalledTimes(1);
    expect(log).toEqual(['optimistic']);
    expect(pager.isHeadStale('all')).toBe(false);
  });

  it('pages only once a fresh head landed after a delete', async () => {
    const refreshHead = vi.fn(async () => undefined);
    const { log, pager, slice } = setup({ refreshHead });
    await pager.delete('a', async () => undefined);

    // The head refresh landed (the list's useSync reports it).
    pager.headLanded('all');
    await pager.loadMore('all');

    expect(slice.loadMore).toHaveBeenCalledWith('all');
    expect(log.at(-1)).toBe('loadMore:all');
    // No extra head refresh was needed.
    expect(refreshHead).toHaveBeenCalledTimes(1);
  });

  it('retries the head refresh before paging, and surfaces its failure instead of paging', async () => {
    const refreshHead = vi.fn(async () => undefined);
    const { pager, slice, views } = setup({ refreshHead });
    await pager.delete('a', async () => undefined);
    const failure = new Error('head failed');
    pager.headFailed('all', failure);

    await pager.loadMore('all');

    // The head was refreshed again, still stale: no page from a stale offset.
    expect(refreshHead).toHaveBeenCalledTimes(2);
    expect(slice.loadMore).not.toHaveBeenCalled();
    expect(views.all).toMatchObject({ isLoadingMore: false, loadMoreError: failure });

    // The retry refreshes the head; once it lands, the page is fetched.
    refreshHead.mockImplementationOnce(async () => {
      pager.headLanded('all');
    });
    await pager.loadMore('all');
    expect(slice.loadMore).toHaveBeenCalledTimes(1);
  });

  it('makes load-more wait for an in-flight delete and its head refresh', async () => {
    const head = deferred();
    const refreshHead = vi.fn(() => head.promise);
    const { pager, slice } = setup({ refreshHead });

    const deleting = pager.delete('a', async () => undefined);
    const paging = pager.loadMore('all');
    // The delete is refreshing the head: paging must not start yet.
    await vi.waitFor(() => expect(refreshHead).toHaveBeenCalledTimes(1));
    expect(slice.loadMore).not.toHaveBeenCalled();

    pager.headLanded('all');
    head.resolve();
    await Promise.all([deleting, paging]);
    expect(slice.loadMore).toHaveBeenCalledTimes(1);
  });

  it('makes a delete wait for a page already in flight', async () => {
    const page = deferred();
    const { log, pager, slice } = setup();
    vi.mocked(slice.loadMore).mockImplementation(async () => {
      log.push('page-start');
      await page.promise;
      log.push('page-end');
    });
    const serverDelete = vi.fn(async () => {
      log.push('server-delete');
    });

    const paging = pager.loadMore('all');
    const deleting = pager.delete('a', serverDelete);
    await Promise.resolve();
    expect(serverDelete).not.toHaveBeenCalled();

    page.resolve();
    await Promise.all([paging, deleting]);
    // The page's offset predates the shift, so it lands before the server deletes.
    expect(log.indexOf('page-end')).toBeLessThan(log.indexOf('server-delete'));
  });

  it('purges at once when nothing is in flight', async () => {
    const { pager } = setup();
    const clear = vi.fn(async () => true);

    const clearing = pager.clear(clear);
    expect(clear).toHaveBeenCalledTimes(1);
    await expect(clearing).resolves.toBe(true);
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it('treats a page set short of its loaded pages as head-stale, with no delete this session', async () => {
    const refreshHead = vi.fn(async () => undefined);
    const { pager, slice, views } = setup({ refreshHead });
    // A persisted variant a delete patched: 11 of 12 head rows, more to load.
    views.all = { currentPage: 0, hasMore: true, items: Array.from({ length: 11 }), pageSize: 12 };

    expect(pager.isHeadStale('all')).toBe(true);
    await pager.loadMore('all');

    // The head is refreshed first; it failed, so no page from the stale offset.
    expect(refreshHead).toHaveBeenCalledTimes(1);
    expect(slice.loadMore).not.toHaveBeenCalled();
    expect(views.all.loadMoreError).toBeInstanceOf(Error);
  });

  it('pages a full or final page set without refreshing the head', async () => {
    const refreshHead = vi.fn(async () => undefined);
    const { pager, slice, views } = setup({ refreshHead });
    views.all = { currentPage: 0, hasMore: true, items: Array.from({ length: 12 }), pageSize: 12 };
    expect(pager.isHeadStale('all')).toBe(false);
    views.all = { currentPage: 1, hasMore: false, items: Array.from({ length: 15 }), pageSize: 12 };
    expect(pager.isHeadStale('all')).toBe(false);

    views.all = { currentPage: 0, hasMore: true, items: Array.from({ length: 12 }), pageSize: 12 };
    await pager.loadMore('all');
    expect(refreshHead).not.toHaveBeenCalled();
    expect(slice.loadMore).toHaveBeenCalledTimes(1);
  });

  it('ignores a head failure captured under another account', async () => {
    const refreshHead = vi.fn(async () => undefined);
    const { pager, views } = setup({ refreshHead });
    const previousUser = new Error('previous user failed');
    const callbacks = pager.syncCallbacks('all');

    // A request of the previous account settles after the switch.
    callbacks.onError(previousUser, { isActive: false });
    // The active user's page set is short, and its head refresh reports nothing.
    views.all = { currentPage: 0, hasMore: true, items: Array.from({ length: 11 }), pageSize: 12 };
    await pager.loadMore('all');

    expect(views.all.loadMoreError).toBeInstanceOf(Error);
    expect(views.all.loadMoreError).not.toBe(previousUser);

    // The active user's own failure is surfaced.
    const own = new Error('own failure');
    callbacks.onError(own, { isActive: true });
    await pager.loadMore('all');
    expect(views.all.loadMoreError).toBe(own);
  });

  it('shares one run between concurrent load-more calls', async () => {
    const { pager, slice } = setup();

    await Promise.all([pager.loadMore('all'), pager.loadMore('all')]);

    expect(slice.loadMore).toHaveBeenCalledTimes(1);
  });

  it('purges after a page in flight, and nothing is head-stale afterwards', async () => {
    const page = deferred();
    const { log, pager, slice } = setup();
    await pager.delete('a', async () => undefined);
    pager.headLanded('all');
    vi.mocked(slice.loadMore).mockImplementation(async () => {
      await page.promise;
      log.push('page-end');
    });
    const clear = vi.fn(async () => {
      log.push('clear');
      return true;
    });

    const paging = pager.loadMore('all');
    const clearing = pager.clear(clear);
    page.resolve();

    await expect(clearing).resolves.toBe(true);
    await paging;
    // Cleared at once (the view empties now), and again after the page settled.
    expect(clear).toHaveBeenCalledTimes(2);
    expect(log.indexOf('clear')).toBeLessThan(log.indexOf('page-end'));
    expect(log.lastIndexOf('clear')).toBeGreaterThan(log.indexOf('page-end'));
    expect(pager.isHeadStale('all')).toBe(false);
  });
});
