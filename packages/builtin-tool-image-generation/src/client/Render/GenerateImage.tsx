'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { PreviewGroup } from '@lobehub/ui';
import { Alert, Button, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { downloadPreviewImage } from '@/features/Conversation/Messages/components/downloadPreviewImage';
import { normalizeAsyncError } from '@/libs/swr/normalizeError';

import type { GeneratedImageTask, GenerateImageParams, GenerateImageState } from '../../types';
import { resolveAspectRatio } from '../components/aspectRatio';
import { peekGenerationClock } from '../components/generationClock';
import ImageCanvas from '../components/ImageCanvas';
import ImageCanvasGrid from '../components/ImageCanvasGrid';
import {
  getStateAssetUrl,
  getStateErrorDetail,
  getTaskAssetUrl,
  getTaskErrorDetail,
  isTerminalStatus,
  useGenerationStatus,
} from '../components/useGenerationStatus';

const styles = createStaticStyles(({ css, cssVar }) => ({
  caption: css`
    overflow: hidden;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: ${cssVar.colorTextQuaternary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  root: css`
    display: flex;
    flex-direction: column;
    gap: 8px;
  `,
}));

const GenerationTile = memo<{
  index: number;
  parameters?: Record<string, unknown>;
  /**
   * Shared footprint for multi-image grids. Omitted for a lone image, which
   * takes the real ratio of its own asset once it lands.
   */
  ratio?: number;
  startedAt?: number;
  task: GeneratedImageTask;
}>(({ index, parameters, ratio: sharedRatio, startedAt, task }) => {
  const { t } = useTranslation('plugin');
  const shouldFetchStatus = !isTerminalStatus(task.status);
  const { data, error, isLoading, isValidating, retry } = useGenerationStatus(
    {
      asyncTaskId: task.asyncTaskId,
      generationId: task.generationId,
    },
    shouldFetchStatus,
  );

  const status =
    (error ? 'error' : undefined) ||
    data?.status ||
    task.status ||
    (isLoading ? 'processing' : 'pending');
  const url = getTaskAssetUrl(task) || getStateAssetUrl(data);
  const errorDetail =
    error instanceof Error ? error.message : getTaskErrorDetail(task) || getStateErrorDetail(data);
  const canRetry = Boolean(error) && normalizeAsyncError(error).retryable;
  const ratio =
    sharedRatio ?? resolveAspectRatio(parameters, task.asset ?? data?.generation?.asset);

  return (
    <ImageCanvas
      alt={t('builtins.lobe-image-generation.render.imageAlt', { index: index + 1 })}
      badge={t(`builtins.lobe-image-generation.render.status.${status}`)}
      ratio={ratio}
      seed={index}
      startedAt={startedAt}
      url={url}
      onDownload={downloadPreviewImage}
    >
      {status === 'error' && !url && (
        <>
          <Text as={'span'} color={cssVar.colorError} fontSize={12}>
            {errorDetail || t('builtins.lobe-image-generation.render.status.error')}
          </Text>
          {canRetry && (
            <Button loading={isValidating} size={'small'} onClick={retry}>
              {t('builtins.lobe-image-generation.render.retry')}
            </Button>
          )}
        </>
      )}
    </ImageCanvas>
  );
});

GenerationTile.displayName = 'GenerationTile';

export const GenerateImageRender = memo<
  BuiltinRenderProps<GenerateImageParams, GenerateImageState>
>(({ args, pluginError, pluginState, toolCallId }) => {
  const { t } = useTranslation('plugin');
  const generations = pluginState?.generations ?? [];

  if (pluginError && generations.length === 0) {
    return (
      <Alert
        showIcon
        description={pluginError.message}
        title={t('builtins.lobe-image-generation.render.generationFailed')}
        type={'error'}
      />
    );
  }

  if (generations.length === 0) return null;

  const provider = pluginState?.provider || args?.provider;
  const model = pluginState?.model || args?.model;
  const parameters = args?.parameters;
  // Canvases in a grid share one footprint so a finished image never resizes
  // its cell out of line with the ones still generating.
  const gridRatio = resolveAspectRatio(parameters, generations[0]?.asset);
  const isGrid = generations.length > 1;

  return (
    <div className={styles.root}>
      <PreviewGroup preview={{ onDownload: downloadPreviewImage }}>
        <ImageCanvasGrid count={generations.length} ratio={gridRatio}>
          {generations.map((task, index) => (
            <GenerationTile
              index={index}
              key={`${task.generationId}-${task.asyncTaskId}`}
              parameters={parameters}
              ratio={isGrid ? gridRatio : undefined}
              startedAt={peekGenerationClock(toolCallId)}
              task={task}
            />
          ))}
        </ImageCanvasGrid>
      </PreviewGroup>
      {model && <div className={styles.caption}>{[provider, model].filter(Boolean).join('/')}</div>}
    </div>
  );
});

GenerateImageRender.displayName = 'GenerateImageRender';

export default GenerateImageRender;
