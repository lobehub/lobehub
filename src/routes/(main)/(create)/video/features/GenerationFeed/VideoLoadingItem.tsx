'use client';

import { LoadingOutlined } from '@ant-design/icons';
import { Block, Center } from '@lobehub/ui';
import { Progress, Spin } from 'antd';
import { memo } from 'react';

import { MAX_ESTIMATED_PROGRESS, useEstimatedProgress } from '@/hooks/useEstimatedProgress';
import { ElapsedTime } from '@/routes/(main)/(create)/image/features/GenerationFeed/GenerationItem/ElapsedTime';
import { AsyncTaskStatus } from '@/types/asyncTask';
import type { Generation } from '@/types/generation';

const DEFAULT_AVG_LATENCY_MS = 180_000;

const getSessionStorageKey = (generationId: string) => `generation_start_time_${generationId}`;

interface VideoLoadingItemProps {
  aspectRatio?: string;
  avgLatencyMs?: number | null;
  generation: Generation;
}

const VideoLoadingItem = memo<VideoLoadingItemProps>(
  ({ generation, aspectRatio, avgLatencyMs }) => {
    const latency = avgLatencyMs && avgLatencyMs > 0 ? avgLatencyMs : DEFAULT_AVG_LATENCY_MS;
    const isGenerating =
      generation.task.status === AsyncTaskStatus.Processing ||
      generation.task.status === AsyncTaskStatus.Pending;

    const progress = useEstimatedProgress({
      durationMs: latency,
      enabled: isGenerating,
      storageKey: getSessionStorageKey(generation.id),
    });

    return (
      <Block
        align={'center'}
        justify={'center'}
        variant={'filled'}
        style={{
          aspectRatio: aspectRatio?.includes(':') ? aspectRatio.replace(':', '/') : '16/9',
          maxHeight: '50vh',
        }}
      >
        <Center gap={8}>
          {progress !== null ? (
            <Progress percent={progress} size={48} type="circle" />
          ) : (
            <Spin indicator={<LoadingOutlined spin />} />
          )}
          {progress === MAX_ESTIMATED_PROGRESS && (
            <ElapsedTime generationId={generation.id} isActive={isGenerating} />
          )}
        </Center>
      </Block>
    );
  },
);

VideoLoadingItem.displayName = 'VideoLoadingItem';

export default VideoLoadingItem;
