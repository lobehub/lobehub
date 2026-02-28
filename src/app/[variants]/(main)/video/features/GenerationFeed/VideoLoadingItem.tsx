'use client';

import { LoadingOutlined } from '@ant-design/icons';
import { Block, Center } from '@lobehub/ui';
import { Progress, Spin } from 'antd';
import { memo, useEffect, useState } from 'react';

import { ElapsedTime } from '@/app/[variants]/(main)/image/features/GenerationFeed/GenerationItem/ElapsedTime';
import { AsyncTaskStatus } from '@/types/asyncTask';
import type { Generation } from '@/types/generation';

const DEFAULT_AVG_LATENCY_MS = 180_000;

const getSessionStorageKey = (generationId: string) => `generation_start_time_${generationId}`;

const useEstimatedProgress = (generationId: string, avgLatencyMs: number, isActive: boolean) => {
  const [progress, setProgress] = useState<number | null>(null);

  useEffect(() => {
    if (!isActive) {
      setProgress(null);
      return;
    }

    const storageKey = getSessionStorageKey(generationId);
    const startTime = (() => {
      const stored = sessionStorage.getItem(storageKey);
      if (stored) return Number(stored);

      const now = Date.now();
      sessionStorage.setItem(storageKey, now.toString());
      return now;
    })();

    const update = () => {
      const elapsed = Date.now() - startTime;
      const pct = Math.min(Math.round((elapsed / avgLatencyMs) * 100), 99);
      setProgress(pct);
    };

    update();
    const timer = setInterval(update, 1000);

    return () => clearInterval(timer);
  }, [isActive, avgLatencyMs, generationId]);

  return progress;
};

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

    const progress = useEstimatedProgress(generation.id, latency, isGenerating);

    return (
      <Block
        align={'center'}
        justify={'center'}
        variant={'filled'}
        style={{
          aspectRatio: aspectRatio?.includes(':') ? aspectRatio.replace(':', '/') : '16/9',
        }}
      >
        <Center gap={8}>
          {progress !== null ? (
            <Progress percent={progress} size={48} type="circle" />
          ) : (
            <Spin indicator={<LoadingOutlined spin />} />
          )}
          {progress === 99 && <ElapsedTime generationId={generation.id} isActive={isGenerating} />}
        </Center>
      </Block>
    );
  },
);

VideoLoadingItem.displayName = 'VideoLoadingItem';

export default VideoLoadingItem;
