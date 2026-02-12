'use client';

import { LoadingOutlined } from '@ant-design/icons';
import { Block, Center } from '@lobehub/ui';
import { Spin } from 'antd';
import { memo } from 'react';

import { AsyncTaskStatus } from '@/types/asyncTask';

import { ActionButtons } from './ActionButtons';
import { ElapsedTime } from './ElapsedTime';
import { styles } from './styles';
import { type LoadingStateProps } from './types';
import { getThumbnailMaxWidth } from './utils';

// 加载状态组件
export const LoadingState = memo<LoadingStateProps>(
  ({ generation, generationBatch, aspectRatio, onDelete }) => {
    const isGenerating =
      generation.task.status === AsyncTaskStatus.Processing ||
      generation.task.status === AsyncTaskStatus.Pending;

    return (
      <Block
        align={'center'}
        className={styles.placeholderContainer}
        justify={'center'}
        variant={'filled'}
        style={{
          aspectRatio,
          maxWidth: getThumbnailMaxWidth(generation, generationBatch),
        }}
      >
        <Center gap={8}>
          <Spin indicator={<LoadingOutlined spin />} />
          <ElapsedTime generationId={generation.id} isActive={isGenerating} />
        </Center>
        <ActionButtons onDelete={onDelete} />
      </Block>
    );
  },
);

LoadingState.displayName = 'LoadingState';
