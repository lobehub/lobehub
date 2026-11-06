'use client';

import { Block, cx } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { SquarePenIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { ActionButtons } from '@/routes/(main)/(create)/image/features/GenerationFeed/GenerationItem/ActionButtons';
import { styles } from '@/routes/(main)/(create)/image/features/GenerationFeed/GenerationItem/styles';
import type { Generation, VideoGenerationAsset } from '@/types/generation';

const editingStyles = stylex.create({
  badge: {
    pointerEvents: 'none',
    position: 'absolute',
    zIndex: 10,
    insetBlockStart: '8px',
    insetInlineStart: '8px',
    display: 'flex',
    gap: '4px',
    alignItems: 'center',
    paddingBlock: '2px',
    paddingInline: '8px',
    borderRadius: '999px',
    fontSize: '12px',
    fontWeight: 500,
    color: cssVar.colorBgContainer,
    backgroundColor: cssVar.colorText,
    backgroundImage: 'none',
  },
  editing: { boxShadow: `0 0 0 2px ${cssVar.colorPrimary}` },
});

interface VideoSuccessItemProps {
  generation: Generation;
  /** Marks the video currently loaded into the prompt input as the edit source. */
  isEditing?: boolean;
  onDelete: () => void;
  onDownload: () => void;
}

const VideoSuccessItem = memo<VideoSuccessItemProps>(
  ({ generation, isEditing, onDelete, onDownload }) => {
    const { t } = useTranslation('video');
    const asset = generation.asset as VideoGenerationAsset;

    return (
      <Block
        style={{ width: 'fit-content' }}
        variant={'filled'}
        className={cx(
          stylex.props(isEditing && editingStyles.editing).className,
          styles.imageContainer,
        )}
      >
        <video
          controls
          loop
          playsInline
          poster={asset.coverUrl || asset.thumbnailUrl}
          src={asset.url}
          style={{ display: 'block', maxHeight: '50vh', maxWidth: '100%' }}
        />
        {isEditing && (
          <div {...stylex.props(editingStyles.badge)}>
            <SquarePenIcon size={12} />
            {t('generation.editing.badge')}
          </div>
        )}
        <ActionButtons showDownload onDelete={onDelete} onDownload={onDownload} />
      </Block>
    );
  },
);

VideoSuccessItem.displayName = 'VideoSuccessItem';

export default VideoSuccessItem;
