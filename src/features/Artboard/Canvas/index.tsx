import * as stylex from '@stylexjs/stylex';
import { useSize } from 'ahooks';
import { memo, useMemo, useRef } from 'react';

import { sx } from '@/styles/sx';

import { useBoard } from '../BoardContext';
import type { BoardModel } from '../model';
import { artboardActions } from '../store';
import BoardNode from './BoardNode';
import Edges from './Edges';
import Groups from './Groups';
import { SelectionBar, ZoomBar } from './Overlays';
import { canvasStyles } from './styles';
import { useViewport } from './useViewport';
import { liveBoardKey } from './visibleBoards';

interface ContentProps {
  board: BoardModel;
  k: number;
  live: string;
}

// Panning updates the view on every pointer move; only the world transform should follow it.
const Content = memo<ContentProps>(({ board, k, live }) => {
  const liveIds = useMemo(() => new Set(live.split(' ')), [live]);
  return (
    <>
      <Groups k={k} />
      <Edges k={k} />
      {board.boards.map((item) => (
        <BoardNode board={item} k={k} key={item.id} live={liveIds.has(item.id)} />
      ))}
    </>
  );
});

Content.displayName = 'ArtboardCanvasContent';

const clearSelection = () => artboardActions.select(null);

const Canvas = ({ narrow }: { narrow: boolean }) => {
  const board = useBoard();
  const ref = useRef<HTMLDivElement>(null);
  const size = useSize(ref);
  const { fitAll, flying, handlers, panning, view, zoomBy } = useViewport(
    ref,
    board,
    clearSelection,
  );
  const live = size ? liveBoardKey(board.boards, { ...view, ...size }) : '';

  return (
    <>
      <div
        ref={ref}
        {...stylex.props(canvasStyles.viewport, panning && canvasStyles.panning)}
        {...handlers}
      >
        <div
          {...sx([canvasStyles.world, flying && canvasStyles.worldFlying], undefined, {
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`,
          })}
        >
          <Content board={board} k={view.k} live={flying ? '' : live} />
        </div>
      </div>
      {!narrow && <SelectionBar view={view} />}
      <ZoomBar k={view.k} onFit={fitAll} onZoom={zoomBy} />
    </>
  );
};

export default Canvas;
