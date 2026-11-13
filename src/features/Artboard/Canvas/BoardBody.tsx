import type { ArtboardFrame } from '@lobechat/types';
import { Icon, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { ImageOffIcon, LayoutTemplateIcon } from 'lucide-react';
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

const Placeholder = ({
  missing,
  title,
  unavailable,
}: {
  missing?: boolean;
  title: string;
  unavailable?: boolean;
}) => {
  const { t } = useTranslation('project');
  return (
    <div {...stylex.props(canvasStyles.noShot)}>
      <Icon icon={missing || unavailable ? ImageOffIcon : LayoutTemplateIcon} size={22} />
      <Text ellipsis style={{ maxWidth: '80%' }} type="secondary">
        {unavailable
          ? t('artboard.verify.noShot')
          : missing
            ? t('artboard.frame.missingImage')
            : title}
      </Text>
    </div>
  );
};

interface FrameBodyProps {
  frame: ArtboardFrame;
  imageUrl?: string;
  live: boolean;
  screenshotUrl?: string | null;
}

const FrameBody = memo<FrameBodyProps>(({ frame, imageUrl, live, screenshotUrl }) => {
  if (screenshotUrl === null) return <Placeholder unavailable title={frame.title} />;
  if (screenshotUrl)
    return (
      <img
        alt={frame.title}
        draggable={false}
        src={screenshotUrl}
        {...stylex.props(styles.image)}
      />
    );
  const { source } = frame;
  if (source.kind === 'image')
    return imageUrl ? (
      <img alt={frame.title} draggable={false} src={imageUrl} {...stylex.props(styles.image)} />
    ) : (
      <Placeholder missing title={frame.title} />
    );

  if (!live) return <Placeholder title={frame.title} />;
  return (
    <div {...stylex.props(styles.canvas, canvasStyles.inert)}>
      <CanvasFrame canvasId={source.canvasId} path={source.path} version={source.version} />
    </div>
  );
});

FrameBody.displayName = 'ArtboardFrameBody';

export default FrameBody;
