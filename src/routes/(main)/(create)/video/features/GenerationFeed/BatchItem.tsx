'use client';

import { ModelTag } from '@lobehub/icons';
import { ActionIconGroup, Block, Flexbox, Markdown, Tag, Text } from '@lobehub/ui';
import { App } from 'antd';
import { createStaticStyles } from 'antd-style';
import dayjs from 'dayjs';
import { CopyIcon, RotateCcwSquareIcon, Trash2 } from 'lucide-react';
import { type RuntimeVideoGenParamsKeys, type RuntimeVideoGenParamsValue } from 'model-bank';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import useRenderBusinessVideoBatchItem from '@/business/client/hooks/useRenderBusinessVideoBatchItem';
import { GenerationInvalidAPIKey } from '@/routes/(main)/(create)/features/GenerationInput';
import { useVideoStore } from '@/store/video';
import { AsyncTaskErrorType, AsyncTaskStatus } from '@/types/asyncTask';
import type { GenerationBatch } from '@/types/generation';
import { downloadFile } from '@/utils/client/downloadFile';

import VideoErrorItem from './VideoErrorItem';
import VideoLoadingItem from './VideoLoadingItem';
import VideoReferenceFrames from './VideoReferenceFrames';
import VideoSuccessItem from './VideoSuccessItem';

const styles = createStaticStyles(({ css, cssVar, cx }) => ({
  batchActions: cx(
    'batch-actions',
    css`
      opacity: 0;
      transition: opacity 0.1s ${cssVar.motionEaseInOut};
    `,
  ),
  container: css`
    &:hover {
      .batch-actions {
        opacity: 1;
      }
    }
  `,
}));

interface VideoGenerationBatchItemProps {
  batch: GenerationBatch;
}

export const VideoGenerationBatchItem = memo<VideoGenerationBatchItemProps>(({ batch }) => {
  const { message } = App.useApp();
  const { t } = useTranslation(['video', 'image']);
  const useCheckGenerationStatus = useVideoStore((s) => s.useCheckGenerationStatus);
  const removeGeneration = useVideoStore((s) => s.removeGeneration);
  const removeGenerationBatch = useVideoStore((s) => s.removeGenerationBatch);
  const setModelAndProviderOnSelect = useVideoStore((s) => s.setModelAndProviderOnSelect);
  const setParamOnInput = useVideoStore((s) => s.setParamOnInput);
  const activeTopicId = useVideoStore((s) => s.activeGenerationTopicId);
  const { shouldRenderBusinessBatchItem, businessBatchItem } =
    useRenderBusinessVideoBatchItem(batch);

  const time = useMemo(() => {
    return dayjs(batch.createdAt).format('YYYY-MM-DD HH:mm:ss');
  }, [batch.createdAt]);

  const generation = batch.generations[0];

  const isFinalized =
    generation?.task.status === AsyncTaskStatus.Success ||
    generation?.task.status === AsyncTaskStatus.Error;

  useCheckGenerationStatus(
    generation?.id ?? '',
    generation?.task.id ?? '',
    activeTopicId!,
    !isFinalized,
  );

  const handleDelete = useCallback(async () => {
    if (!generation?.id) return;

    try {
      await removeGeneration(generation.id);
    } catch (error) {
      console.error('Failed to delete generation:', error);
    }
  }, [removeGeneration, generation?.id]);

  const handleCopyPrompt = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(batch.prompt);
      message.success(t('generation.actions.promptCopied', { ns: 'image' }));
    } catch (error) {
      console.error('Failed to copy prompt:', error);
      message.error(t('generation.actions.promptCopyFailed', { ns: 'image' }));
    }
  }, [batch.prompt, message, t]);

  const handleReuseSettings = useCallback(() => {
    setModelAndProviderOnSelect(batch.model, batch.provider);

    if (!batch.config) return;

    for (const [paramName, value] of Object.entries(batch.config)) {
      if (value === undefined) continue;

      setParamOnInput(paramName as RuntimeVideoGenParamsKeys, value as RuntimeVideoGenParamsValue);
    }
  }, [batch.config, batch.model, batch.provider, setModelAndProviderOnSelect, setParamOnInput]);

  const handleDeleteBatch = useCallback(async () => {
    if (!activeTopicId) return;

    try {
      await removeGenerationBatch(batch.id, activeTopicId);
    } catch (error) {
      console.error('Failed to delete batch:', error);
    }
  }, [activeTopicId, batch.id, removeGenerationBatch]);

  const handleDownload = useCallback(async () => {
    if (!generation?.asset?.url) return;

    const timestamp = dayjs(generation.createdAt).format('YYYY-MM-DD_HH-mm-ss');
    const baseName = batch.prompt.slice(0, 30).trim();
    const sanitizedBaseName = baseName.replaceAll(/["%*/:<>?\\|]/g, '').replaceAll(/\s+/g, '_');
    const safePrompt = sanitizedBaseName || 'Untitled';
    const fileName = `${safePrompt}_${timestamp}.mp4`;

    try {
      await downloadFile(generation.asset.url, fileName, false);
    } catch (error) {
      console.error('Failed to download video:', error);
    }
  }, [generation?.asset?.url, generation?.createdAt, batch.prompt]);

  const handleCopyError = useCallback(async () => {
    if (!generation?.task.error) return;

    const errorMessage =
      typeof generation.task.error.body === 'string'
        ? generation.task.error.body
        : generation.task.error.body?.detail || generation.task.error.name || 'Unknown error';

    try {
      await navigator.clipboard.writeText(errorMessage);
      message.success(t('generation.actions.errorCopied'));
    } catch (error) {
      console.error('Failed to copy error message:', error);
      message.error(t('generation.actions.errorCopyFailed'));
    }
  }, [generation?.task.error, message, t]);

  const displayAspectRatio = useMemo(() => {
    const ratio = batch.config?.aspectRatio;
    if (ratio && ratio !== 'adaptive') return ratio;

    // Compute from video asset dimensions
    const asset = generation?.asset;
    if (asset && asset.width && asset.height && asset.width > 0 && asset.height > 0) {
      const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
      const d = gcd(asset.width, asset.height);
      return `${asset.width / d}:${asset.height / d}`;
    }
    return undefined;
  }, [batch.config?.aspectRatio, generation?.asset]);

  if (!generation) {
    return null;
  }

  if (shouldRenderBusinessBatchItem) {
    return businessBatchItem;
  }

  const isInvalidApiKey = generation.task.error?.name === AsyncTaskErrorType.InvalidProviderAPIKey;

  if (isInvalidApiKey) {
    return (
      <GenerationInvalidAPIKey
        provider={batch.provider}
        onNavigate={() => {
          if (!activeTopicId) return;
          removeGenerationBatch(batch.id, activeTopicId);
        }}
      />
    );
  }

  const renderContent = () => {
    if (generation.task.status === AsyncTaskStatus.Success && generation.asset?.url) {
      return (
        <VideoSuccessItem
          generation={generation}
          onDelete={handleDelete}
          onDownload={handleDownload}
        />
      );
    }

    if (generation.task.status === AsyncTaskStatus.Error) {
      return (
        <VideoErrorItem
          aspectRatio={displayAspectRatio}
          generation={generation}
          onCopyError={handleCopyError}
          onDelete={handleDelete}
        />
      );
    }

    return (
      <VideoLoadingItem
        aspectRatio={displayAspectRatio}
        avgLatencyMs={batch.avgLatencyMs}
        generation={generation}
      />
    );
  };

  const hasReferenceFrames = batch.config?.imageUrl || batch.config?.endImageUrl;

  return (
    <Block className={styles.container} gap={8} variant={'borderless'}>
      <Flexbox horizontal align={'flex-start'} gap={16}>
        {hasReferenceFrames && (
          <VideoReferenceFrames
            endImageUrl={batch.config?.endImageUrl}
            imageUrl={batch.config?.imageUrl}
          />
        )}
        <Markdown variant={'chat'}>{batch.prompt}</Markdown>
      </Flexbox>
      {renderContent()}
      <Flexbox horizontal gap={4} style={{ opacity: 0.66 }}>
        <ModelTag model={batch.model} variant={'borderless'} />
        {batch.config?.resolution && <Tag variant={'borderless'}>{batch.config.resolution}</Tag>}
      </Flexbox>
      <Flexbox
        horizontal
        align={'center'}
        className={styles.batchActions}
        justify={'space-between'}
      >
        <ActionIconGroup
          items={[
            {
              icon: RotateCcwSquareIcon,
              key: 'reuseSettings',
              label: t('generation.actions.reuseSettings', { ns: 'image' }),
              onClick: handleReuseSettings,
            },
            {
              icon: CopyIcon,
              key: 'copyPrompt',
              label: t('generation.actions.copyPrompt', { ns: 'image' }),
              onClick: handleCopyPrompt,
            },
            {
              danger: true,
              icon: Trash2,
              key: 'deleteBatch',
              label: t('generation.actions.deleteBatch', { ns: 'image' }),
              onClick: handleDeleteBatch,
            },
          ]}
        />
        <Text as={'time'} fontSize={12} type={'secondary'}>
          {time}
        </Text>
      </Flexbox>
    </Block>
  );
});

VideoGenerationBatchItem.displayName = 'VideoGenerationBatchItem';
