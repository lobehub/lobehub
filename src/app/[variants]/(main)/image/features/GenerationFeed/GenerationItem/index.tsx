'use client';

import { App } from 'antd';
import dayjs from 'dayjs';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useDownloadImage } from '@/hooks/useDownloadImage';
import { useImageStore } from '@/store/image';
import { imageGenerationConfigSelectors } from '@/store/image/selectors';
import { AsyncTaskStatus } from '@/types/asyncTask';
import { inferFileExtensionFromImageUrl } from '@/utils/url';

import { ErrorState } from './ErrorState';
import { LoadingState } from './LoadingState';
import { SuccessState } from './SuccessState';
import { type GenerationItemProps } from './types';
import { getAspectRatio } from './utils';

const isSupportedParamSelector = imageGenerationConfigSelectors.isSupportedParam;

export const GenerationItem = memo<GenerationItemProps>(
  ({ generationBatch, generation, prompt }) => {
    const { message } = App.useApp();
    const { t } = useTranslation('image');
    const useCheckGenerationStatus = useImageStore((s) => s.useCheckGenerationStatus);
    const deleteGeneration = useImageStore((s) => s.removeGeneration);
    const reuseSeed = useImageStore((s) => s.reuseSeed);
    const activeTopicId = useImageStore((s) => s.activeGenerationTopicId);
    const isSupportSeed = useImageStore(isSupportedParamSelector('seed'));
    const { downloadImage } = useDownloadImage();

    const isFinalized =
      generation.task.status === AsyncTaskStatus.Success ||
      generation.task.status === AsyncTaskStatus.Error;

    const shouldPoll = !isFinalized;
    useCheckGenerationStatus(generation.id, generation.task.id, activeTopicId!, shouldPoll);

    const aspectRatio = getAspectRatio(generation, generationBatch);

    // 事件处理函数
    const handleDeleteGeneration = useCallback(async () => {
      try {
        await deleteGeneration(generation.id);
      } catch (error) {
        console.error('Failed to delete generation:', error);
      }
    }, [deleteGeneration, generation.id]);

    const handleDownloadImage = useCallback(async () => {
      if (!generation.asset?.url) return;

      // Generate filename with prompt and timestamp
      const timestamp = dayjs(generation.createdAt).format('YYYY-MM-DD_HH-mm-ss');
      const baseName = prompt.slice(0, 30).trim();
      const sanitizedBaseName = baseName.replaceAll(/["%*/:<>?\\|]/g, '').replaceAll(/\s+/g, '_');
      const safePrompt = sanitizedBaseName || 'Untitled';

      const fileExtension = inferFileExtensionFromImageUrl(generation.asset.url);
      const fileName = `${safePrompt}_${timestamp}.${fileExtension}`;

      await downloadImage(generation.asset.url, fileName);
    }, [downloadImage, generation.asset?.url, generation.createdAt, prompt]);

    const handleCopySeed = useCallback(async () => {
      if (!generation.seed) return;

      // If current model supports seed parameter, apply it directly to configuration
      if (isSupportSeed) {
        try {
          reuseSeed(generation.seed);
          message.success(t('generation.actions.seedApplied'));
        } catch (error) {
          console.error('Failed to apply seed:', error);
          message.error(t('generation.actions.seedApplyFailed'));
        }
      } else {
        // If current model doesn't support seed parameter, copy to clipboard
        try {
          await navigator.clipboard.writeText(generation.seed.toString());
          message.success(t('generation.actions.seedCopied'));
        } catch (error) {
          console.error('Failed to copy seed:', error);
          message.error(t('generation.actions.seedCopyFailed'));
        }
      }
    }, [generation.seed, isSupportSeed, message, t, reuseSeed]);

    const handleCopyError = useCallback(async () => {
      if (!generation.task.error) return;

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
    }, [generation.task.error, message, t]);

    // 根据状态渲染对应组件
    if (generation.task.status === AsyncTaskStatus.Success && generation.asset?.url) {
      const seedTooltip = isSupportSeed
        ? t('generation.actions.applySeed')
        : t('generation.actions.copySeed');

      return (
        <SuccessState
          aspectRatio={aspectRatio}
          generation={generation}
          generationBatch={generationBatch}
          prompt={prompt}
          seedTooltip={seedTooltip}
          onCopySeed={handleCopySeed}
          onDelete={handleDeleteGeneration}
          onDownload={handleDownloadImage}
        />
      );
    }

    if (generation.task.status === AsyncTaskStatus.Error) {
      return (
        <ErrorState
          aspectRatio={aspectRatio}
          generation={generation}
          generationBatch={generationBatch}
          onCopyError={handleCopyError}
          onDelete={handleDeleteGeneration}
        />
      );
    }

    // Loading state (Processing 或 Pending)
    return (
      <LoadingState
        aspectRatio={aspectRatio}
        generation={generation}
        generationBatch={generationBatch}
        onDelete={handleDeleteGeneration}
      />
    );
  },
);

GenerationItem.displayName = 'GenerationItem';
