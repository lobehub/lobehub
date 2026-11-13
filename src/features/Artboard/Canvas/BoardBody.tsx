import type { ArtboardBoardView } from '@lobechat/types';
import { Icon, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { GitForkIcon, ImageOffIcon, LayoutTemplateIcon, type LucideIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import CanvasFrame from '@/features/Conversation/WorkingSidebar/Canvas/CanvasFrame';

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

const Placeholder = ({ icon, text }: { icon: LucideIcon; text: string }) => (
  <div {...stylex.props(canvasStyles.noShot)}>
    <Icon icon={icon} size={22} />
    <Text ellipsis style={{ maxWidth: '80%' }} type="secondary">
      {text}
    </Text>
  </div>
);

interface BoardBodyProps {
  board: ArtboardBoardView;
  imageUrl?: string;
  live: boolean;
  screenshotUrl?: string | null;
}

const BoardBody = memo<BoardBodyProps>(({ board, imageUrl, live, screenshotUrl }) => {
  const { t } = useTranslation('project');
  if (screenshotUrl === null)
    return <Placeholder icon={ImageOffIcon} text={t('artboard.verify.noShot')} />;
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
  if (board.type === 'decision') return <Placeholder icon={GitForkIcon} text={board.title} />;
  if (!source || (source.kind === 'image' && !imageUrl))
    return <Placeholder icon={ImageOffIcon} text={t('artboard.board.sourceMissing')} />;
  if (source.kind === 'image')
    return (
      <img alt={board.title} draggable={false} src={imageUrl} {...stylex.props(styles.image)} />
    );

  if (!live) return <Placeholder icon={LayoutTemplateIcon} text={board.title} />;
  return (
    <div {...stylex.props(styles.canvas, canvasStyles.inert)}>
      <CanvasFrame canvasId={source.canvasId} path={source.path} version={source.version} />
    </div>
  );
});

BoardBody.displayName = 'ArtboardBoardBody';

export default BoardBody;
