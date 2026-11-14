'use client';

import { Block, Flexbox, Icon, Progress, Spin, Text } from '@lobehub/ui';
import { MusicIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { MAX_ESTIMATED_PROGRESS, useEstimatedProgress } from '@/hooks/useEstimatedProgress';
import { ElapsedTime } from '@/routes/(main)/(create)/image/features/GenerationFeed/GenerationItem/ElapsedTime';
import { AsyncTaskStatus } from '@/types/asyncTask';
import type { Generation } from '@/types/generation';

/** Music models usually finish a song in one to three minutes */
const DEFAULT_AVG_LATENCY_MS = 120_000;

const getSessionStorageKey = (generationId: string) => `generation_start_time_${generationId}`;

interface MusicLoadingItemProps {
  avgLatencyMs?: number | null;
  generation: Generation;
}

const MusicLoadingItem = memo<MusicLoadingItemProps>(({ generation, avgLatencyMs }) => {
  const { t } = useTranslation('music');
  const latency = avgLatencyMs && avgLatencyMs > 0 ? avgLatencyMs : DEFAULT_AVG_LATENCY_MS;
  const status = generation.task.status;
  const isGenerating = status === AsyncTaskStatus.Processing || status === AsyncTaskStatus.Pending;

  const progress = useEstimatedProgress({
    durationMs: latency,
    enabled: isGenerating,
    storageKey: getSessionStorageKey(generation.id),
  });

  return (
    <Block
      horizontal
      align={'center'}
      data-music-status={status}
      gap={12}
      padding={12}
      variant={'filled'}
    >
      <Flexbox align={'center'} justify={'center'} style={{ flex: 'none', height: 48, width: 48 }}>
        {progress === null ? <Spin /> : <Progress percent={progress} size={44} type="circle" />}
      </Flexbox>
      <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
        <Flexbox horizontal align={'center'} gap={6}>
          <Icon icon={MusicIcon} size={14} />
          <Text strong>
            {status === AsyncTaskStatus.Pending
              ? t('generation.status.queued')
              : t('generation.status.generating')}
          </Text>
        </Flexbox>
        <Flexbox horizontal align={'center'} gap={6}>
          <Text fontSize={12} type={'secondary'}>
            {t('generation.status.generatingHint')}
          </Text>
          {progress === MAX_ESTIMATED_PROGRESS && (
            <ElapsedTime generationId={generation.id} isActive={isGenerating} />
          )}
        </Flexbox>
      </Flexbox>
    </Block>
  );
});

MusicLoadingItem.displayName = 'MusicLoadingItem';

export default MusicLoadingItem;
