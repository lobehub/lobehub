'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Block, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { GetImageGenerationStatusParams, GetImageGenerationStatusState } from '../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  body: css`
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
  `,
  image: css`
    width: 100%;
    max-height: 420px;
    border-radius: 8px;

    object-fit: contain;
    background: ${cssVar.colorFillTertiary};
  `,
  status: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
}));

const getAssetUrl = (state?: GetImageGenerationStatusState) => {
  const asset = state?.generation?.asset;
  return asset?.url || asset?.thumbnailUrl || asset?.originalUrl;
};

export const GetImageGenerationStatusRender = memo<
  BuiltinRenderProps<GetImageGenerationStatusParams, GetImageGenerationStatusState>
>(({ pluginState }) => {
  const { t } = useTranslation('plugin');
  const url = getAssetUrl(pluginState);

  if (!pluginState) return null;

  return (
    <Block variant={'outlined'} width={'100%'}>
      <div className={styles.body}>
        <Text as={'span'} className={styles.status}>
          {pluginState.status}
        </Text>
        {url && (
          <img
            alt={t('builtins.lobe-image-generation.render.imageAlt', { index: 1 })}
            className={styles.image}
            src={url}
          />
        )}
      </div>
    </Block>
  );
});

GetImageGenerationStatusRender.displayName = 'GetImageGenerationStatusRender';

export default GetImageGenerationStatusRender;
