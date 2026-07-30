import { ModelIcon } from '@lobehub/icons';
import { Flexbox, Icon, Tag, Text, Tooltip, TooltipGroup } from '@lobehub/ui';
import { Select, type SelectProps } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { SquarePower } from 'lucide-react';
import { type ReactNode } from 'react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { message } from '@/components/AntdStaticMethods';
import { ModelItemRender, ProviderItemRender, TAG_CLASSNAME } from '@/components/ModelSelect';
import { aiProviderSelectors, useAiInfraStore } from '@/store/aiInfra';
import { type EnabledProviderWithModels } from '@/types/aiProvider';

import { resolveStaleModelState } from './resolveStaleModelState';

const prefixCls = 'ant';

/**
 * Marks the popup-only part (explanatory hint) of the stale-model option so the
 * trigger can hide it, mirroring how ability tags are hidden via TAG_CLASSNAME.
 */
const STALE_EXTRA_CLASSNAME = 'lobe-model-select-stale-extra';

/**
 * Sentinel option value for the "enable this model" action row. Intercepted in
 * onChange so selecting it triggers the enable flow instead of a value change.
 */
const STALE_ACTION_VALUE = '__lobe_model_select_enable_action__';

const styles = createStaticStyles(({ css, cssVar }) => ({
  actionOption: css`
    color: ${cssVar.colorInfo};
  `,
  popup: css`
    width: max(360px, var(--anchor-width));

    &.${prefixCls}-select-dropdown .${prefixCls}-select-item-option-grouped {
      padding-inline-start: 12px;
    }
  `,
  select: css`
    .${prefixCls}-select-selection-item {
      .${TAG_CLASSNAME} {
        display: none;
      }

      .${STALE_EXTRA_CLASSNAME} {
        display: none;
      }
    }
  `,
  staleHint: css`
    font-size: 12px;
    line-height: 1.5;
    color: ${cssVar.colorTextTertiary};
    white-space: normal;
  `,
}));

interface ModelOption {
  abilities?: Record<string, boolean>;
  id: string;
  label: ReactNode;
  provider: string;
  value: string;
}

interface ModelSelectProps extends Pick<
  SelectProps,
  'disabled' | 'loading' | 'size' | 'style' | 'variant'
> {
  defaultValue?: { model: string; provider?: string };
  initialWidth?: boolean;
  modelType?: 'chat' | 'embedding';
  onChange?: (props: { model: string; provider: string }) => void;
  popupWidth?: number;
  requiredAbilities?: (keyof EnabledProviderWithModels['children'][number]['abilities'])[];
  showAbility?: boolean;
  value?: { model: string; provider?: string };
}

const ModelSelect = memo<ModelSelectProps>(
  ({
    value,
    onChange,
    showAbility: _showAbility = true,
    requiredAbilities,
    loading,
    disabled,
    size,
    style,
    variant,
    initialWidth = false,
    popupWidth,
    modelType = 'chat',
  }) => {
    const { t } = useTranslation('components');
    const [enabling, setEnabling] = useState(false);
    const enabledList = useAiInfraStore((s) =>
      modelType === 'embedding'
        ? aiProviderSelectors.enabledEmbeddingModelList(s)
        : s.enabledChatModelList || [],
    );
    const builtinAiModelList = useAiInfraStore((s) => s.builtinAiModelList);
    const toggleProviderModelEnabled = useAiInfraStore((s) => s.toggleProviderModelEnabled);

    const options = useMemo<SelectProps['options']>(() => {
      const getChatModels = (provider: EnabledProviderWithModels) => {
        const models =
          requiredAbilities && requiredAbilities.length > 0
            ? provider.children.filter((model) =>
                requiredAbilities.every((ability) => Boolean(model.abilities?.[ability])),
              )
            : provider.children;

        return models.map((model) => ({
          ...model,
          label: <ModelItemRender {...model} {...model.abilities} showInfoTag={false} />,
          provider: provider.id,
          value: `${provider.id}/${model.id}`,
        }));
      };

      if (enabledList.length === 1) {
        const provider = enabledList[0];

        return getChatModels(provider);
      }

      return enabledList
        .map((provider) => {
          const opts = getChatModels(provider);
          if (opts.length === 0) return undefined;

          return {
            label: (
              <ProviderItemRender
                logo={provider.logo}
                name={provider.name}
                provider={provider.id}
                source={provider.source}
              />
            ),
            options: opts,
          };
        })
        .filter(Boolean) as SelectProps['options'];
    }, [enabledList, requiredAbilities]);

    const staleState = useMemo(
      () => resolveStaleModelState(value, enabledList, builtinAiModelList, modelType),
      [builtinAiModelList, enabledList, modelType, value],
    );

    const finalOptions = useMemo<SelectProps['options']>(() => {
      if (!staleState || !value) return options;

      const { meta, status } = staleState;

      const currentOption = {
        __stale: true,
        disabled: true,
        label: (
          <Flexbox gap={4}>
            <Flexbox horizontal align={'center'} gap={8}>
              <ModelIcon model={value.model} size={20} />
              <Text ellipsis style={{ fontSize: 14 }}>
                {meta?.displayName || value.model}
              </Text>
              <Tooltip title={t(`ModelSelect.staleModel.${status}.tooltip`)}>
                <Tag
                  color={status === 'removed' ? 'warning' : undefined}
                  size={'small'}
                  style={{ cursor: 'default', flex: 'none' }}
                >
                  {t(`ModelSelect.staleModel.${status}.tag`)}
                </Tag>
              </Tooltip>
            </Flexbox>
            <span className={`${STALE_EXTRA_CLASSNAME} ${styles.staleHint}`}>
              {t(`ModelSelect.staleModel.${status}.hint`)}
            </span>
          </Flexbox>
        ),
        value: `${value.provider}/${value.model}`,
      };

      const actionOption =
        status === 'notEnabled'
          ? {
              __stale: true,
              label: (
                <Flexbox horizontal align={'center'} className={styles.actionOption} gap={8}>
                  <Icon icon={SquarePower} size={16} />
                  {t('ModelSelect.staleModel.notEnabled.action')}
                </Flexbox>
              ),
              value: STALE_ACTION_VALUE,
            }
          : undefined;

      return [
        {
          label: t('ModelSelect.staleModel.current'),
          options: [currentOption, actionOption].filter(Boolean),
        },
        ...(options ?? []),
      ] as SelectProps['options'];
    }, [options, staleState, t, value]);

    const handleEnable = async () => {
      if (!value?.provider) return;

      setEnabling(true);
      try {
        await toggleProviderModelEnabled({
          enabled: true,
          id: value.model,
          providerId: value.provider,
          type: modelType,
        });
      } catch {
        message.error(t('ModelSelect.staleModel.notEnabled.actionFailed'));
      } finally {
        setEnabling(false);
      }
    };

    return (
      <TooltipGroup>
        <Select
          className={styles.select}
          defaultValue={`${value?.provider}/${value?.model}`}
          disabled={disabled}
          loading={loading || enabling}
          options={finalOptions}
          popupClassName={styles.popup}
          popupMatchSelectWidth={popupWidth === undefined ? false : popupWidth}
          size={size}
          value={`${value?.provider}/${value?.model}`}
          variant={variant}
          optionRender={(option) => {
            if ((option as unknown as { __stale?: boolean }).__stale) return option.label;

            return (
              <ModelItemRender
                {...(option as ModelOption)}
                {...(option as ModelOption).abilities}
                showInfoTag={false}
              />
            );
          }}
          style={{
            minWidth: 200,
            width: initialWidth ? 'initial' : undefined,
            ...style,
          }}
          onChange={(value, option) => {
            if (value === STALE_ACTION_VALUE) {
              void handleEnable();
              return;
            }

            const model = value.split('/').slice(1).join('/');
            onChange?.({ model, provider: (option as unknown as ModelOption).provider });
          }}
        />
      </TooltipGroup>
    );
  },
);

export default ModelSelect;
