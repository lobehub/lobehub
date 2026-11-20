'use client';

import { DraggablePanel, Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { useSize } from 'ahooks';
import { type ReactNode, useEffect, useRef } from 'react';

import { BoardProvider, useBoard } from '../BoardContext';
import Canvas from '../Canvas';
import AppBoardCapabilities from '../Canvas/AppCapabilities';
import { resolveArtboardFileBase } from '../data/fileBase';
import { useArtboard } from '../data/useArtboard';
import { useArtboardRevisionWatch } from '../data/useArtboardRevisionWatch';
import { artboardActions, artboardSelectors, useArtboardStore } from '../store';
import { useArtboardFeature } from '../useArtboardFeature';
import VerifyPanel from '../Verify';
import CheckTable from '../Verify/CheckTable';
import Header from './Header';
import Outline from './Outline';
import StaleBanner from './StaleBanner';
import { BoardEmpty, BoardError, BoardLoading } from './States';
import SubmitBar from './SubmitBar';

const NARROW_WIDTH = 768;

const styles = stylex.create({
  body: {
    backgroundColor: cssVar.colorBgLayout,
    display: 'flex',
    flex: '1',
    minHeight: 0,
    position: 'relative',
  },
  card: {
    backgroundColor: cssVar.colorBgElevated,
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: 12,
    borderStyle: 'solid',
    borderWidth: 1,
    boxShadow: cssVar.boxShadowTertiary,
    height: 'calc(100% - 20px)',
    marginBlock: 10,
    marginInlineEnd: 10,
    overflow: 'hidden',
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
      {mode === 'verify' && verifyView === 'list' ? <CheckTable narrow={narrow} /> : <Canvas />}
      {outlineOpen && !narrow && mode === 'discuss' && <Outline />}
      {mode === 'discuss' && <SubmitBar narrow={narrow} />}
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
      backgroundColor={'transparent'}
      defaultSize={{ height: '100%', width: 390 }}
      expand={open}
      expandable={false}
      maxWidth={530}
      minWidth={310}
      placement={'right'}
      showBorder={false}
    >
      <div {...stylex.props(styles.card)}>{children}</div>
    </DraggablePanel>
  );
};

type BoardLayoutProps = Pick<BoardViewProps, 'onClose' | 'onExitFullscreen'>;

const BoardLayout = ({ onClose, onExitFullscreen }: BoardLayoutProps) => {
  const board = useBoard();
  useArtboardRevisionWatch(board.artboard);
  const rootRef = useRef<HTMLDivElement>(null);
  const size = useSize(rootRef);
  const narrow = !!size && size.width < NARROW_WIDTH;
  const selectedCheck = useArtboardStore(artboardSelectors.selectedCheckBoard(board));
  const { mode, verifyOpen, verifyView } = useArtboardStore((s) => ({
    mode: s.mode,
    verifyOpen: s.verifyOpen,
    verifyView: s.verifyView,
  }));
  const panelOpen = verifyOpen && (verifyView === 'board' || !!selectedCheck);

  useEffect(() => {
    if (size) artboardActions.setNarrow(narrow);
  }, [narrow, size]);

  return (
    <Flexbox data-artboard-root flex={1} height={'100%'} ref={rootRef} style={{ minWidth: 0 }}>
      <Header narrow={narrow} onClose={onClose} onExitFullscreen={onExitFullscreen} />
      <StaleBanner />
      <div {...stylex.props(styles.body)}>
        <Stage narrow={narrow} />
        {mode === 'verify' && (
          <SidePanel narrow={narrow} open={panelOpen}>
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
  /** Shown in the Works modal: the header offers to close it. */
  onClose?: () => void;
  /** Shown covering the whole window: the header offers to return to the side panel. */
  onExitFullscreen?: () => void;
}

const BoardView = ({ artboardId, onClose, onExitFullscreen }: BoardViewProps) => {
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
    <BoardProvider artboard={data.artboard} fileBaseUrl={resolveArtboardFileBase(data.fileBaseUrl)}>
      <AppBoardCapabilities>
        <BoardLayout onClose={onClose} onExitFullscreen={onExitFullscreen} />
      </AppBoardCapabilities>
    </BoardProvider>
  );
};

export default BoardView;
