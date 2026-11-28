import * as stylex from '@stylexjs/stylex';
import { useSize } from 'ahooks';
import { memo, type MouseEvent, type ReactNode, useMemo, useRef } from 'react';

import { sx } from '@/styles/sx';

import { useBoard } from '../BoardContext';
import BoardNode from '../Canvas/BoardNode';
import Edges from '../Canvas/Edges';
import Groups from '../Canvas/Groups';
import { canvasStyles } from '../Canvas/styles';
import { useViewport, type ViewState } from '../Canvas/useViewport';
import { nextLiveBoards } from '../Canvas/visibleBoards';
import type { BoardModel } from '../model';
import ZoomBar from './ZoomBar';

const noop = () => {};

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

Content.displayName = 'ArtboardViewportContent';

export interface ViewportSize {
  height: number;
  width: number;
}

interface ViewportProps {
  children?: (state: { size: ViewportSize | undefined; view: ViewState }) => ReactNode;
  commenting?: boolean;
  onBackground?: () => void;
  onCanvasClick?: (event: MouseEvent<HTMLDivElement>, view: ViewState) => void;
}

const Viewport = ({ children, commenting, onBackground, onCanvasClick }: ViewportProps) => {
  const board = useBoard();
  const ref = useRef<HTMLDivElement>(null);
  const size = useSize(ref);
  const { fitAll, flying, handlers, panning, view, zoomBy } = useViewport(
    ref,
    board,
    onBackground ?? noop,
  );
  const liveRef = useRef<readonly string[]>([]);
  if (size && !flying)
    liveRef.current = nextLiveBoards(liveRef.current, board.boards, { ...view, ...size });
  const live = liveRef.current.toSorted().join(' ');

  const onClickCapture = (event: MouseEvent<HTMLDivElement>) => {
    let suppressed = false;
    handlers.onClickCapture({
      stopPropagation: () => {
        suppressed = true;
        event.stopPropagation();
      },
    });
    if (!suppressed) onCanvasClick?.(event, view);
  };

  return (
    <>
      <div
        ref={ref}
        {...stylex.props(
          canvasStyles.viewport,
          commenting && canvasStyles.commenting,
          panning && canvasStyles.panning,
        )}
        {...handlers}
        onClickCapture={onClickCapture}
      >
        <div
          {...sx(canvasStyles.world, flying && canvasStyles.worldFlying, {
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`,
          })}
        >
          <Content board={board} k={view.k} live={live} />
        </div>
      </div>
      {children?.({ size, view })}
      <ZoomBar k={view.k} onFit={fitAll} onZoom={zoomBy} />
    </>
  );
};

export default Viewport;
