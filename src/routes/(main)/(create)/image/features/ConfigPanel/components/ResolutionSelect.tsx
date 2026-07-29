import { Tabs } from '@lobehub/ui/base-ui';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useGenerationConfigParam } from '@/store/image/slices/generationConfig/hooks';

const ResolutionSelect = memo(() => {
  const { t } = useTranslation('image');
  const { value, setValue, enumValues } = useGenerationConfigParam('resolution');

  const handleChange = useCallback(
    (resolution: string) => {
      setValue(resolution);
    },
    [setValue],
  );

  const options = useMemo(() => {
    if (!enumValues || enumValues.length === 0) return [];
    return enumValues.map((resolution) => ({
      key: resolution,
      label: t(`config.resolution.options.${resolution}`, { defaultValue: resolution }),
    }));
  }, [enumValues, t]);

  if (options.length === 0) {
    return null;
  }

  return (
    <Tabs
      activeKey={value}
      items={options}
      style={{ width: '100%' }}
      styles={{
        list: { display: 'flex', width: '100%' },
        tab: { flex: 1 },
      }}
      onChange={handleChange}
    />
  );
});

export default ResolutionSelect;
