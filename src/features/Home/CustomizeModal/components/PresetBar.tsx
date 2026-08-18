'use client';

import { Segmented } from '@lobehub/ui/base-ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { HOME_PRESET_KEYS, type HomePresetKey } from '../config';

export interface PresetBarProps {
  onChange: (key: HomePresetKey) => void;
  value: HomePresetKey | undefined;
}

// No option carries this value, so the switches falling outside every preset
// leave the bar with nothing highlighted — while the control stays controlled.
const CUSTOM_VALUE = 'custom';

const PresetBar = memo<PresetBarProps>(({ onChange, value }) => {
  const { t } = useTranslation('home');

  return (
    <Segmented<string>
      size={'small'}
      value={value ?? CUSTOM_VALUE}
      options={HOME_PRESET_KEYS.map((key) => ({
        label: t(`dashboard.customize.preset.${key}.title`),
        value: key,
      }))}
      onChange={(next) => onChange(next as HomePresetKey)}
    />
  );
});

export default PresetBar;
