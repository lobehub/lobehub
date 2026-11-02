'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox, Image, PreviewGroup, Text } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

interface ImageOutputState {
  images?: Array<{ fileId?: string; url?: string }>;
}

export const ImageOutputRender = ({
  pluginState,
}: BuiltinRenderProps<unknown, ImageOutputState>) => {
  const { t } = useTranslation('plugin');
  const images = pluginState?.images?.filter(({ url }) => !!url) ?? [];
  if (images.length === 0) return <Text>{t('builtins.codex.imageOutput.unavailable')}</Text>;

  return (
    <PreviewGroup>
      <Flexbox gap={8}>
        {images.map((image, index) => (
          <Image
            alt={t('builtins.codex.apiName.image_output')}
            key={image.fileId || image.url || index}
            maxHeight={600}
            src={image.url}
            style={{ alignSelf: 'flex-start', maxWidth: '100%' }}
          />
        ))}
      </Flexbox>
    </PreviewGroup>
  );
};
