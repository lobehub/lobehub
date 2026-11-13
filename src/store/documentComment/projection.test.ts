import type { DocumentCommentThread, DocumentCommentThreadPage } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { fetchThreadPage, MAX_EMPTY_THREAD_PAGE_HOPS } from './projection';

const thread = (id: string, anchored: boolean) =>
  ({
    replyCount: 0,
    root: { id, selectionAnchor: anchored ? { end: 5, quote: 'hello', start: 0 } : null },
  }) as unknown as DocumentCommentThread;

describe('fetchThreadPage', () => {
  // A server predating `anchored` answers both scopes with the same mixed
  // pages. A page holding only the other scope's roots filters down to
  // nothing, and the replica reads an empty page as the end of the feed.
  it('follows the server cursor past pages that filter down to nothing', async () => {
    const pages: Record<string, DocumentCommentThreadPage> = {
      '': { items: [thread('doc-1', false), thread('doc-2', false)], nextCursor: 'c1' },
      'c1': { items: [thread('doc-3', false)], nextCursor: 'c2' },
      'c2': { items: [thread('anchored-1', true), thread('doc-4', false)], nextCursor: 'c3' },
    };
    const listThreads = vi.fn(async (cursor?: string) => pages[cursor ?? '']);

    const page = await fetchThreadPage(listThreads, 'anchored');

    expect(page.items.map(({ root }) => root.id)).toEqual(['anchored-1']);
    expect(page.nextCursor).toBe('c3');
    expect(listThreads.mock.calls.map(([cursor]) => cursor)).toEqual([undefined, 'c1', 'c2']);
  });

  it('returns the end of the feed when the server runs out', async () => {
    const listThreads = vi
      .fn()
      .mockResolvedValueOnce({ items: [thread('doc-1', false)], nextCursor: 'c1' })
      .mockResolvedValueOnce({ items: [], nextCursor: null });

    const page = await fetchThreadPage(listThreads, 'anchored', 'c0');

    expect(page).toEqual({ items: [], nextCursor: null });
    expect(listThreads.mock.calls.map(([cursor]) => cursor)).toEqual(['c0', 'c1']);
  });

  it('stops after a bounded number of empty pages', async () => {
    let index = 0;
    const listThreads = vi.fn(async () => ({
      items: [thread(`doc-${index}`, false)],
      nextCursor: `c${++index}`,
    }));

    await fetchThreadPage(listThreads, 'anchored');

    expect(listThreads).toHaveBeenCalledTimes(MAX_EMPTY_THREAD_PAGE_HOPS + 1);
  });
});
