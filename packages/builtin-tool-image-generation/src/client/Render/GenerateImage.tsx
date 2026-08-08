'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Alert, Block, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useClientDataSWR } from '@/libs/swr';
import { imageKeys } from '@/libs/swr/keys';
import { normalizeAsyncError } from '@/libs/swr/normalizeError';
import { generationService } from '@/services/generation';

import type {
  GeneratedImageTask,
  GenerateImageParams,
  GenerateImageState,
  GetImageGenerationStatusParams,
  GetImageGenerationStatusState,
} from '../../types';

const POLLING_INTERVAL = 3000;

const styles = createStaticStyles(({ css, cssVar }) => ({
  error: css`
    color: ${cssVar.colorError};
  `,
  grid: css`
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(132px, 1fr));
    gap: 10px;
    padding: 12px;
  `,
  header: css`
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: space-between;

    min-width: 0;
    padding-block: 8px;
    padding-inline: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  image: css`
    width: 100%;
    height: 100%;
    object-fit: cover;
  `,
  meta: css`
    overflow: hidden;
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;

    min-width: 0;
  `,
  model: css`
    overflow: hidden;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  prompt: css`
    overflow: hidden;

    font-size: 13px;
    font-weight: 500;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  status: css`
    flex-shrink: 0;

    padding-block: 2px;
    padding-inline: 8px;
    border-radius: 999px;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillTertiary};
  `,
  tile: css`
    overflow: hidden;

    aspect-ratio: 1;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 8px;

    background: ${cssVar.colorFillTertiary};
  `,
  tileBody: css`
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: center;
    justify-content: center;

    width: 100%;
    height: 100%;
    padding: 12px;

    text-align: center;
  `,
}));

const isTerminalStatus = (status?: string) => status === 'success' || status === 'error';

const getAssetUrl = (state?: GetImageGenerationStatusState) => {
  const asset = state?.generation?.asset;
  return asset?.url || asset?.thumbnailUrl || asset?.originalUrl;
};

const getTaskAssetUrl = (task: GeneratedImageTask) =>
  task.asset?.url || task.asset?.thumbnailUrl || task.asset?.originalUrl;

const getErrorDetail = (state?: GetImageGenerationStatusState) => {
  const error = state?.error;
  if (!error) return;
  const body = error.body;
  if (typeof body === 'string') return body;
  return body.detail;
};

const getTaskErrorDetail = (task: GeneratedImageTask) => {
  const error = task.error;
  if (!error) return;
  const body = error.body;
  if (typeof body === 'string') return body;
  return body.detail;
};

const useGenerationStatus = (params: GetImageGenerationStatusParams, enabled: boolean) => {
  const [pollingStopped, setPollingStopped] = useState(false);

  useEffect(() => {
    setPollingStopped(false);
  }, [params.asyncTaskId, params.generationId]);

  const result = useClientDataSWR<GetImageGenerationStatusState>(
    enabled && params.asyncTaskId
      ? imageKeys.generationStatus(params.generationId, params.asyncTaskId)
      : null,
    async () => {
      const result = await generationService.getGenerationStatus(
        params.generationId,
        params.asyncTaskId,
      );
      return {
        ...result,
        asyncTaskId: params.asyncTaskId,
        generationId: params.generationId,
      };
    },
    {
      onError: () => setPollingStopped(true),
      onSuccess: () => setPollingStopped(false),
      refreshInterval: (data?: GetImageGenerationStatusState) =>
        pollingStopped || isTerminalStatus(data?.status) ? 0 : POLLING_INTERVAL,
      shouldRetryOnError: false,
    },
  );

  const { mutate } = result;
  const retry = useCallback(() => {
    setPollingStopped(false);
    void mutate();
  }, [mutate]);

  return { ...result, retry };
};

const GenerationTile = memo<{ index: number; task: GeneratedImageTask }>(({ index, task }) => {
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
  const url = getTaskAssetUrl(task) || getAssetUrl(data);
  const errorDetail =
    error instanceof Error ? error.message : getTaskErrorDetail(task) || getErrorDetail(data);
  const canRetry = Boolean(error) && normalizeAsyncError(error).retryable;

  return (
    <div className={styles.tile}>
      {url ? (
        <img
          alt={t('builtins.lobe-image-generation.render.imageAlt', { index: index + 1 })}
          className={styles.image}
          src={url}
        />
      ) : (
        <div className={styles.tileBody}>
          <Text
            as={'span'}
            className={status === 'error' ? styles.error : undefined}
            color={status === 'error' ? cssVar.colorError : cssVar.colorTextSecondary}
            fontSize={12}
          >
            {status === 'error'
              ? errorDetail || t('builtins.lobe-image-generation.render.status.error')
              : t(`builtins.lobe-image-generation.render.status.${status}`)}
          </Text>
          {canRetry && (
            <Button loading={isValidating} size={'small'} onClick={retry}>
              {t('builtins.lobe-image-generation.render.retry')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
});

GenerationTile.displayName = 'GenerationTile';

export const GenerateImageRender = memo<
  BuiltinRenderProps<GenerateImageParams, GenerateImageState>
>(({ args, pluginError, pluginState }) => {
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
  const prompt = pluginState?.prompt || args?.prompt;

  return (
    <Block variant={'outlined'} width={'100%'}>
      <div className={styles.header}>
        <div className={styles.meta}>
          <div className={styles.prompt}>{prompt}</div>
          <div className={styles.model}>{[provider, model].filter(Boolean).join('/')}</div>
        </div>
        <span className={styles.status}>
          {t('builtins.lobe-image-generation.render.generatedCount', {
            count: generations.length,
          })}
        </span>
      </div>
      <div className={styles.grid}>
        {generations.map((task, index) => (
          <GenerationTile
            index={index}
            key={`${task.generationId}-${task.asyncTaskId}`}
            task={task}
          />
        ))}
      </div>
    </Block>
  );
});

GenerateImageRender.displayName = 'GenerateImageRender';

export default GenerateImageRender;
