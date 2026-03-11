import { Segmented } from '@lobehub/ui';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useGenerationConfigParam } from '@/store/image/slices/generationConfig/hooks';

const ResolutionSelect = memo(() => {
  const { t } = useTranslation('image');
  const { value, setValue, enumValues } = useGenerationConfigParam('resolution');

  const handleChange = useCallback(
    (resolution: string | number) => {
      setValue(String(resolution));
    },
    [setValue],
  );

  const options = useMemo(() => {
    if (!enumValues || enumValues.length === 0) return [];
    return enumValues.map((resolution) => ({
      label: t(`config.resolution.options.${resolution}`, { defaultValue: resolution }),
      value: resolution,
    }));
  }, [enumValues, t]);

  if (options.length === 0) {
    return null;
  }

  return (
    <Segmented
      block
      options={options}
      style={{ width: '100%' }}
      value={value}
      variant="filled"
      onChange={handleChange}
    />
  );
});

export default ResolutionSelect;
