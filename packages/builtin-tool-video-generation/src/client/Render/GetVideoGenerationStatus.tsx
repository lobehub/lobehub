'use client';

import type { BuiltinRenderProps, VideoGenerationAsset } from '@lobechat/types';
import { Alert, Block, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { GetVideoGenerationStatusParams, GetVideoGenerationStatusState } from '../../types';

const styles = stylex.create({
  body: { display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px' },
  status: { fontFamily: cssVar.fontFamilyCode, fontSize: '12px', color: cssVar.colorTextSecondary },
  video: {
    width: '100%',
    maxHeight: '560px',
    borderRadius: '8px',
    background: cssVar.colorFillTertiary,
  },
});

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
      <div {...stylex.props(styles.body)}>
        <Text as={'span'} className={stylex.props(styles.status).className}>
          {t(`builtins.lobe-video-generation.render.status.${pluginState.status}`)}
        </Text>
        {url && (
          <video
            controls
            {...stylex.props(styles.video)}
            poster={getPosterUrl(pluginState)}
            preload={'metadata'}
            src={url}
          />
        )}
      </div>
    </Block>
  );
});

GetVideoGenerationStatusRender.displayName = 'GetVideoGenerationStatusRender';

export default GetVideoGenerationStatusRender;
