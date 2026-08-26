'use client';

import { useAutoAnimate } from '@formkit/auto-animate/react';
import { ModelIcon } from '@lobehub/icons';
import { ActionIconGroup, Block, Flexbox, Grid, Image, Markdown } from '@lobehub/ui';
import { Tag, Text, toast } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import dayjs from 'dayjs';
import { omit } from 'es-toolkit/compat';
import { CopyIcon, RotateCcwSquareIcon, Trash2 } from 'lucide-react';
import { type RuntimeImageGenParams } from 'model-bank';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import useRenderBusinessBatchItem from '@/business/client/hooks/useRenderBusinessBatchItem';
import { GenerationInvalidAPIKey } from '@/routes/(main)/(create)/features/GenerationInput';
import { aiProviderSelectors, useAiInfraStore } from '@/store/aiInfra';
import { useImageStore } from '@/store/image';
import { AsyncTaskErrorType } from '@/types/asyncTask';
import { type GenerationBatch } from '@/types/generation';

import { GenerationItem } from './GenerationItem';
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

interface GenerationBatchItemProps {
  batch: GenerationBatch;
}

export const GenerationBatchItem = memo<GenerationBatchItemProps>(({ batch }) => {
  const { t } = useTranslation('image');

  const [imageGridRef] = useAutoAnimate();

  const activeTopicId = useImageStore((s) => s.activeGenerationTopicId);
  const removeGenerationBatch = useImageStore((s) => s.removeGenerationBatch);
  const reuseSettings = useImageStore((s) => s.reuseSettings);
  const activeWorkspaceId = useActiveWorkspaceId();
  const { shouldRenderBusinessBatchItem, businessBatchItem } = useRenderBusinessBatchItem(batch);

  const enabledImageModelList = useAiInfraStore(aiProviderSelectors.enabledImageModelList);
  // Resolve the model's display name from the enabled model catalog, falling back
  // to the raw model id when the model is not found (e.g. removed/renamed models).
  const modelDisplayName = useMemo(() => {
    const provider = enabledImageModelList.find((p) => p.id === batch.provider);
    const model = provider?.children.find((m) => m.id === batch.model);
    return model?.displayName || batch.model;
  }, [enabledImageModelList, batch.provider, batch.model]);

  const creator = batch.creator;
  const showCreator = Boolean(activeWorkspaceId && creator?.id);
  const creatorName = creator?.fullName || creator?.username || '';

  const time = useMemo(() => {
    return dayjs(batch.createdAt).format('YYYY-MM-DD HH:mm:ss');
  }, [batch.createdAt]);

  const handleCopyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(batch.prompt);
      toast.success(t('generation.actions.promptCopied'));
    } catch (error) {
      console.error('Failed to copy prompt:', error);
      toast.error(t('generation.actions.promptCopyFailed'));
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

  if (shouldRenderBusinessBatchItem) {
    return businessBatchItem;
  }

  return (
    <Block className={styles.container} gap={8} variant="borderless">
      <Flexbox horizontal align={'flex-start'} gap={16}>
        <ReferenceImages imageUrl={batch.config?.imageUrl} imageUrls={batch.config?.imageUrls} />
        <Markdown variant={'chat'}>{batch.prompt}</Markdown>
      </Flexbox>
      <Image.PreviewGroup>
        <Grid maxItemWidth={200} ref={imageGridRef} rows={batch.generations.length}>
          {batch.generations.map((generation) => (
            <GenerationItem
              generation={generation}
              generationBatch={batch}
              key={generation.id}
              prompt={batch.prompt}
            />
          ))}
        </Grid>
      </Image.PreviewGroup>
      <Flexbox
        horizontal
        align={'center'}
        gap={4}
        justify={'space-between'}
        style={{ opacity: 0.66 }}
      >
        <Flexbox horizontal align={'center'} gap={4}>
          <Tag icon={<ModelIcon model={batch.model} />} variant={'borderless'}>
            {modelDisplayName}
          </Tag>
          {batch.width && batch.height && (
            <Tag variant={'borderless'}>
              {batch.width} × {batch.height}
            </Tag>
          )}
          <Tag variant={'borderless'}>
            {t('generation.metadata.count', { count: batch.generations.length })}
          </Tag>
        </Flexbox>
        <Flexbox horizontal align={'center'} gap={6}>
          {showCreator && (
            <>
              <Text fontSize={12} type={'secondary'}>
                {t('generation.metadata.by', { name: creatorName })}
              </Text>
              <Text fontSize={12} type={'secondary'}>
                ·
              </Text>
            </>
          )}
          <Text as={'time'} fontSize={12} type={'secondary'}>
            {t('generation.metadata.createdAt', { time })}
          </Text>
        </Flexbox>
      </Flexbox>
      <Flexbox horizontal align={'center'} className={styles.batchActions}>
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
