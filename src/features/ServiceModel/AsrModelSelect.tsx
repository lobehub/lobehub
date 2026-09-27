'use client';

import { Flexbox } from '@lobehub/ui';
import { AutoComplete, Select } from '@lobehub/ui/base-ui';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ProviderItemRender } from '@/components/ModelSelect';
import { useAiInfraStore } from '@/store/aiInfra';

interface AsrModelValue {
  model: string;
  provider: string;
}

interface AsrModelSelectProps {
  disabled?: boolean;
  onChange: (value: AsrModelValue) => void;
  value: AsrModelValue;
}

/**
 * Speech-to-text models are rarely listed as provider model cards (a deployment's own gateway
 * may route one that no card describes), so the model is free text: the provider's known ASR
 * models are offered as suggestions, and any other id can be typed. Clearing the provider turns
 * transcription off.
 */
const AsrModelSelect = ({ disabled, onChange, value }: AsrModelSelectProps) => {
  const { t } = useTranslation('setting');
  const enabledAiProviders = useAiInfraStore((s) => s.enabledAiProviders);
  const builtinAiModelList = useAiInfraStore((s) => s.builtinAiModelList);
  const enabledAiModels = useAiInfraStore((s) => s.enabledAiModels);
  const [model, setModel] = useState(value.model);

  useEffect(() => {
    setModel(value.model);
  }, [value.model]);

  const providerOptions = useMemo(
    () =>
      (enabledAiProviders ?? []).map((provider) => ({
        label: (
          <ProviderItemRender
            logo={provider.logo}
            name={provider.name || provider.id}
            provider={provider.id}
            source={provider.source}
          />
        ),
        value: provider.id,
      })),
    [enabledAiProviders],
  );

  const modelOptions = useMemo(() => {
    if (!value.provider) return [];

    const ids = new Set<string>();
    for (const item of [...builtinAiModelList, ...(enabledAiModels ?? [])]) {
      if (item.type === 'asr' && item.providerId === value.provider) ids.add(item.id);
    }

    return [...ids];
  }, [builtinAiModelList, enabledAiModels, value.provider]);

  const commitModel = (next: string) => {
    const trimmed = next.trim();
    if (trimmed === value.model) return;

    onChange({ model: trimmed, provider: value.provider });
  };

  return (
    <Flexbox align="center" direction="horizontal" gap={8} style={{ width: 'min(100%, 448px)' }}>
      <Select
        allowClear
        disabled={disabled}
        options={providerOptions}
        placeholder={t('systemAgent.asr.providerPlaceholder')}
        style={{ flex: 'none', width: 180 }}
        value={value.provider || undefined}
        onChange={(provider) =>
          onChange(
            provider
              ? { model: value.model, provider: provider as string }
              : { model: '', provider: '' },
          )
        }
      />
      <div style={{ flex: 1, minWidth: 0 }} onBlur={() => commitModel(model)}>
        <AutoComplete
          disabled={disabled || !value.provider}
          options={modelOptions}
          placeholder={t('systemAgent.asr.modelPlaceholder')}
          style={{ width: '100%' }}
          value={model}
          onChange={(next) => {
            setModel(next);
            // Picking a suggestion is a complete choice; typed text commits on blur.
            if (modelOptions.includes(next)) commitModel(next);
          }}
        />
      </div>
    </Flexbox>
  );
};

export default AsrModelSelect;
