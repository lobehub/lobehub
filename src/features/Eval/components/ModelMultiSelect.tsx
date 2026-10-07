'use client';

import { Flexbox } from '@lobehub/ui';
import { Select } from '@lobehub/ui/base-ui';
import { useMemo } from 'react';

import { ModelIcon } from '@/components/LobeIcons';
import { useEnabledChatModels } from '@/hooks/useEnabledChatModels';

export interface ModelTarget {
  model: string;
  provider: string;
}

export const toTargetKey = ({ model, provider }: ModelTarget) => `${provider}/${model}`;

export const fromTargetKey = (key: string): ModelTarget => {
  const slash = key.indexOf('/');
  return { model: key.slice(slash + 1), provider: key.slice(0, slash) };
};

export interface ModelMultiSelectProps {
  max?: number;
  onChange?: (value: string[]) => void;
  placeholder?: string;
  /** `provider/model` keys. */
  value?: string[];
}

/**
 * Pick several of the user's enabled chat models, grouped by provider. Values
 * are `provider/model` keys so the same model served by two providers stays
 * two distinct choices.
 */
const ModelMultiSelect = ({ max = 8, onChange, placeholder, value }: ModelMultiSelectProps) => {
  const providers = useEnabledChatModels();

  const options = useMemo(
    () =>
      providers.map((provider) => ({
        label: provider.name || provider.id,
        options: provider.children.map((model) => ({
          disabled: !!value && value.length >= max && !value.includes(`${provider.id}/${model.id}`),
          label: (
            <Flexbox horizontal align="center" gap={8}>
              <ModelIcon model={model.id} size={16} />
              <span>{model.displayName || model.id}</span>
            </Flexbox>
          ),
          title: `${model.displayName || model.id} ${provider.id}`,
          value: `${provider.id}/${model.id}`,
        })),
      })),
    [providers, value, max],
  );

  return (
    <Select
      allowClear
      showSearch
      mode="multiple"
      options={options}
      placeholder={placeholder}
      style={{ width: '100%' }}
      value={value}
      onChange={(next) => onChange?.(next as string[])}
    />
  );
};

export default ModelMultiSelect;
