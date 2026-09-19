import { describe, expect, it, vi } from 'vitest';

import { resolveAnchors } from './resolveAnchors';
import * as textAnchor from './textAnchor';

const flat = (text: string) => ({ segments: [], text });

const anchor = (quote: string, start: number) => ({
  end: start + quote.length,
  quote,
  start,
});

describe('resolveAnchors', () => {
  it('locates each distinct anchor once, however many threads share it', () => {
    const locate = vi.spyOn(textAnchor, 'locateAnchor');
    const body = flat('the quick brown fox');
    const shared = anchor('quick', 4);

    const { matches, orphaned } = resolveAnchors(body, [
      { id: 'a', selectionAnchor: shared },
      { id: 'b', selectionAnchor: { ...shared } },
      { id: 'gone', selectionAnchor: anchor('vanished', 0) },
    ]);

    expect(locate).toHaveBeenCalledTimes(2);
    expect(matches.get('a')).toEqual({ end: 9, start: 4 });
    expect(matches.get('b')).toEqual({ end: 9, start: 4 });
    expect([...orphaned]).toEqual(['gone']);
    locate.mockRestore();
  });

  it('reuses every result while the body text is unchanged, orphans included', () => {
    const locate = vi.spyOn(textAnchor, 'locateAnchor');
    const body = flat('the quick brown fox');
    const entries = [
      { id: 'a', selectionAnchor: anchor('quick', 4) },
      { id: 'gone', selectionAnchor: anchor('vanished', 0) },
    ];

    const first = resolveAnchors(body, entries);
    locate.mockClear();
    // A formatting-only update re-flattens to identical text.
    const second = resolveAnchors(flat('the quick brown fox'), entries, first.cache);

    expect(locate).not.toHaveBeenCalled();
    expect(second.matches).toEqual(first.matches);
    expect(second.orphaned).toEqual(first.orphaned);
    locate.mockRestore();
  });

  it('re-scans once the text actually changes and lets an orphan come back', () => {
    const locate = vi.spyOn(textAnchor, 'locateAnchor');
    const entries = [{ id: 'gone', selectionAnchor: anchor('vanished', 4) }];

    const first = resolveAnchors(flat('the quick brown fox'), entries);
    expect([...first.orphaned]).toEqual(['gone']);
    locate.mockClear();

    const second = resolveAnchors(flat('the vanished fox'), entries, first.cache);

    expect(locate).toHaveBeenCalledTimes(1);
    expect(second.orphaned.size).toBe(0);
    expect(second.matches.get('gone')).toEqual({ end: 12, start: 4 });
    locate.mockRestore();
  });

  it('drops cached entries for anchors that are no longer listed', () => {
    const body = flat('the quick brown fox');
    const first = resolveAnchors(body, [{ id: 'a', selectionAnchor: anchor('quick', 4) }]);

    const second = resolveAnchors(body, [], first.cache);

    expect(second.cache.results.size).toBe(0);
    expect(second.matches.size).toBe(0);
  });
});
