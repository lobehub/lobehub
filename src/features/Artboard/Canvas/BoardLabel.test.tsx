import type { ArtboardBoardView } from '@lobechat/types';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import BoardLabel from './BoardLabel';

const board: ArtboardBoardView = {
  expected: null,
  flowNodeId: null,
  groupId: null,
  id: 'brd_1',
  pageId: 'pg_1',
  rect: { h: 400, w: 640, x: 0, y: 0 },
  roundId: null,
  source: { hash: 'h_1', kind: 'file', path: 'pages/home.html' },
  title: 'Home',
  type: 'html',
};

describe('BoardLabel', () => {
  it('shows the title of a board backed by an artboard file', () => {
    render(
      <BoardLabel
        board={board}
        k={1}
        linked={false}
        recommended={false}
        selected={false}
        verify={false}
      />,
    );

    expect(screen.getByText('Home')).toBeTruthy();
  });
});
