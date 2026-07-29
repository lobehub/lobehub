'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { Progress } from 'antd';
import { cssVar } from 'antd-style';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';

import { formatDuration } from '../utils/formatDuration';

const MAX_ESTIMATED_PROGRESS = 99;
const PROGRESS_UPDATE_INTERVAL_MS = 1000;
const STORAGE_KEY_PREFIX = 'video-generation-progress';

export const getGenerationProgressStorageKey = (toolCallId?: string) =>
  toolCallId ? `${STORAGE_KEY_PREFIX}:${toolCallId}` : undefined;

export const clearGenerationProgressStart = (toolCallId?: string) => {
  const storageKey = getGenerationProgressStorageKey(toolCallId);
  if (storageKey) sessionStorage.removeItem(storageKey);
};

const useEstimatedProgress = (estimatedDurationMs?: number, toolCallId?: string) => {
  const [progress, setProgress] = useState<null | number>(null);

  useEffect(() => {
    if (!estimatedDurationMs || estimatedDurationMs <= 0) {
      setProgress(null);
      return;
    }

    const storageKey = getGenerationProgressStorageKey(toolCallId);
    const storedValue = storageKey ? sessionStorage.getItem(storageKey) : null;
    const storedStart = storedValue ? Number(storedValue) : Number.NaN;
    const startedAt = Number.isFinite(storedStart) && storedStart > 0 ? storedStart : Date.now();

    if (storageKey && (!Number.isFinite(storedStart) || storedStart <= 0)) {
      sessionStorage.setItem(storageKey, String(startedAt));
    }

    const updateProgress = () => {
      const elapsedMs = Date.now() - startedAt;
      setProgress(
        Math.min(MAX_ESTIMATED_PROGRESS, Math.round((elapsedMs / estimatedDurationMs) * 100)),
      );
    };

    updateProgress();
    const timer = window.setInterval(updateProgress, PROGRESS_UPDATE_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [estimatedDurationMs, toolCallId]);

  return progress;
};

interface GenerationProgressProps {
  estimatedDurationMs?: number;
  toolCallId?: string;
}

export const GenerationProgress = memo<GenerationProgressProps>(
  ({ estimatedDurationMs, toolCallId }) => {
    const { t } = useTranslation('plugin');
    const progress = useEstimatedProgress(estimatedDurationMs, toolCallId);

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
