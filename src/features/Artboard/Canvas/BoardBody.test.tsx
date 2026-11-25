import type { ArtboardBoardView } from '@lobechat/types';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { type BoardCapabilities, BoardCapabilitiesProvider } from '../Viewport/capabilities';
import BoardBody from './BoardBody';

const board = (patch: Partial<ArtboardBoardView> = {}): ArtboardBoardView => ({
  expected: null,
  flowNodeId: null,
  groupId: null,
  id: 'brd_1',
  pageId: 'pg_1',
  rect: { h: 400, w: 640, x: 0, y: 0 },
  roundId: null,
  source: { hash: null, kind: 'file', path: 'pages/home.html' },
  title: 'Home',
  type: 'html',
  ...patch,
});

const renderBody = (item: ArtboardBoardView, capabilities: Partial<BoardCapabilities> = {}) => {
  const renderCanvas = vi.fn(() => <iframe title="canvas" />);
  render(
    <BoardCapabilitiesProvider value={{ renderCanvas, ...capabilities }}>
      <BoardBody live board={item} />
    </BoardCapabilitiesProvider>,
  );
  return renderCanvas;
};

describe('BoardBody with a file that does not exist', () => {
  it('shows that the board is being written while an agent runs in its topic', () => {
    const renderCanvas = renderBody(board(), { agentRunning: true });

    expect(screen.getByText('artboard.board.generating')).toBeTruthy();
    expect(screen.queryByText('artboard.board.fileMissing')).toBeNull();
    expect(renderCanvas).not.toHaveBeenCalled();
  });

  it('names the missing file when no agent is running', () => {
    const renderCanvas = renderBody(board());

    expect(screen.getByText('artboard.board.fileMissing')).toBeTruthy();
    expect(screen.queryByText('artboard.board.generating')).toBeNull();
    expect(renderCanvas).not.toHaveBeenCalled();
  });

  it('treats an image board without its file the same way', () => {
    renderBody(
      board({ source: { hash: null, kind: 'file', path: 'shots/a.png' }, type: 'image' }),
      {
        agentRunning: true,
      },
    );

    expect(screen.getByText('artboard.board.generating')).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('renders the canvas once the file exists', () => {
    const renderCanvas = renderBody(
      board({ source: { hash: 'etag_1', kind: 'file', path: 'pages/home.html' } }),
      { agentRunning: true },
    );

    expect(renderCanvas).toHaveBeenCalled();
    expect(screen.queryByText('artboard.board.generating')).toBeNull();
  });
});
