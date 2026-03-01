'use client';

import { useAutoAnimate } from '@formkit/auto-animate/react';
import { ModelTag } from '@lobehub/icons';
import { ActionIconGroup, Block, Flexbox, Grid, Markdown, Tag, Text } from '@lobehub/ui';
import { App } from 'antd';
import { createStaticStyles } from 'antd-style';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { omit } from 'es-toolkit/compat';
import { CopyIcon, RotateCcwSquareIcon, Trash2 } from 'lucide-react';
import { type RuntimeImageGenParams } from 'model-bank';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import useRenderBusinessBatchItem from '@/business/client/hooks/useRenderBusinessBatchItem';
import APIKeyForm from '@/components/InvalidAPIKey';
import { useImageStore } from '@/store/image';
import { AsyncTaskErrorType } from '@/types/asyncTask';
import { type GenerationBatch } from '@/types/generation';

import { GenerationItem } from './GenerationItem';
import { DEFAULT_MAX_ITEM_WIDTH } from './GenerationItem/utils';
import { ReferenceImages } from './ReferenceImages';

const styles = createStaticStyles(({ css, cssVar, cx }) => ({
  batchActions: cx(
    'batch-actions',
    css`
      opacity: 0;
      transition: opacity 0.1s ${cssVar.motionEaseInOut};
    `,
  ),
  batchDeleteButton: css`
    &:hover {
      border-color: ${cssVar.colorError} !important;
      color: ${cssVar.colorError} !important;
      background: ${cssVar.colorErrorBg} !important;
    }
  `,
  container: css`
    &:hover {
      .batch-actions {
        opacity: 1;
      }
    }
  `,

  prompt: css`
    pre {
      overflow: hidden !important;
      padding-block: 4px;
      font-size: 13px;
    }
  `,
}));

// 扩展 dayjs 插件
dayjs.extend(relativeTime);

interface GenerationBatchItemProps {
  batch: GenerationBatch;
}

export const GenerationBatchItem = memo<GenerationBatchItemProps>(({ batch }) => {
  const { t } = useTranslation(['image', 'modelProvider', 'error']);
  const { message } = App.useApp();

  const [imageGridRef] = useAutoAnimate();

  const activeTopicId = useImageStore((s) => s.activeGenerationTopicId);
  const removeGenerationBatch = useImageStore((s) => s.removeGenerationBatch);
  const recreateImage = useImageStore((s) => s.recreateImage);
  const reuseSettings = useImageStore((s) => s.reuseSettings);
  const { shouldRenderBusinessBatchItem, businessBatchItem } = useRenderBusinessBatchItem(batch);

  const time = useMemo(() => {
    return dayjs(batch.createdAt).format('YYYY-MM-DD HH:mm:ss');
  }, [batch.createdAt]);

  const handleCopyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(batch.prompt);
      message.success(t('generation.actions.promptCopied'));
    } catch (error) {
      console.error('Failed to copy prompt:', error);
      message.error(t('generation.actions.promptCopyFailed'));
    }
  };

  const handleReuseSettings = () => {
    reuseSettings(
      batch.model,
      batch.provider,
      omit(batch.config as RuntimeImageGenParams, ['seed']),
    );
  };

  const handleDeleteBatch = async () => {
    if (!activeTopicId) return;

    try {
      await removeGenerationBatch(batch.id, activeTopicId);
    } catch (error) {
      console.error('Failed to delete batch:', error);
    }
  };

  if (batch.generations.length === 0) {
    return null;
  }

  const isInvalidApiKey = batch.generations.some(
    (generation) => generation.task.error?.name === AsyncTaskErrorType.InvalidProviderAPIKey,
  );

  if (isInvalidApiKey) {
    // Use unified InvalidAPIKey component for all providers (including ComfyUI)
    return (
      <APIKeyForm
        bedrockDescription={t('bedrock.unlock.imageGenerationDescription', { ns: 'modelProvider' })}
        id={batch.id}
        provider={batch.provider}
        description={t('unlock.apiKey.imageGenerationDescription', {
          name: batch.provider,
          ns: 'error',
        })}
        onClose={() => {
          removeGenerationBatch(batch.id, activeTopicId!);
        }}
        onRecreate={() => {
          recreateImage(batch.id);
        }}
      />
    );
  }

  if (shouldRenderBusinessBatchItem) {
    return businessBatchItem;
  }

  // Calculate total number of reference images
  const referenceImageCount =
    (batch.config?.imageUrl ? 1 : 0) + (batch.config?.imageUrls?.length || 0);

  const isSingleImageLayout = referenceImageCount === 1;

  // Content for prompt and metadata
  const promptAndMetadata = (
    <>
      <Markdown variant={'chat'}>{batch.prompt}</Markdown>
      <Flexbox horizontal gap={4} justify="space-between" style={{ marginBottom: 10 }}>
        <Flexbox horizontal gap={4}>
          <ModelTag model={batch.model} />
          {batch.width && batch.height && (
            <Tag>
              {batch.width} × {batch.height}
            </Tag>
          )}
          <Tag>{t('generation.metadata.count', { count: batch.generations.length })}</Tag>
        </Flexbox>
      </Flexbox>
    </>
  );

  return (
    <Block className={styles.container} gap={8} variant="borderless">
      {isSingleImageLayout ? (
        // Single image layout: horizontal arrangement with vertical centering
        <Flexbox horizontal align="center" gap={16}>
          <ReferenceImages
            imageUrl={batch.config?.imageUrl}
            imageUrls={batch.config?.imageUrls}
            layout="single"
          />
          <Flexbox flex={1} gap={8}>
            {promptAndMetadata}
          </Flexbox>
        </Flexbox>
      ) : (
        // Multiple images or no images: vertical arrangement
        <>
          <ReferenceImages
            imageUrl={batch.config?.imageUrl}
            imageUrls={batch.config?.imageUrls}
            layout="multiple"
          />
          {promptAndMetadata}
        </>
      )}
      <Grid
        maxItemWidth={DEFAULT_MAX_ITEM_WIDTH}
        ref={imageGridRef}
        rows={batch.generations.length}
      >
        {batch.generations.map((generation) => (
          <GenerationItem
            generation={generation}
            generationBatch={batch}
            key={generation.id}
            prompt={batch.prompt}
          />
        ))}
      </Grid>
      <Flexbox
        horizontal
        align={'center'}
        className={styles.batchActions}
        justify={'space-between'}
      >
        <Text as={'time'} fontSize={12} type={'secondary'}>
          {time}
        </Text>
        <ActionIconGroup
          items={[
            {
              icon: RotateCcwSquareIcon,
              key: 'reuseSettings',
              label: t('generation.actions.reuseSettings'),
              onClick: handleReuseSettings,
            },
            {
              icon: CopyIcon,
              key: 'copyPrompt',
              label: t('generation.actions.copyPrompt'),
              onClick: handleCopyPrompt,
            },
            {
              danger: true,
              icon: Trash2,
              key: 'deleteBatch',
              label: t('generation.actions.deleteBatch'),
              onClick: handleDeleteBatch,
            },
          ]}
        />
      </Flexbox>
    </Block>
  );
});

GenerationBatchItem.displayName = 'GenerationBatchItem';
