'use client';

import { ModelTag } from '@lobehub/icons';
import { Block, Flexbox, Markdown, Tag, Text } from '@lobehub/ui';
import { App } from 'antd';
import dayjs from 'dayjs';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import useRenderBusinessVideoBatchItem from '@/business/client/hooks/useRenderBusinessVideoBatchItem';
import { useVideoStore } from '@/store/video';
import { AsyncTaskStatus } from '@/types/asyncTask';
import type { GenerationBatch } from '@/types/generation';
import { downloadFile } from '@/utils/client/downloadFile';

import VideoErrorItem from './VideoErrorItem';
import VideoLoadingItem from './VideoLoadingItem';
import VideoReferenceFrames from './VideoReferenceFrames';
import VideoSuccessItem from './VideoSuccessItem';

interface VideoGenerationBatchItemProps {
  batch: GenerationBatch;
}

export const VideoGenerationBatchItem = memo<VideoGenerationBatchItemProps>(({ batch }) => {
  const { message } = App.useApp();
  const { t } = useTranslation('video');
  const useCheckGenerationStatus = useVideoStore((s) => s.useCheckGenerationStatus);
  const removeGeneration = useVideoStore((s) => s.removeGeneration);
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
    if (!generation) return;
    try {
      await removeGeneration(generation.id);
    } catch (error) {
      console.error('Failed to delete generation:', error);
    }
  }, [removeGeneration, generation?.id]);

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
          aspectRatio={batch.config?.aspectRatio}
          generation={generation}
          onCopyError={handleCopyError}
          onDelete={handleDelete}
        />
      );
    }

    return <VideoLoadingItem aspectRatio={batch.config?.aspectRatio} generation={generation} />;
  };

  const hasReferenceFrames = batch.config?.imageUrl || batch.config?.endImageUrl;

  const promptAndMetadata = (
    <>
      <Markdown variant={'chat'}>{batch.prompt}</Markdown>
      <Flexbox gap={4} horizontal style={{ marginBottom: 10 }}>
        <ModelTag model={batch.model} />
        {batch.config?.resolution && <Tag>{batch.config.resolution}</Tag>}
        {displayAspectRatio && <Tag>{displayAspectRatio}</Tag>}
      </Flexbox>
    </>
  );

  return (
    <Block gap={8} variant={'borderless'}>
      {hasReferenceFrames ? (
        <Flexbox align={'center'} gap={16} horizontal>
          <VideoReferenceFrames
            endImageUrl={batch.config?.endImageUrl}
            imageUrl={batch.config?.imageUrl}
          />
          <Flexbox flex={1} gap={8}>
            {promptAndMetadata}
          </Flexbox>
        </Flexbox>
      ) : (
        promptAndMetadata
      )}
      {renderContent()}
      <Text as={'time'} fontSize={12} type={'secondary'}>
        {time}
      </Text>
    </Block>
  );
});

VideoGenerationBatchItem.displayName = 'VideoGenerationBatchItem';
