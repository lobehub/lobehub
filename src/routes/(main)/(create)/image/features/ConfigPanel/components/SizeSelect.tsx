import { Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useImageStore } from '@/store/image';
import { useGenerationConfigParam } from '@/store/image/slices/generationConfig/hooks';
import { imageGenerationConfigSelectors } from '@/store/image/slices/generationConfig/selectors';

import Select from './Select';

const SizeSelect = memo(() => {
  const { t } = useTranslation('image');
  const isAutomaticSize = useImageStore(imageGenerationConfigSelectors.isAutomaticSize);
  const { value, setValue, enumValues } = useGenerationConfigParam('size');

  if (isAutomaticSize) return <Text type="secondary">{t('config.size.autoByOpenAI')}</Text>;

  const options = enumValues!.map((size) => ({
    label: size,
    value: size,
  }));

  return <Select options={options} value={value} onChange={setValue} />;
});

export default SizeSelect;
