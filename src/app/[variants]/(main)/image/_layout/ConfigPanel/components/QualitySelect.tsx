import { Select } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useGenerationConfigParam } from '@/store/image/slices/generationConfig/hooks';

const QualitySelect = memo(() => {
  const { t } = useTranslation('image');
  const { value, setValue, enumValues } = useGenerationConfigParam('quality');

  const options =
    enumValues?.map((quality) => ({
      label:
        quality === 'standard'
          ? t('config.quality.options.standard')
          : t('config.quality.options.hd'),
      value: quality,
    })) ?? [];

  return <Select onChange={setValue} options={options} style={{ width: '100%' }} value={value} />;
});

export default QualitySelect;
