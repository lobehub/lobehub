'use client';

import { ActionIconGroup, Block, Flexbox, Markdown, Tag, Text, toast } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import dayjs from 'dayjs';
import { CopyIcon, RotateCcwSquareIcon, Trash2 } from 'lucide-react';
import { type RuntimeMusicGenParams } from 'model-bank';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { ModelIcon } from '@/components/LobeIcons';
import { aiProviderSelectors, useAiInfraStore } from '@/store/aiInfra';
import { useMusicStore } from '@/store/music';
import type { GenerationBatch } from '@/types/generation';

import SongItem from './SongItem';

const HOVER = '@media (hover: hover)';

const styles = stylex.create({
  // Pointer devices reveal batch actions on hover or focus; touch devices always show them
  batchActions: {
    opacity: {
      default: 1,
      [HOVER]: {
        default: 0,
        [stylex.when.ancestor(':hover')]: 1,
        [stylex.when.ancestor(':focus-within')]: 1,
      },
    },
    transitionDuration: '0.1s',
    transitionProperty: 'opacity',
    transitionTimingFunction: cssVar.motionEaseInOut,
  },
});

interface MusicBatchConfig {
  instrumental?: boolean;
  style?: string | null;
  title?: string | null;
}

interface MusicGenerationBatchItemProps {
  batch: GenerationBatch;
}

export const MusicGenerationBatchItem = memo<MusicGenerationBatchItemProps>(({ batch }) => {
  const { t } = useTranslation(['music', 'image']);
  const removeGenerationBatch = useMusicStore((s) => s.removeGenerationBatch);
  const reuseMusicSettings = useMusicStore((s) => s.reuseMusicSettings);
  const activeTopicId = useMusicStore((s) => s.activeGenerationTopicId);
  const activeWorkspaceId = useActiveWorkspaceId();
  const enabledMusicModelList = useAiInfraStore(aiProviderSelectors.enabledMusicModelList);

  const modelDisplayName = useMemo(() => {
    const provider = enabledMusicModelList.find((p) => p.id === batch.provider);
    const model = provider?.children.find((m) => m.id === batch.model);
    return model?.displayName || batch.model;
  }, [enabledMusicModelList, batch.provider, batch.model]);

  const config = (batch.config ?? {}) as MusicBatchConfig;
  const creator = batch.creator;
  const showCreator = Boolean(activeWorkspaceId && creator?.id);
  const creatorName = creator?.fullName || creator?.username || '';
  const time = useMemo(
    () => dayjs(batch.createdAt).format('YYYY-MM-DD HH:mm:ss'),
    [batch.createdAt],
  );

  const handleCopyPrompt = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(batch.prompt);
      toast.success(t('generation.actions.promptCopied', { ns: 'image' }));
    } catch {
      toast.error(t('generation.actions.promptCopyFailed', { ns: 'image' }));
    }
  }, [batch.prompt, t]);

  const handleReuseSettings = useCallback(() => {
    reuseMusicSettings(
      batch.model,
      batch.provider,
      batch.config as unknown as RuntimeMusicGenParams,
    );
  }, [batch.config, batch.model, batch.provider, reuseMusicSettings]);

  const handleDeleteBatch = useCallback(async () => {
    if (!activeTopicId) return;

    try {
      await removeGenerationBatch(batch.id, activeTopicId);
    } catch (error) {
      console.error('Failed to delete batch:', error);
    }
  }, [activeTopicId, batch.id, removeGenerationBatch]);

  if (batch.generations.length === 0 || !activeTopicId) return null;

  return (
    <Block
      className={stylex.props(stylex.defaultMarker()).className}
      data-music-batch-id={batch.id}
      gap={8}
      variant={'borderless'}
    >
      {batch.prompt && <Markdown variant={'chat'}>{batch.prompt}</Markdown>}
      <Flexbox gap={8}>
        {batch.generations.map((generation, index) => (
          <SongItem
            batch={batch}
            generation={generation}
            index={index}
            key={generation.id}
            topicId={activeTopicId}
          />
        ))}
      </Flexbox>
      <Flexbox horizontal align={'center'} gap={4} justify={'space-between'} wrap={'wrap'}>
        <Flexbox horizontal align={'center'} gap={4} style={{ opacity: 0.66 }} wrap={'wrap'}>
          <Tag icon={<ModelIcon model={batch.model} />} variant={'borderless'}>
            {modelDisplayName}
          </Tag>
          {config.instrumental && (
            <Tag variant={'borderless'}>{t('generation.metadata.instrumental')}</Tag>
          )}
          {config.style && (
            <Tag style={{ maxWidth: 280 }} title={config.style} variant={'borderless'}>
              <Text ellipsis fontSize={12}>
                {config.style}
              </Text>
            </Tag>
          )}
        </Flexbox>
        <Flexbox horizontal align={'center'} gap={6} style={{ opacity: 0.66 }}>
          {showCreator && (
            <>
              <Text fontSize={12} type={'secondary'}>
                {t('generation.metadata.by', { name: creatorName, ns: 'image' })}
              </Text>
              <Text fontSize={12} type={'secondary'}>
                ·
              </Text>
            </>
          )}
          <Text as={'time'} fontSize={12} type={'secondary'}>
            {t('generation.metadata.createdAt', { ns: 'image', time })}
          </Text>
        </Flexbox>
      </Flexbox>
      <Flexbox horizontal align={'center'} className={stylex.props(styles.batchActions).className}>
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
      </Flexbox>
    </Block>
  );
});

MusicGenerationBatchItem.displayName = 'MusicGenerationBatchItem';
