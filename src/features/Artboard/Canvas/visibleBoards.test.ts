import type { ArtboardBoardView } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { MAX_LIVE, nextLiveBoards } from './visibleBoards';

const board = (id: string, x: number, w = 640) =>
  ({ id, rect: { h: 400, w, x, y: 0 } }) as ArtboardBoardView;

const boards = [board('a', 0), board('b', 840), board('c', 4000)];
const screen = { height: 800, width: 1200 };
const at = (k: number, x = 0) => ({ ...screen, k, x, y: 0 });

describe('nextLiveBoards', () => {
  it('mounts the readable boards in the viewport', () => {
    expect(nextLiveBoards([], boards, at(1))).toEqual(['a', 'b']);
  });

  it('keeps a mounted board after it leaves the viewport', () => {
    expect(nextLiveBoards(['a', 'b'], boards, at(1, -700))).toEqual(['b', 'a']);
  });

  it('keeps mounted boards when zoomed out too far to read them', () => {
    const live = ['a', 'b'];
    expect(nextLiveBoards(live, boards, at(0.1))).toBe(live);
  });

  it('does not mount a board first seen too small to read', () => {
    expect(nextLiveBoards([], boards, at(0.1))).toEqual([]);
  });

  it('judges readability by each board’s own width', () => {
    expect(nextLiveBoards([], [board('wide', 0, 1600), board('a', 0)], at(0.1))).toEqual(['wide']);
  });

  it('releases the board seen least recently once the cap is reached', () => {
    const many = Array.from({ length: MAX_LIVE }, (_, i) => board(`b${i}`, 10_000 + i * 700));
    const previous = many.map((b) => b.id);

    const next = nextLiveBoards(previous, [board('new', 0), ...many], at(1));

    expect(next).toHaveLength(MAX_LIVE);
    expect(next[0]).toBe('new');
    expect(next).not.toContain(`b${MAX_LIVE - 1}`);
  });

  it('forgets boards that are no longer on the page', () => {
    expect(nextLiveBoards(['gone', 'a'], boards, at(0.1))).toEqual(['a']);
  });
});
