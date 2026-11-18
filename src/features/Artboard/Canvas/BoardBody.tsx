import type { ArtboardBoardView } from '@lobechat/types';
import * as stylex from '@stylexjs/stylex';
import { FilePenLineIcon, FileXIcon, ImageOffIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useBoardCapabilities } from '../Viewport/capabilities';
import BoardPlaceholder from './BoardPlaceholder';
import DecisionPill from './DecisionPill';
import { canvasStyles } from './styles';

const styles = stylex.create({
  canvas: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    width: '100%',
  },
  image: {
    display: 'block',
    height: '100%',
    objectFit: 'cover',
    objectPosition: 'top',
    width: '100%',
  },
});

const LiveCanvas = memo<{ board: ArtboardBoardView }>(({ board }) => {
  const { renderCanvas } = useBoardCapabilities();
  return <div {...stylex.props(styles.canvas, canvasStyles.inert)}>{renderCanvas(board)}</div>;
});

LiveCanvas.displayName = 'ArtboardLiveCanvas';

interface BoardBodyProps {
  board: ArtboardBoardView;
  imageUrl?: string;
  k?: number;
  live: boolean;
  screenshotUrl?: string;
}

const BoardBody = ({ board, imageUrl, k = 1, live, screenshotUrl }: BoardBodyProps) => {
  const { t } = useTranslation('project');
  const { agentRunning } = useBoardCapabilities();
  if (screenshotUrl)
    return (
      <img
        alt={board.title}
        draggable={false}
        src={screenshotUrl}
        {...stylex.props(styles.image)}
      />
    );

  const { source } = board;
  if (board.type === 'decision')
    return <DecisionPill height={board.rect.h} k={k} title={board.title} width={board.rect.w} />;
  // The board points at a file that is not written yet (or was deleted).
  if (source && !source.hash)
    return agentRunning ? (
      <BoardPlaceholder
        icon={FilePenLineIcon}
        k={k}
        status={t('artboard.board.generating')}
        title={board.title}
      />
    ) : (
      <BoardPlaceholder
        icon={FileXIcon}
        k={k}
        status={t('artboard.board.fileMissing', { path: source.path })}
        title={board.title}
      />
    );
  if (!source || (board.type === 'image' && !imageUrl))
    return (
      <BoardPlaceholder
        icon={ImageOffIcon}
        k={k}
        status={t('artboard.board.sourceMissing')}
        title={board.title}
      />
    );
  if (board.type === 'image')
    return (
      <img alt={board.title} draggable={false} src={imageUrl} {...stylex.props(styles.image)} />
    );

  if (!live) return <BoardPlaceholder k={k} title={board.title} />;
  return <LiveCanvas board={board} />;
};

export default BoardBody;
