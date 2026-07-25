'use client';

import type { BuiltinRenderProps, VideoGenerationAsset } from '@lobechat/types';
import { Alert, Block, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useClientDataSWR } from '@/libs/swr';
import { videoKeys } from '@/libs/swr/keys';
import { normalizeAsyncError } from '@/libs/swr/normalizeError';
import { generationService } from '@/services/generation';

import type {
  GeneratedVideoTask,
  GenerateVideoParams,
  GenerateVideoState,
  GetVideoGenerationStatusParams,
  GetVideoGenerationStatusState,
} from '../../types';
import { clearGenerationProgressStart, GenerationProgress } from '../components/GenerationProgress';
import { resolveGenerationDisplayState } from '../utils/resolveGenerationDisplayState';

const POLLING_INTERVAL = 3000;

const styles = createStaticStyles(({ css, cssVar }) => ({
  body: css`
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;

    min-height: 180px;

    background: ${cssVar.colorFillTertiary};
  `,
  error: css`
    color: ${cssVar.colorError};
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
  statusBody: css`
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: center;
    justify-content: center;

    min-height: 180px;
    padding: 20px;

    text-align: center;
  `,
  statusChip: css`
    flex-shrink: 0;

    padding-block: 2px;
    padding-inline: 8px;
    border-radius: 999px;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillTertiary};
  `,
  video: css`
    display: block;
    width: 100%;
    max-height: 560px;
    background: #000;
  `,
}));

const isTerminalStatus = (status?: string) => status === 'success' || status === 'error';

const getAssetUrl = (state?: GetVideoGenerationStatusState) => {
  const asset = state?.generation?.asset;
  return asset?.url || asset?.originalUrl;
};

const getPosterUrl = (state?: GetVideoGenerationStatusState) => {
  const asset = state?.generation?.asset as null | VideoGenerationAsset | undefined;
  return asset?.coverUrl || asset?.thumbnailUrl;
};

const getTaskAssetUrl = (task: GeneratedVideoTask) => task.asset?.url || task.asset?.originalUrl;

const getTaskPosterUrl = (task: GeneratedVideoTask) =>
  (task.asset as null | VideoGenerationAsset | undefined)?.coverUrl || task.asset?.thumbnailUrl;

const getErrorDetail = (state?: GetVideoGenerationStatusState) => {
  const error = state?.error;
  if (!error) return;
  const body = error.body;
  if (typeof body === 'string') return body;
  return body.detail;
};

const getTaskErrorDetail = (task: GeneratedVideoTask) => {
  const error = task.error;
  if (!error) return;
  const body = error.body;
  if (typeof body === 'string') return body;
  return body.detail;
};

const useGenerationStatus = (params: GetVideoGenerationStatusParams, enabled: boolean) => {
  const [pollingStopped, setPollingStopped] = useState(false);

  useEffect(() => {
    setPollingStopped(false);
  }, [params.asyncTaskId, params.generationId]);

  const result = useClientDataSWR<GetVideoGenerationStatusState>(
    enabled && params.asyncTaskId
      ? videoKeys.generationStatus(params.generationId, params.asyncTaskId)
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
      refreshInterval: (data?: GetVideoGenerationStatusState) =>
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

export const GenerateVideoRender = memo<
  BuiltinRenderProps<GenerateVideoParams, GenerateVideoState>
>(({ args, pluginError, pluginState, toolCallId }) => {
  const { t } = useTranslation('plugin');
  const task = pluginState?.generation;
  const shouldFetchStatus = Boolean(task && !isTerminalStatus(task.status));
  const { data, error, isLoading, isValidating, retry } = useGenerationStatus(
    {
      asyncTaskId: task?.asyncTaskId ?? '',
      generationId: task?.generationId ?? '',
    },
    shouldFetchStatus,
  );
  const taskStatus = data?.status || task?.status;

  useEffect(() => {
    if (pluginError || isTerminalStatus(taskStatus)) clearGenerationProgressStart(toolCallId);
  }, [pluginError, taskStatus, toolCallId]);

  if (pluginError && !task) {
    return (
      <Alert
        showIcon
        description={pluginError.message}
        title={t('builtins.lobe-video-generation.render.generationFailed')}
        type={'error'}
      />
    );
  }

  if (!task) return null;

  const { status, statusCheckFailed } = resolveGenerationDisplayState({
    generationStatus: taskStatus,
    isLoading,
    statusRequestError: error,
  });
  const url = getTaskAssetUrl(task) || getAssetUrl(data);
  const poster = getTaskPosterUrl(task) || getPosterUrl(data);
  const errorDetail = getTaskErrorDetail(task) || getErrorDetail(data);
  const canRetry = Boolean(error) && normalizeAsyncError(error).retryable;
  const provider = pluginState.provider || args?.provider;
  const model = pluginState.model || args?.model;
  const prompt = pluginState.prompt || args?.prompt;
  const estimatedDurationMs = pluginState.estimatedDurationMs || args?.estimatedDurationMs;
  const isGenerating = status === 'pending' || status === 'processing';

  return (
    <Block variant={'outlined'} width={'100%'}>
      <div className={styles.header}>
        <div className={styles.meta}>
          <div className={styles.prompt}>{prompt}</div>
          <div className={styles.model}>{[provider, model].filter(Boolean).join('/')}</div>
        </div>
        <span className={styles.statusChip}>
          {t(`builtins.lobe-video-generation.render.status.${status}`)}
        </span>
      </div>
      {url ? (
        <div className={styles.body}>
          <video controls className={styles.video} poster={poster} preload={'metadata'} src={url} />
        </div>
      ) : (
        <div className={styles.statusBody}>
          {isGenerating ? (
            <>
              <GenerationProgress
                estimatedDurationMs={estimatedDurationMs}
                toolCallId={toolCallId}
              />
              {statusCheckFailed && (
                <Text as={'span'} className={styles.error} color={cssVar.colorError} fontSize={12}>
                  {t('builtins.lobe-video-generation.render.statusCheckFailed')}
                </Text>
              )}
            </>
          ) : (
            <Text
              as={'span'}
              className={status === 'error' ? styles.error : undefined}
              color={status === 'error' ? cssVar.colorError : cssVar.colorTextSecondary}
              fontSize={12}
            >
              {status === 'error'
                ? errorDetail || t('builtins.lobe-video-generation.render.status.error')
                : t(`builtins.lobe-video-generation.render.status.${status}`)}
            </Text>
          )}
          {canRetry && (
            <Button loading={isValidating} size={'small'} onClick={retry}>
              {t('builtins.lobe-video-generation.render.retry')}
            </Button>
          )}
        </div>
      )}
    </Block>
  );
});

GenerateVideoRender.displayName = 'GenerateVideoRender';

export default GenerateVideoRender;
