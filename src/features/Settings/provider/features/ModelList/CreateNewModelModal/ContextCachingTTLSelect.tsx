import { Flexbox, Select, Text } from '@lobehub/ui';
import type { ContextCachingTTL } from 'model-bank';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { getContextCachingTTLState } from './contextCachingTTLState';

interface ContextCachingTTLSelectProps {
  disabled?: boolean;
  onChange?: (value: ContextCachingTTL | undefined) => void;
  provider: string;
  value?: ContextCachingTTL | null;
}

/**
 * The model's prompt-cache lifetime (`settings.contextCachingTTL`). Cleared means the provider
 * default. The line below shows the lifetime the shared resolver puts into effect, so it is the
 * value requests and context engineering use, not just the stored one.
 */
const ContextCachingTTLSelect = memo<ContextCachingTTLSelectProps>(
  ({ disabled, onChange, provider, value }) => {
    const { t } = useTranslation('modelProvider');
    const labelOf = (ttl: ContextCachingTTL) =>
      t(`providerModels.item.modelConfig.contextCachingTTL.options.${ttl}`);

    const { defaultTTL, effectiveTTL, isDefault, options } = getContextCachingTTLState(
      provider,
      value,
    );

    return (
      <Flexbox gap={6}>
        <Select
          allowClear
          disabled={disabled}
          value={value ?? undefined}
          options={options.map((ttl) => ({
            label: labelOf(ttl),
            value: ttl,
          }))}
          placeholder={t('providerModels.item.modelConfig.contextCachingTTL.placeholder', {
            ttl: labelOf(defaultTTL),
          })}
          onChange={(next) => onChange?.((next as ContextCachingTTL | null) ?? undefined)}
        />
        <Text fontSize={12} type={'secondary'}>
          {t(
            isDefault
              ? 'providerModels.item.modelConfig.contextCachingTTL.effectiveDefault'
              : 'providerModels.item.modelConfig.contextCachingTTL.effective',
            { ttl: labelOf(effectiveTTL) },
          )}
        </Text>
      </Flexbox>
    );
  },
);

export default ContextCachingTTLSelect;
