'use client';

import type { BuiltinRenderProps, VideoGenerationAsset } from '@lobechat/types';
import { Alert, Block, createStaticStyles, Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import MessageVideo from '@/components/MessageVideo';

import type { GetVideoGenerationStatusParams, GetVideoGenerationStatusState } from '../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  body: css`
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
  `,
  status: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
}));

const getAssetUrl = (state?: GetVideoGenerationStatusState) => {
  const asset = state?.generation?.asset;
  return asset?.url || asset?.originalUrl;
};

const getPosterUrl = (state?: GetVideoGenerationStatusState) => {
  const asset = state?.generation?.asset as null | VideoGenerationAsset | undefined;
  return asset?.coverUrl || asset?.thumbnailUrl;
};

export const GetVideoGenerationStatusRender = memo<
  BuiltinRenderProps<GetVideoGenerationStatusParams, GetVideoGenerationStatusState>
>(({ pluginError, pluginState }) => {
  const { t } = useTranslation('plugin');
  const url = getAssetUrl(pluginState);

  if (pluginError) {
    return (
      <Alert
        showIcon
        description={pluginError.message}
        title={t('builtins.lobe-video-generation.render.statusCheckFailed')}
        type={'error'}
      />
    );
  }

  if (!pluginState) return null;

  return (
    <Block variant={'outlined'} width={'100%'}>
      <div className={styles.body}>
        <Text as={'span'} className={styles.status}>
          {t(`builtins.lobe-video-generation.render.status.${pluginState.status}`)}
        </Text>
        {url && <MessageVideo maxHeight={560} poster={getPosterUrl(pluginState)} src={url} />}
      </div>
    </Block>
  );
});

GetVideoGenerationStatusRender.displayName = 'GetVideoGenerationStatusRender';

export default GetVideoGenerationStatusRender;
