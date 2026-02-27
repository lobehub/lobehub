import type { SelectProps } from '@lobehub/ui';
import { ActionIcon, Flexbox, Icon, Select } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { LucideArrowRight, LucideBolt } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { ProviderItemRender } from '@/components/ModelSelect';
import { useAiInfraStore } from '@/store/aiInfra';
import { aiProviderSelectors } from '@/store/aiInfra/slices/aiProvider/selectors';
import { useVideoStore } from '@/store/video';
import { videoGenerationConfigSelectors } from '@/store/video/selectors';
import type { EnabledProviderWithModels } from '@/types/index';

import VideoModelItem from './VideoModelItem';

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

  const [currentModel, currentProvider] = useVideoStore((s) => [
    videoGenerationConfigSelectors.model(s),
    videoGenerationConfigSelectors.provider(s),
  ]);
  const setModelAndProviderOnSelect = useVideoStore((s) => s.setModelAndProviderOnSelect);

  const enabledVideoModelList = useAiInfraStore(aiProviderSelectors.enabledVideoModelList);

  const options = useMemo<SelectProps['options']>(() => {
    const getVideoModels = (provider: EnabledProviderWithModels) => {
      const modelOptions = provider.children.map((model) => ({
        label: <VideoModelItem {...model} providerId={provider.id} />,
        provider: provider.id,
        value: `${provider.id}/${model.id}`,
      }));

      if (modelOptions.length === 0) {
        return [
          {
            disabled: true,
            label: (
              <Flexbox gap={8} horizontal style={{ color: cssVar.colorTextTertiary }}>
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

    if (enabledVideoModelList.length === 0) {
      return [
        {
          disabled: true,
          label: (
            <Flexbox gap={8} horizontal style={{ color: cssVar.colorTextTertiary }}>
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

    if (enabledVideoModelList.length === 1) {
      const provider = enabledVideoModelList[0];
      return getVideoModels(provider);
    }

    return enabledVideoModelList.map((provider) => ({
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
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/settings/provider/${provider.id}`);
            }}
            size={'small'}
            title={t('ModelSwitchPanel.goToSettings')}
          />
        </Flexbox>
      ),
      options: getVideoModels(provider),
    }));
  }, [enabledVideoModelList, t, navigate]);

  const labelRender: SelectProps['labelRender'] = (props) => {
    const modelInfo = enabledVideoModelList
      .flatMap((provider) =>
        provider.children.map((model) => ({ ...model, providerId: provider.id })),
      )
      .find((model) => props.value === `${model.providerId}/${model.id}`);

    if (!modelInfo) return props.label;

    return (
      <VideoModelItem
        {...modelInfo}
        providerId={modelInfo.providerId}
        showBadge={false}
        showPopover={false}
      />
    );
  };

  return (
    <Select
      classNames={{
        root: styles.popup,
      }}
      labelRender={labelRender}
      onChange={(value, option) => {
        if (value === 'no-provider' || value.includes('/empty')) return;
        const model = value.split('/').slice(1).join('/');
        const provider = (option as unknown as ModelOption).provider;
        if (model !== currentModel || provider !== currentProvider) {
          setModelAndProviderOnSelect(model, provider);
        }
      }}
      options={options}
      shadow
      size={'large'}
      style={{
        width: '100%',
      }}
      value={currentProvider && currentModel ? `${currentProvider}/${currentModel}` : undefined}
    />
  );
});

export default ModelSelect;
