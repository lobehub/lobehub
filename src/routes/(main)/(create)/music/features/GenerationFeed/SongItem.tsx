'use client';

import { toast } from '@lobehub/ui';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useMusicStore } from '@/store/music';
import { createMusicSelectors } from '@/store/music/selectors';
import { AsyncTaskStatus } from '@/types/asyncTask';
import type { Generation, GenerationBatch } from '@/types/generation';

import MusicErrorItem from './MusicErrorItem';
import MusicLoadingItem from './MusicLoadingItem';
import MusicTrackItem from './MusicTrackItem';
import { getMusicAsset, getSongFileName } from './utils';

interface SongItemProps {
  batch: GenerationBatch;
  generation: Generation;
  index: number;
  topicId: string;
}

/** One song of a batch: polls its task until it settles, then shows the player or the error */
const SongItem = memo<SongItemProps>(({ batch, generation, index, topicId }) => {
  const { t } = useTranslation('music');
  const useCheckGenerationStatus = useMusicStore((s) => s.useCheckGenerationStatus);
  const removeGeneration = useMusicStore((s) => s.removeGeneration);
  const recreateMusic = useMusicStore((s) => s.recreateMusic);
  const isRetrying = useMusicStore(createMusicSelectors.isRetryingBatch(batch.id));

  const status = generation.task.status;
  const isFinalized = status === AsyncTaskStatus.Success || status === AsyncTaskStatus.Error;

  useCheckGenerationStatus(generation.id, generation.task.id ?? '', topicId, !isFinalized);

  const handleDelete = useCallback(async () => {
    try {
      await removeGeneration(generation.id);
    } catch (error) {
      console.error('Failed to delete song:', error);
    }
  }, [generation.id, removeGeneration]);

  const handleRetry = useCallback(async () => {
    try {
      await recreateMusic(batch.id);
    } catch (error) {
      console.error('Failed to retry music generation:', error);
      toast.error(t('generation.actions.retryFailed'));
    }
  }, [batch.id, recreateMusic, t]);

  const handleCopyError = useCallback(async () => {
    const error = generation.task.error;
    if (!error) return;

    const message =
      typeof error.body === 'string' ? error.body : error.body?.detail || error.name || '';
    try {
      await navigator.clipboard.writeText(message);
      toast.success(t('generation.actions.errorCopied'));
    } catch {
      toast.error(t('generation.actions.errorCopyFailed'));
    }
  }, [generation.task.error, t]);

  const asset = getMusicAsset(generation);

  if (status === AsyncTaskStatus.Success && asset?.url) {
    const config = batch.config as { title?: string | null } | undefined;
    const title =
      asset.title || config?.title || t('generation.song.untitled', { index: String(index + 1) });

    return (
      <MusicTrackItem
        asset={asset}
        generationId={generation.id}
        title={title}
        downloadFileName={getSongFileName({
          asset,
          batch,
          fallback: t('generation.song.fileName'),
          index,
        })}
        onDelete={handleDelete}
      />
    );
  }

  if (status === AsyncTaskStatus.Error) {
    return (
      <MusicErrorItem
        generation={generation}
        isRetrying={isRetrying}
        provider={batch.provider}
        onCopyError={handleCopyError}
        onDelete={handleDelete}
        onRetry={handleRetry}
      />
    );
  }

  return <MusicLoadingItem avgLatencyMs={batch.avgLatencyMs} generation={generation} />;
});

SongItem.displayName = 'MusicSongItem';

export default SongItem;
