import { Input, Select } from '@lobehub/ui';
import type { TTSVoice } from 'model-bank';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { buildTTSVoiceOptions } from './utils';

interface TTSVoiceSelectProps {
  /** The card's own default voice, shown as the placeholder of an empty value. */
  defaultVoice?: string;
  disabled?: boolean;
  onChange?: (value: string | undefined) => void;
  value?: string;
  /** Voice catalog of a built-in model; a custom model without one takes a free voice id. */
  voices?: TTSVoice[];
}

const TTSVoiceSelect = memo<TTSVoiceSelectProps>(
  ({ defaultVoice, disabled, onChange, value, voices }) => {
    const { t } = useTranslation('modelProvider');

    const placeholder = defaultVoice
      ? t('providerModels.item.modelConfig.ttsVoice.placeholder', { voice: defaultVoice })
      : t('providerModels.item.modelConfig.ttsVoice.placeholderCustom');

    const options = useMemo(() => buildTTSVoiceOptions(voices), [voices]);

    if (options.length === 0)
      return (
        <Input
          allowClear
          disabled={disabled}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange?.(e.target.value || undefined)}
        />
      );

    return (
      <Select
        allowClear
        showSearch
        disabled={disabled}
        options={options}
        placeholder={placeholder}
        value={value}
        onChange={(next) => onChange?.((next as string | null | undefined) ?? undefined)}
      />
    );
  },
);

export default TTSVoiceSelect;
