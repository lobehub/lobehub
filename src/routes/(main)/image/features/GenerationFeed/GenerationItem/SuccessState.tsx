'use client';

import { Block } from '@lobehub/ui';
import { memo } from 'react';

import ImageItem from '@/components/ImageItem';

import { ActionButtons } from './ActionButtons';
import { styles } from './styles';
import { type SuccessStateProps } from './types';
import { getThumbnailMaxWidth } from './utils';

// 成功状态组件
export const SuccessState = memo<SuccessStateProps>(
  ({
    generation,
    generationBatch,
    prompt,
    aspectRatio,
    onDelete,
    onDownload,
    onCopySeed,
    seedTooltip,
  }) => {
    return (
      <Block
        align={'center'}
        className={styles.imageContainer}
        justify={'center'}
        variant={'filled'}
        style={{
          aspectRatio,
          maxWidth: getThumbnailMaxWidth(generation, generationBatch),
        }}
      >
        <ImageItem
          alt={prompt}
          preview={{
            src: generation.asset!.url,
          }}
          style={{ height: '100%', width: '100%' }}
          // Thumbnail quality is too bad
          url={generation.asset!.url}
        />
        <ActionButtons
          showDownload
          seedTooltip={seedTooltip}
          showCopySeed={!!generation.seed}
          onCopySeed={onCopySeed}
          onDelete={onDelete}
          onDownload={onDownload}
        />
      </Block>
    );
  },
);

SuccessState.displayName = 'SuccessState';
