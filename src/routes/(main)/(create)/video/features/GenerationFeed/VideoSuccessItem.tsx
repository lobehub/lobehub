'use client';

import { Block } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { SquarePenIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { ActionButtons } from '@/routes/(main)/(create)/image/features/GenerationFeed/GenerationItem/ActionButtons';
import { styles } from '@/routes/(main)/(create)/image/features/GenerationFeed/GenerationItem/styles';
import type { Generation, VideoGenerationAsset } from '@/types/generation';

const editingStyles = createStaticStyles(({ css, cssVar }) => ({
  badge: css`
    pointer-events: none;

    position: absolute;
    z-index: 10;
    inset-block-start: 8px;
    inset-inline-start: 8px;

    display: flex;
    gap: 4px;
    align-items: center;

    padding-block: 2px;
    padding-inline: 8px;
    border-radius: 999px;

    font-size: 12px;
    font-weight: 500;
    color: ${cssVar.colorBgContainer};

    background: ${cssVar.colorText};
  `,
  editing: css`
    box-shadow: 0 0 0 2px ${cssVar.colorPrimary};
  `,
}));

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
        className={cx(styles.imageContainer, isEditing && editingStyles.editing)}
        style={{ width: 'fit-content' }}
        variant={'filled'}
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
          <div className={editingStyles.badge}>
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
