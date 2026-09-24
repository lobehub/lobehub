'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Alert, Button, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { downloadPreviewImage } from '@/features/Conversation/Messages/components/downloadPreviewImage';
import { normalizeAsyncError } from '@/libs/swr/normalizeError';

import type { GetImageGenerationStatusParams, GetImageGenerationStatusState } from '../../types';
import { resolveAspectRatio } from '../components/aspectRatio';
import ImageCanvas from '../components/ImageCanvas';
import ImageCanvasGrid from '../components/ImageCanvasGrid';
import {
  getStateAssetUrl,
  getStateErrorDetail,
  isTerminalStatus,
  useGenerationStatus,
} from '../components/useGenerationStatus';

const styles = createStaticStyles(({ css }) => ({
  root: css`
    display: flex;
    flex-direction: column;
    gap: 8px;
  `,
}));

const getAsset = (state?: GetImageGenerationStatusState) => state?.generation?.asset;

export const GetImageGenerationStatusRender = memo<
  BuiltinRenderProps<GetImageGenerationStatusParams, GetImageGenerationStatusState>
>(({ pluginError, pluginState }) => {
  const { t } = useTranslation('plugin');
  // The stored result is the snapshot taken when the tool returned. Keep polling
  // from there so a card left mid-generation finishes on screen by itself.
  const { data, error, isValidating, retry } = useGenerationStatus(
    {
      asyncTaskId: pluginState?.asyncTaskId as string,
      generationId: pluginState?.generationId as string,
    },
    !!pluginState && !isTerminalStatus(pluginState.status),
  );

  if (pluginError) {
    return (
      <Alert
        showIcon
        description={pluginError.message}
        title={t('builtins.lobe-image-generation.render.statusCheckFailed')}
        type={'error'}
      />
    );
  }

  if (!pluginState) return null;

  const live = data ?? pluginState;
  const status = error ? 'error' : live.status;
  const url = getStateAssetUrl(live);
  const asset = getAsset(live);
  const ratio = resolveAspectRatio(undefined, asset);
  const errorDetail = error instanceof Error ? error.message : getStateErrorDetail(live);
  const canRetry = Boolean(error) && normalizeAsyncError(error).retryable;

  return (
    <div className={styles.root}>
      {/* Same canvas the generateImage card uses, so a follow-up status check
          reads as the same image continuing rather than a second card. */}
      <ImageCanvasGrid count={1} ratio={ratio}>
        <ImageCanvas
          alt={t('builtins.lobe-image-generation.render.imageAlt', { index: 1 })}
          badge={t(`builtins.lobe-image-generation.render.status.${status}`)}
          ratio={ratio}
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
      </ImageCanvasGrid>
    </div>
  );
});

GetImageGenerationStatusRender.displayName = 'GetImageGenerationStatusRender';

export default GetImageGenerationStatusRender;
