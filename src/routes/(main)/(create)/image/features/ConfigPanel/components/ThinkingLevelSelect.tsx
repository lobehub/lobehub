import { Select } from '@lobehub/ui/base-ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useGenerationConfigParam } from '@/store/image/slices/generationConfig/hooks';

const ThinkingLevelSelect = memo(() => {
  const { t } = useTranslation('image');
  const { value, setValue, enumValues } = useGenerationConfigParam('thinkingLevel');

  const options =
    enumValues?.map((level) => ({
      label: t(`config.thinkingLevel.options.${level}` as any, { defaultValue: level }),
      value: level,
    })) ?? [];

  return <Select options={options} style={{ width: '100%' }} value={value} onChange={setValue} />;
});

export default ThinkingLevelSelect;
