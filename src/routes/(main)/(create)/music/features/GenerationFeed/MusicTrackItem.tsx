'use client';

import type { MusicGenerationAsset } from '@lobechat/types';
import { ActionIcon, Block, Flexbox, Icon, Tag, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { MusicIcon, Trash2Icon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AudioPlayer from '@/features/AudioPlayer';

import { formatSongDuration } from './utils';

const styles = stylex.create({
  cover: {
    flex: 'none',
    width: '56px',
    height: '56px',
    borderRadius: cssVar.borderRadius,
    objectFit: 'cover',
    backgroundColor: cssVar.colorFillTertiary,
  },
  coverFallback: {
    display: 'flex',
    flex: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    width: '56px',
    height: '56px',
    borderRadius: cssVar.borderRadius,
    color: cssVar.colorTextSecondary,
    backgroundColor: cssVar.colorFillTertiary,
  },
});

interface MusicTrackItemProps {
  asset: MusicGenerationAsset;
  downloadFileName: string;
  generationId: string;
  onDelete: () => void;
  title: string;
}

const MusicTrackItem = memo<MusicTrackItemProps>(
  ({ asset, downloadFileName, generationId, onDelete, title }) => {
    const { t } = useTranslation('music');
    const duration = formatSongDuration(asset.duration);

    return (
      <Block
        horizontal
        align={'center'}
        data-music-generation-id={generationId}
        data-music-status={'success'}
        gap={12}
        padding={12}
        variant={'filled'}
      >
        {asset.coverUrl ? (
          <img alt={title} src={asset.coverUrl} {...stylex.props(styles.cover)} />
        ) : (
          <div {...stylex.props(styles.coverFallback)}>
            <Icon icon={MusicIcon} size={24} />
          </div>
        )}
        <Flexbox flex={1} gap={6} style={{ minWidth: 0 }}>
          <Flexbox horizontal align={'center'} gap={6} style={{ minWidth: 0 }}>
            <Text ellipsis strong>
              {title}
            </Text>
            {duration && (
              <Text fontSize={12} style={{ flex: 'none' }} type={'secondary'}>
                {duration}
              </Text>
            )}
            {asset.tags && (
              <Tag size={'small'} style={{ maxWidth: 240 }} title={asset.tags}>
                <Text ellipsis fontSize={12}>
                  {asset.tags}
                </Text>
              </Tag>
            )}
          </Flexbox>
          <AudioPlayer
            fullWidth
            alt={title}
            downloadFileName={downloadFileName}
            durationMs={asset.duration ? asset.duration * 1000 : undefined}
            url={asset.url!}
          />
        </Flexbox>
        <ActionIcon
          icon={Trash2Icon}
          size={'small'}
          style={{ flex: 'none' }}
          title={t('generation.actions.delete')}
          onClick={onDelete}
        />
      </Block>
    );
  },
);

MusicTrackItem.displayName = 'MusicTrackItem';

export default MusicTrackItem;
