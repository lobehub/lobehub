'use client';

import { Flexbox } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { Progress } from 'antd';
import { cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import { MAX_ESTIMATED_PROGRESS, useEstimatedProgress } from '@/hooks/useEstimatedProgress';

import { formatDuration } from '../utils/formatDuration';

const STORAGE_KEY_PREFIX = 'video-generation-progress';

export const getGenerationProgressStorageKey = (toolCallId?: string) =>
  toolCallId ? `${STORAGE_KEY_PREFIX}:${toolCallId}` : undefined;

export const clearGenerationProgressStart = (toolCallId?: string) => {
  const storageKey = getGenerationProgressStorageKey(toolCallId);
  if (storageKey) sessionStorage.removeItem(storageKey);
};

interface GenerationProgressProps {
  estimatedDurationMs?: number;
  toolCallId?: string;
}

export const GenerationProgress = memo<GenerationProgressProps>(
  ({ estimatedDurationMs, toolCallId }) => {
    const { t } = useTranslation('plugin');
    // Keyed by tool call so the estimate survives remounts and refreshes of the chat message.
    const progress = useEstimatedProgress({
      durationMs: estimatedDurationMs,
      storageKey: getGenerationProgressStorageKey(toolCallId),
    });

    return (
      <Flexbox align={'center'} gap={8}>
        {progress === null ? (
          <NeuralNetworkLoading size={48} />
        ) : (
          <Progress percent={progress} size={56} type={'circle'} />
        )}
        <Text as={'span'} color={cssVar.colorTextSecondary} fontSize={12}>
          {progress === MAX_ESTIMATED_PROGRESS
            ? t('builtins.lobe-video-generation.render.progress.longer')
            : t('builtins.lobe-video-generation.render.progress.generating')}
        </Text>
        {estimatedDurationMs && (
          <Text as={'span'} color={cssVar.colorTextSecondary} fontSize={12}>
            {t('builtins.lobe-video-generation.render.averageDuration', {
              duration: formatDuration(estimatedDurationMs),
            })}
          </Text>
        )}
      </Flexbox>
    );
  },
);

GenerationProgress.displayName = 'GenerationProgress';
