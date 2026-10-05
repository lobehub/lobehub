import { describe, expect, it } from 'vitest';

import {
  applyHeadPage,
  applyNextPage,
  collapseToHead,
  getNextPageCursor,
  insertHeadItems,
  mapPagedItem,
  type ReplicaPagedData,
  type ReplicaPagingConfig,
  toPersistedPage,
} from './paging';

interface Row {
  id: string;
  title?: string;
}

const rows = (...ids: string[]): Row[] => ids.map((id) => ({ id }));
const ids = (data: { items: Row[] }) => data.items.map((item) => item.id);

const offset: ReplicaPagingConfig<Row> = {
  direction: 'forward',
  getId: (row) => row.id,
  mode: 'offset',
};

describe('offset / forward paging (topic-like list)', () => {
  const twoPages = () => {
    const head = applyHeadPage(
      undefined,
      { items: rows('a', 'b'), total: 5 },
      { pageSize: 2 },
      offset,
    );
    return applyNextPage(head, { items: rows('c', 'd'), total: 5 }, offset);
  };

  it('merges the next page and dedupes by id', () => {
    const head = applyHeadPage(
      undefined,
      { items: rows('a', 'b'), total: 5 },
      { pageSize: 2 },
      offset,
    );
    expect(head).toMatchObject({ currentPage: 0, hasMore: true, nextCursor: 1 });

    // A row shifted from page 0 into page 1 (offset drift) is not duplicated.
    const next = applyNextPage(head, { items: rows('b', 'c'), total: 5 }, offset);
    expect(ids(next)).toEqual(['a', 'b', 'c']);
    expect(next).toMatchObject({ currentPage: 1, isLoadingMore: false, nextCursor: 2 });
  });

  it('a head refresh keeps the loaded depth and dedupes by id', () => {
    const refreshed = applyHeadPage(
      twoPages(),
      { items: rows('new', 'a'), total: 6 },
      { pageSize: 2 },
      offset,
    );
    expect(ids(refreshed)).toEqual(['new', 'a', 'b', 'c']);
    expect(refreshed.currentPage).toBe(1);
    expect(refreshed.hasMore).toBe(true);
  });

  it('a query reset or a page-size change collapses to the head page', () => {
    const reset = applyHeadPage(
      twoPages(),
      { items: rows('x'), total: 1 },
      { pageSize: 2, reset: true },
      offset,
    );
    expect(ids(reset)).toEqual(['x']);
    expect(reset).toMatchObject({ currentPage: 0, hasMore: false, nextCursor: null });

    const resized = applyHeadPage(
      twoPages(),
      { items: rows('a', 'b', 'c'), total: 5 },
      { pageSize: 3 },
      offset,
    );
    expect(resized.currentPage).toBe(0);
  });

  it('a head refresh clears the last page error', () => {
    const failed = { ...twoPages(), loadMoreError: new Error('boom') };
    const refreshed = applyHeadPage(
      failed,
      { items: rows('a', 'b'), total: 5 },
      { pageSize: 2 },
      offset,
    );
    expect(refreshed.loadMoreError).toBeUndefined();
  });

  it('keeps client-only rows across head refreshes', () => {
    const ctx = { isClientOnly: (row: Row) => row.id === 'tmp' };
    const withTmp = insertHeadItems(twoPages(), rows('tmp'), offset);
    const refreshed = applyHeadPage(
      withTmp,
      { items: rows('a', 'b'), total: 5 },
      { pageSize: 2 },
      offset,
      ctx,
    );
    expect(ids(refreshed)).toEqual(['tmp', 'a', 'b', 'c', 'd']);

    // Once the server returns the row it is no longer duplicated.
    const confirmed = applyHeadPage(
      refreshed,
      { items: rows('tmp', 'a'), total: 6 },
      { pageSize: 2 },
      offset,
      ctx,
    );
    expect(ids(confirmed).filter((id) => id === 'tmp')).toHaveLength(1);
  });

  it('inserts new rows at the head without moving the cursor', () => {
    const data = twoPages();
    const inserted = insertHeadItems(data, rows('n1', 'a'), offset);
    expect(ids(inserted)).toEqual(['n1', 'a', 'b', 'c', 'd']);
    expect(inserted.nextCursor).toBe(data.nextCursor);
    expect(inserted.total).toBe(6);
    expect(inserted.pages?.[0].count).toBe(3);
  });

  it('patches and removes a row by id', () => {
    const data = twoPages();
    const renamed = mapPagedItem(data, 'c', (row) => ({ ...row, title: 'C' }), offset);
    expect(renamed.items[2]).toEqual({ id: 'c', title: 'C' });
    expect(mapPagedItem(data, 'missing', () => undefined, offset)).toBe(data);

    const removed = mapPagedItem(data, 'c', () => undefined, offset);
    expect(ids(removed)).toEqual(['a', 'b', 'd']);
    expect(removed.total).toBe(4);
  });

  it('derives the offset cursor for views without bookkeeping', () => {
    const legacy = { currentPage: 1, hasMore: true, items: rows('a'), pageSize: 1 };
    expect(getNextPageCursor(legacy, offset)).toBe(2);
    expect(getNextPageCursor({ ...legacy, hasMore: false }, offset)).toBeNull();
  });

  describe('persistence limits', () => {
    it('persists the head page only by default, without flags or client-only rows', () => {
      const data = { ...insertHeadItems(twoPages(), rows('tmp'), offset), isLoadingMore: true };
      const persisted = toPersistedPage(data, offset, { isClientOnly: (row) => row.id === 'tmp' });
      expect(ids(persisted)).toEqual(['a', 'b']);
      expect(persisted).toMatchObject({ currentPage: 0, hasMore: true, nextCursor: 1 });
      expect(persisted).not.toHaveProperty('isLoadingMore');
    });

    it('honours persist.pages and persist.maxItems', () => {
      const threePages = applyNextPage(twoPages(), { items: rows('e'), total: 5 }, offset);
      const pages = toPersistedPage(threePages, { ...offset, persist: { pages: 2 } });
      expect(ids(pages)).toEqual(['a', 'b', 'c', 'd']);
      expect(pages).toMatchObject({ currentPage: 1, nextCursor: 2 });

      // maxItems cuts at a page boundary so the persisted offset stays valid.
      const capped = toPersistedPage(threePages, { ...offset, persist: { maxItems: 3, pages: 3 } });
      expect(ids(capped)).toEqual(['a', 'b']);
      expect(capped.currentPage).toBe(0);
    });
  });
});

/**
 * Message-like fixture: transcript ascending by createdAt (newest last),
 * "load older" prepends, the server cursor is `{ createdAt, id }` and `null`
 * marks the topic start — mirrors `getMessagesByCursor` / `olderCursor`.
 */
describe('cursor / backward paging (message-like transcript)', () => {
  interface Message {
    createdAt: number;
    id: string;
  }
  interface Cursor {
    createdAt: number;
    id: string;
  }
  const msg = (n: number): Message => ({ createdAt: n, id: `m${n}` });
  const range = (from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, i) => msg(from + i));
  const cursorOf = (m: Message): Cursor => ({ createdAt: m.createdAt, id: m.id });
  const messages: ReplicaPagingConfig<Message> = {
    direction: 'backward',
    getId: (m) => m.id,
    mode: 'cursor',
    persist: { maxItems: 100 },
    sort: (a, b) => a.createdAt - b.createdAt,
  };
  const mids = (data: ReplicaPagedData<Message, Cursor>) => data.items.map((m) => m.id);

  const loadedTwoWindows = () => {
    const head = applyHeadPage<Message, Cursor>(
      undefined,
      { items: range(7, 10), nextCursor: cursorOf(msg(7)) },
      { pageSize: 4 },
      messages,
    );
    return applyNextPage(head, { items: range(3, 6), nextCursor: cursorOf(msg(3)) }, messages);
  };

  it('prepends older history and pins the join anchor', () => {
    const data = loadedTwoWindows();
    expect(mids(data)).toEqual(['m3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'm10']);
    expect(data.anchorId).toBe('m7');
    expect(data.nextCursor).toEqual({ createdAt: 3, id: 'm3' });
  });

  it('marks the topic start on a null cursor or an empty page', () => {
    const exhausted = applyNextPage(
      loadedTwoWindows(),
      { items: range(1, 2), nextCursor: null },
      messages,
    );
    expect(exhausted.hasMore).toBe(false);
    const empty = applyNextPage(
      loadedTwoWindows(),
      { items: [], nextCursor: cursorOf(msg(3)) },
      messages,
    );
    expect(empty.nextCursor).toBeNull();
  });

  it('streamed messages land at the newest end without breaking the older cursor', () => {
    const data = insertHeadItems(loadedTwoWindows(), [msg(11)], messages);
    expect(mids(data).at(-1)).toBe('m11');
    expect(data.nextCursor).toEqual({ createdAt: 3, id: 'm3' });
  });

  it('keeps older pages when the refreshed window still contains the anchor', () => {
    const refreshed = applyHeadPage(
      loadedTwoWindows(),
      { items: range(7, 11), nextCursor: cursorOf(msg(7)) },
      { pageSize: 4 },
      messages,
    );
    expect(mids(refreshed)).toEqual(range(3, 11).map((m) => m.id));
    expect(refreshed.nextCursor).toEqual({ createdAt: 3, id: 'm3' });
  });

  it('collapses to the fresh window when it slid past the anchor (gap)', () => {
    const refreshed = applyHeadPage(
      loadedTwoWindows(),
      { items: range(9, 12), nextCursor: cursorOf(msg(9)) },
      { pageSize: 4 },
      messages,
    );
    expect(mids(refreshed)).toEqual(['m9', 'm10', 'm11', 'm12']);
    expect(refreshed.currentPage).toBe(0);
    expect(refreshed.nextCursor).toEqual({ createdAt: 9, id: 'm9' });
  });

  it('keeps optimistic (tmp) messages at the newest end across refreshes', () => {
    const ctx = { isClientOnly: (m: Message) => m.id.startsWith('tmp') };
    const withTmp = insertHeadItems(loadedTwoWindows(), [{ createdAt: 99, id: 'tmp_1' }], messages);
    const refreshed = applyHeadPage(
      withTmp,
      { items: range(7, 10), nextCursor: cursorOf(msg(7)) },
      { pageSize: 4 },
      messages,
      ctx,
    );
    expect(mids(refreshed).at(-1)).toBe('tmp_1');
    expect(toPersistedPage(refreshed, messages, ctx).items.some((m) => m.id === 'tmp_1')).toBe(
      false,
    );
  });

  it('collapse after an edit in older history keeps the newest window and its cursor', () => {
    const collapsed = collapseToHead(loadedTwoWindows(), messages);
    expect(mids(collapsed)).toEqual(['m7', 'm8', 'm9', 'm10']);
    expect(collapsed.nextCursor).toEqual({ createdAt: 7, id: 'm7' });
  });

  it('persists the newest window, capped by maxItems; a cut forgets the cursor', () => {
    const persisted = toPersistedPage(loadedTwoWindows(), messages);
    expect(mids(persisted)).toEqual(['m7', 'm8', 'm9', 'm10']);
    expect(persisted.nextCursor).toEqual({ createdAt: 7, id: 'm7' });

    const capped = toPersistedPage(loadedTwoWindows(), { ...messages, persist: { maxItems: 2 } });
    expect(mids(capped)).toEqual(['m9', 'm10']);
    expect(capped.nextCursor).toBeUndefined();
  });
});
