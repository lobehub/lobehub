import { Select } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useGenerationConfigParam } from '@/store/image/slices/generationConfig/hooks';

const LABELED_FORMATS = new Set(['gif', 'png']);

interface OutputFormatSelectProps {
  /**
   * Disable the animated option. GIF output is generation-only, so it is unavailable while
   * reference images are attached.
   */
  disableAnimated?: boolean;
}

const OutputFormatSelect = memo<OutputFormatSelectProps>(({ disableAnimated }) => {
  const { t } = useTranslation('image');
  const { value, setValue, enumValues } = useGenerationConfigParam('outputFormat');

  const options =
    enumValues?.map((format) => {
      const disabled = format === 'gif' && disableAnimated;
      const label = LABELED_FORMATS.has(format)
        ? t(`config.outputFormat.options.${format as 'gif' | 'png'}`)
        : format.toUpperCase();

      return {
        disabled,
        label: disabled ? `${label} · ${t('config.outputFormat.gifRefUnsupported')}` : label,
        value: format,
      };
    }) ?? [];

  return <Select options={options} style={{ width: '100%' }} value={value} onChange={setValue} />;
});

export default OutputFormatSelect;
