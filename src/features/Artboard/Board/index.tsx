'use client';

import { DraggablePanel, Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { useSize } from 'ahooks';
import { type ReactNode, useEffect, useRef } from 'react';

import { BoardProvider, useBoard } from '../BoardContext';
import Canvas from '../Canvas';
import { useArtboard } from '../data/useArtboard';
import { useArtboardRevisionWatch } from '../data/useArtboardRevisionWatch';
import { artboardActions, useArtboardStore } from '../store';
import { useArtboardFeature } from '../useArtboardFeature';
import VerifyPanel from '../Verify';
import FlowStage from '../Verify/FlowStage';
import Header from './Header';
import Outline from './Outline';
import { VerifyBar } from './StageBars';
import StaleBanner from './StaleBanner';
import { BoardEmpty, BoardError, BoardLoading } from './States';

const NARROW_WIDTH = 768;

const styles = stylex.create({
  body: {
    display: 'flex',
    flex: '1',
    minHeight: 0,
    position: 'relative',
  },
  sheet: {
    backgroundColor: cssVar.colorBgContainer,
    inset: 0,
    position: 'absolute',
    zIndex: 20,
  },
  stage: {
    flex: '1',
    minWidth: 0,
    overflow: 'hidden',
    position: 'relative',
  },
});

const Stage = ({ narrow }: { narrow: boolean }) => {
  const board = useBoard();
  const { mode, outlineOpen, verifyView } = useArtboardStore((s) => ({
    mode: s.mode,
    outlineOpen: s.outlineOpen,
    verifyView: s.verifyView,
  }));

  if (!board.artboard.content.boards.length)
    return (
      <div {...stylex.props(styles.stage)}>
        <BoardEmpty />
      </div>
    );

  return (
    <div {...stylex.props(styles.stage)}>
      {mode === 'verify' && verifyView === 'flow' ? <FlowStage /> : <Canvas narrow={narrow} />}
      {outlineOpen && !narrow && mode === 'discuss' && <Outline />}
      {mode === 'verify' && <VerifyBar />}
    </div>
  );
};

const SidePanel = ({
  children,
  narrow,
  open,
}: {
  children: ReactNode;
  narrow: boolean;
  open: boolean;
}) => {
  if (narrow) return open ? <div {...stylex.props(styles.sheet)}>{children}</div> : null;
  return (
    <DraggablePanel
      backgroundColor={cssVar.colorBgContainer}
      defaultSize={{ height: '100%', width: 360 }}
      expand={open}
      expandable={false}
      maxWidth={520}
      minWidth={300}
      placement={'right'}
    >
      {children}
    </DraggablePanel>
  );
};

const BoardLayout = ({ onExitFullscreen }: { onExitFullscreen?: () => void }) => {
  const board = useBoard();
  useArtboardRevisionWatch(board.artboard);
  const rootRef = useRef<HTMLDivElement>(null);
  const size = useSize(rootRef);
  const narrow = !!size && size.width < NARROW_WIDTH;
  const { mode, verifyOpen } = useArtboardStore((s) => ({
    mode: s.mode,
    verifyOpen: s.verifyOpen,
  }));

  useEffect(() => {
    if (size) artboardActions.setNarrow(narrow);
  }, [narrow, size]);

  return (
    <Flexbox flex={1} height={'100%'} ref={rootRef} style={{ minWidth: 0 }}>
      <Header narrow={narrow} onExitFullscreen={onExitFullscreen} />
      <StaleBanner />
      <div {...stylex.props(styles.body)}>
        <Stage narrow={narrow} />
        {mode === 'verify' && (
          <SidePanel narrow={narrow} open={verifyOpen}>
            <VerifyPanel
              onClose={narrow ? () => artboardActions.setVerifyOpen(false) : undefined}
            />
          </SidePanel>
        )}
      </div>
    </Flexbox>
  );
};

interface BoardViewProps {
  artboardId: string;
  onExitFullscreen?: () => void;
}

const BoardView = ({ artboardId, onExitFullscreen }: BoardViewProps) => {
  const { enabled } = useArtboardFeature();
  const { data, error, isLoading, mutate } = useArtboard(artboardId);

  useEffect(() => {
    if (enabled) artboardActions.bindBoard(artboardId);
  }, [artboardId, enabled]);

  if (!enabled) return null;

  if (!data) {
    if (error && !isLoading) return <BoardError onRetry={() => void mutate()} />;
    return <BoardLoading />;
  }

  return (
    <BoardProvider artboard={data.artboard} imageUrls={data.imageUrls}>
      <BoardLayout onExitFullscreen={onExitFullscreen} />
    </BoardProvider>
  );
};

export default BoardView;
