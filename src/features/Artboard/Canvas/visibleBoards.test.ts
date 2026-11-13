import type { ArtboardBoardView } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { liveBoardKey } from './visibleBoards';

const board = (id: string, x: number, w = 640) =>
  ({ id, rect: { h: 400, w, x, y: 0 } }) as ArtboardBoardView;

const boards = [board('a', 0), board('b', 840), board('c', 4000)];
const screen = { height: 800, width: 1200 };

describe('liveBoardKey', () => {
  it('loads only the boards that overlap the viewport', () => {
    expect(liveBoardKey(boards, { ...screen, k: 1, x: 0, y: 0 })).toBe('a b');
    expect(liveBoardKey(boards, { ...screen, k: 1, x: -700, y: 0 })).toBe('b');
  });

  it('loads nothing while boards are too small to read', () => {
    expect(liveBoardKey(boards, { ...screen, k: 0.3, x: 0, y: 0 })).toBe('');
  });

  it('judges readability by each board’s own width', () => {
    expect(
      liveBoardKey([board('wide', 0, 1600), board('a', 0)], { ...screen, k: 0.3, x: 0, y: 0 }),
    ).toBe('wide');
  });
});
