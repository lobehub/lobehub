import { toast } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { useSize } from 'ahooks';
import { memo, useMemo, useRef } from 'react';

import { sx } from '@/styles/sx';

import { useBoard } from '../BoardContext';
import { moveBoardItem } from '../data/moveBoardItem';
import type { BoardModel } from '../model';
import { artboardActions } from '../store';
import Edges from './Edges';
import FrameNode from './FrameNode';
import Groups from './Groups';
import Notes from './Notes';
import { SelectionBar, ZoomBar } from './Overlays';
import { canvasStyles } from './styles';
import { useViewport } from './useViewport';
import { liveFrameKey } from './visibleFrames';

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
      <Notes />
      <Edges k={k} />
      {board.frames.map((frame) => (
        <FrameNode frame={frame} k={k} key={frame.id} live={liveIds.has(frame.id)} />
      ))}
    </>
  );
});

Content.displayName = 'ArtboardCanvasContent';

const clearSelection = () => artboardActions.select(null);
const clearDrag = () => artboardActions.setDrag(null);

const Canvas = ({ narrow }: { narrow: boolean }) => {
  const board = useBoard();
  const ref = useRef<HTMLDivElement>(null);
  const size = useSize(ref);
  const dropItem = (id: string, x: number, y: number) => {
    moveBoardItem(
      { artboard: board.artboard, imageUrls: board.imageUrls },
      id,
      x,
      y,
      clearDrag,
    ).catch((error: Error) => {
      clearDrag();
      toast.error(error.message);
    });
  };
  const { fitAll, flying, handlers, panning, view, zoomBy } = useViewport(
    ref,
    board,
    clearSelection,
    dropItem,
  );
  const live = size ? liveFrameKey(board.frames, { ...view, ...size }) : '';

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
