import { type SelectProps } from '@lobehub/ui';
import { ActionIcon, Flexbox, Icon, Select } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { LucideArrowRight, LucideBolt } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { ProviderItemRender } from '@/components/ModelSelect';
import { useAiInfraStore } from '@/store/aiInfra';
import { aiProviderSelectors } from '@/store/aiInfra/slices/aiProvider/selectors';
import { useImageStore } from '@/store/image';
import { imageGenerationConfigSelectors } from '@/store/image/selectors';
import { type EnabledProviderWithModels } from '@/types/index';

import ImageModelItem from './ImageModelItem';

const prefixCls = 'ant';

const styles = createStaticStyles(({ css }) => ({
  popup: css`
    &.${prefixCls}-select-dropdown .${prefixCls}-select-item-option-grouped {
      padding-inline-start: 12px;
    }
  `,
}));

interface ModelOption {
  label: any;
  provider: string;
  value: string;
}

const ModelSelect = memo(() => {
  const { t } = useTranslation('components');
  const navigate = useNavigate();

  const [currentModel, currentProvider] = useImageStore((s) => [
    imageGenerationConfigSelectors.model(s),
    imageGenerationConfigSelectors.provider(s),
  ]);
  const setModelAndProviderOnSelect = useImageStore((s) => s.setModelAndProviderOnSelect);

  const enabledImageModelList = useAiInfraStore(aiProviderSelectors.enabledImageModelList);

  const options = useMemo<SelectProps['options']>(() => {
    const getImageModels = (provider: EnabledProviderWithModels) => {
      const modelOptions = provider.children.map((model) => ({
        label: <ImageModelItem {...model} providerId={provider.id} />,
        provider: provider.id,
        value: `${provider.id}/${model.id}`,
      }));

      // if there are no models, add a placeholder guide
      if (modelOptions.length === 0) {
        return [
          {
            disabled: true,
            label: (
              <Flexbox horizontal gap={8} style={{ color: cssVar.colorTextTertiary }}>
                {t('ModelSwitchPanel.emptyModel')}
                <Icon icon={LucideArrowRight} />
              </Flexbox>
            ),
            onClick: () => {
              navigate(`/settings/provider/${provider.id}`);
            },
            value: `${provider.id}/empty`,
          },
        ];
      }

      return modelOptions;
    };

    // if there are no providers at all
    if (enabledImageModelList.length === 0) {
      return [
        {
          disabled: true,
          label: (
            <Flexbox horizontal gap={8} style={{ color: cssVar.colorTextTertiary }}>
              {t('ModelSwitchPanel.emptyProvider')}
              <Icon icon={LucideArrowRight} />
            </Flexbox>
          ),
          onClick: () => {
            navigate('/settings/provider/all');
          },
          value: 'no-provider',
        },
      ];
    }

    if (enabledImageModelList.length === 1) {
      const provider = enabledImageModelList[0];
      return getImageModels(provider);
    }

    return enabledImageModelList.map((provider) => ({
      label: (
        <Flexbox horizontal justify="space-between">
          <ProviderItemRender
            logo={provider.logo}
            name={provider.name}
            provider={provider.id}
            source={provider.source}
          />
          <ActionIcon
            icon={LucideBolt}
            size={'small'}
            title={t('ModelSwitchPanel.goToSettings')}
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/settings/provider/${provider.id}`);
            }}
          />
        </Flexbox>
      ),
      options: getImageModels(provider),
    }));
  }, [enabledImageModelList, t, navigate]);

  const labelRender: SelectProps['labelRender'] = (props) => {
    const modelInfo = enabledImageModelList
      .flatMap((provider) =>
        provider.children.map((model) => ({ ...model, providerId: provider.id })),
      )
      .find((model) => props.value === `${model.providerId}/${model.id}`);

    if (!modelInfo) return props.label;

    return (
      <ImageModelItem
        {...modelInfo}
        providerId={modelInfo.providerId}
        showBadge={false}
        showPopover={false}
      />
    );
  };

  return (
    <Select
      shadow
      labelRender={labelRender}
      options={options}
      size={'large'}
      value={currentProvider && currentModel ? `${currentProvider}/${currentModel}` : undefined}
      classNames={{
        root: styles.popup,
      }}
      style={{
        width: '100%',
      }}
      onChange={(value, option) => {
        // Skip onChange for disabled options (empty states)
        if (value === 'no-provider' || value.includes('/empty')) return;
        const model = value.split('/').slice(1).join('/');
        const provider = (option as unknown as ModelOption).provider;
        if (model !== currentModel || provider !== currentProvider) {
          setModelAndProviderOnSelect(model, provider);
        }
      }}
    />
  );
});

export default ModelSelect;
