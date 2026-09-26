import { Select } from '@lobehub/ui/base-ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useGenerationConfigParam } from '@/store/image/slices/generationConfig/hooks';

const BackgroundSelect = memo(() => {
  const { t } = useTranslation('image');
  const { value, setValue, enumValues } = useGenerationConfigParam('background');

  const options =
    enumValues?.map((background) => ({
      label:
        background === 'auto'
          ? t('config.background.options.auto')
          : background === 'opaque'
            ? t('config.background.options.opaque')
            : background === 'transparent'
              ? t('config.background.options.transparent')
              : background,
      value: background,
    })) ?? [];

  return <Select options={options} style={{ width: '100%' }} value={value} onChange={setValue} />;
});

export default BackgroundSelect;
