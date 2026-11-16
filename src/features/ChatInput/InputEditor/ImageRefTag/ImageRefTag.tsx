import { Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ImageIcon } from 'lucide-react';
import type { MouseEvent } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { openFilePreviewModal } from '@/features/ChatInput/Desktop/ContextContainer/ContextItem/FilePreviewModal.loader';

import { useImageRefUpload } from './useImageRefUpload';

const styles = stylex.create({
  tag: {
    cursor: 'zoom-in',
    userSelect: 'none',
    display: 'inline-flex',
    gap: '4px',
    alignItems: 'center',
    height: '20px',
    marginInline: '1px',
    paddingInlineStart: '2px',
    paddingInlineEnd: '6px',
    borderRadius: cssVar.borderRadiusSM,
    fontSize: '12px',
    lineHeight: '20px',
    color: cssVar.colorTextSecondary,
    whiteSpace: 'nowrap',
    verticalAlign: 'text-bottom',
    backgroundColor: {
      'default': cssVar.colorFillTertiary,
      ':hover': cssVar.colorFillSecondary,
    },
  },
  orphan: { cursor: 'default', opacity: 0.5, textDecorationLine: 'line-through' },
  thumbnail: {
    flexShrink: 0,
    width: '16px',
    height: '16px',
    borderRadius: cssVar.borderRadiusXS,
    objectFit: 'cover',
    backgroundColor: cssVar.colorFillQuaternary,
  },
});

interface ImageRefTagProps {
  number: number;
  src: string;
}

/** Inline chip for a `[Image #N]` reference; a click opens the referenced image. */
export const ImageRefTag = memo<ImageRefTagProps>(({ number, src }) => {
  const { t } = useTranslation('chat');
  const live = useImageRefUpload(src);
  // The live number follows removals even through undo; a reference whose image is gone
  // keeps its last number, shows no thumbnail, and is left out of the sent text.
  const upload = live.upload;
  const label = t('upload.image.label', { number: live.number ?? number });

  const handleMouseDown = (event: MouseEvent) => {
    // Keep the caret where it is; the click opens the preview instead.
    event.preventDefault();
  };
  const handleClick = () => {
    if (upload) void openFilePreviewModal(upload);
  };

  return (
    <span
      aria-label={t('upload.image.preview', { name: label })}
      role={'button'}
      onClick={handleClick}
      onMouseDown={handleMouseDown}
      {...stylex.props(styles.tag, !upload && styles.orphan)}
    >
      {upload ? (
        <img alt={''} draggable={false} src={src} {...stylex.props(styles.thumbnail)} />
      ) : (
        <Icon icon={ImageIcon} size={14} />
      )}
      {label}
    </span>
  );
});

ImageRefTag.displayName = 'ImageRefTag';
