import { LobeSelect, type LobeSelectProps, TooltipGroup } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { type ReactNode, memo, useMemo } from 'react';

import { ModelItemRender, ProviderItemRender } from '@/components/ModelSelect';
import { useEnabledChatModels } from '@/hooks/useEnabledChatModels';
import { type EnabledProviderWithModels } from '@/types/aiProvider';

const useStyles = createStyles(({ css }, { popupWidth }: { popupWidth?: number | string }) => ({
  popup: css`
    width: ${popupWidth
      ? typeof popupWidth === 'number'
        ? `${popupWidth}px`
        : popupWidth
      : 'max(360px, var(--anchor-width))'};
  `,
}));

type ModelAbilities = EnabledProviderWithModels['children'][number]['abilities'];

interface ModelOption {
  abilities?: ModelAbilities;
  displayName?: string;
  id: string;
  kind?: 'model';
  label: ReactNode;
  provider: string;
  value: string;
}

interface ProviderHeaderOption {
  disabled: true;
  kind: 'provider';
  label: ReactNode;
  logo?: string;
  name: string;
  provider: string;
  source?: EnabledProviderWithModels['source'];
  value: string;
}

interface ModelSelectProps extends Pick<LobeSelectProps, 'loading' | 'size' | 'style' | 'variant'> {
  defaultValue?: { model: string; provider?: string };
  initialWidth?: boolean;
  onChange?: (props: { model: string; provider: string }) => void;
  popupWidth?: number | string;
  requiredAbilities?: (keyof EnabledProviderWithModels['children'][number]['abilities'])[];
  showAbility?: boolean;

  value?: { model: string; provider?: string };
}

const ModelSelect = memo<ModelSelectProps>(
  ({
    value,
    onChange,
    initialWidth = false,
    showAbility = true,
    requiredAbilities,
    loading,
    popupWidth,
    size,
    style,
    variant,
  }) => {
    const { styles } = useStyles({ popupWidth });
    const enabledList = useEnabledChatModels();

    const selectValue = value?.provider && value?.model ? `${value.provider}/${value.model}` : undefined;

    const options = useMemo<LobeSelectProps['options']>(() => {
      const getChatModels = (provider: EnabledProviderWithModels) => {
        const models =
          requiredAbilities && requiredAbilities.length > 0
            ? provider.children.filter((model) =>
                requiredAbilities.every((ability) => Boolean(model.abilities?.[ability])),
              )
            : provider.children;

        return models.map((model) => ({
          ...model,
          kind: 'model' as const,
          label: <ModelItemRender {...model} {...model.abilities} showInfoTag={false} />,
          provider: provider.id,
          value: `${provider.id}/${model.id}`,
        }));
      };

      if (enabledList.length === 1) {
        const provider = enabledList[0];

        return getChatModels(provider);
      }

      // NOTE: Flatten group options to avoid OptGroup scroll-jumping under virtual list.
      const flat: Array<ModelOption | ProviderHeaderOption> = [];

      for (const provider of enabledList) {
        const opts = getChatModels(provider) as unknown as ModelOption[];
        if (opts.length === 0) continue;

        flat.push({
          disabled: true,
          kind: 'provider',
          label: (
            <ProviderItemRender
              logo={provider.logo}
              name={provider.name}
              provider={provider.id}
              source={provider.source}
            />
          ),
          logo: provider.logo,
          name: provider.name,
          provider: provider.id,
          source: provider.source,
          value: `__provider__/${provider.id}`,
        }, ...opts);
      }

      return flat as unknown as LobeSelectProps['options'];
    }, [enabledList, requiredAbilities, showAbility]);

    return (
      <TooltipGroup>
        <LobeSelect
          defaultValue={selectValue}
          loading={loading}
          onChange={(value, option) => {
            if (!value) return;
            if (typeof value === 'string' && value.startsWith('__provider__/')) return;
            const model = (value as string).split('/').slice(1).join('/');
            onChange?.({ model, provider: (option as unknown as ModelOption).provider });
          }}
          optionRender={(option) => {
            const data = option as unknown as ModelOption | ProviderHeaderOption;
            if (data.kind === 'provider') {
              return (
                <div style={{ opacity: 0.75, paddingInline: 4 }}>
                  <ProviderItemRender
                    logo={data.logo}
                    name={data.name}
                    provider={data.provider}
                    source={data.source}
                  />
                </div>
              );
            }

            return (
              <ModelItemRender
                displayName={(data as ModelOption).displayName}
                id={(data as ModelOption).id}
                showInfoTag
                {...(data as ModelOption).abilities}
              />
            );
          }}
          options={options}
          popupClassName={styles.popup}
          popupMatchSelectWidth={false}
          selectedIndicatorVariant="bold"
          size={size}
          style={{
            minWidth: 200,
            width: initialWidth ? 'initial' : undefined,
            ...style,
          }}
          value={selectValue}
          variant={variant}
          virtual
        />
      </TooltipGroup>
    );
  },
);

export default ModelSelect;
