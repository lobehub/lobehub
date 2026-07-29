'use client';

import { Block } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { ActionButtons } from '@/routes/(main)/(create)/image/features/GenerationFeed/GenerationItem/ActionButtons';
import { styles } from '@/routes/(main)/(create)/image/features/GenerationFeed/GenerationItem/styles';
import type { Generation, VideoGenerationAsset } from '@/types/generation';

interface VideoSuccessItemProps {
  generation: Generation;
  onDelete: () => void;
  onDownload: () => void;
  onEdit?: () => void;
}

const VideoSuccessItem = memo<VideoSuccessItemProps>(
  ({ generation, onDelete, onDownload, onEdit }) => {
    const { t } = useTranslation('video');
    const asset = generation.asset as VideoGenerationAsset;

    return (
      <Block className={styles.imageContainer} style={{ width: 'fit-content' }} variant={'filled'}>
        <video
          controls
          loop
          playsInline
          poster={asset.coverUrl || asset.thumbnailUrl}
          src={asset.url}
          style={{ display: 'block', maxHeight: '50vh', maxWidth: '100%' }}
        />
        <ActionButtons
          showDownload
          editTooltip={t('generation.actions.edit')}
          showEdit={Boolean(asset.interactionId && onEdit)}
          onDelete={onDelete}
          onDownload={onDownload}
          onEdit={onEdit}
        />
      </Block>
    );
  },
);

VideoSuccessItem.displayName = 'VideoSuccessItem';

export default VideoSuccessItem;
