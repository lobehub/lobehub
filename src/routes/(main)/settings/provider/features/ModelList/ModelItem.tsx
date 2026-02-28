import { ModelIcon } from '@lobehub/icons';
import { ActionIcon, copyToClipboard, Flexbox, Tag, Text } from '@lobehub/ui';
import { App, Switch } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { LucidePencil, TrashIcon } from 'lucide-react';
import { type AiProviderModelListItem } from 'model-bank';
import { AiModelSourceEnum } from 'model-bank';
import React, { memo, use, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ModelInfoTags } from '@/components/ModelSelect';
import NewModelBadge from '@/components/ModelSelect/NewModelBadge';
import { useIsMobile } from '@/hooks/useIsMobile';
import { aiModelSelectors, useAiInfraStore } from '@/store/aiInfra';
import { formatPriceByCurrency } from '@/utils/format';
import {
  getAudioInputUnitRate,
  getTextInputUnitRate,
  getTextOutputUnitRate,
} from '@/utils/pricing';

import ModelConfigModal from './ModelConfigModal';
import { ProviderSettingsContext } from './ProviderSettingsContext';

const styles = createStaticStyles(({ css, cx }) => {
  return {
    config: cx(
      'model-item-config',
      css`
        opacity: 0;
        transition: all 100ms ease-in-out;
      `,
    ),
    container: css`
      position: relative;
      border-radius: ${cssVar.borderRadiusLG}px;
      transition: all 200ms ease-in-out;

      &:hover {
        background-color: ${cssVar.colorFillTertiary};

        .model-item-config {
          opacity: 1;
        }
      }
    `,
    desc: css`
      flex: 1;
      min-width: 0;

      span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    `,
  };
});

interface ModelItemProps extends AiProviderModelListItem {
  enabled: boolean;
  id: string;
  isAzure?: boolean;
  releasedAt?: string;
  removed?: boolean;
}

const ModelItem = memo<ModelItemProps>(
  ({
    displayName,
    id,
    enabled,
    // removed,
    releasedAt,
    pricing,
    source,
    contextWindowTokens,
    abilities,
    type,
  }) => {
    const { t } = useTranslation(['modelProvider', 'components', 'models', 'common']);
    const { modelEditable } = use(ProviderSettingsContext);

    const [activeAiProvider, isModelLoading, toggleModelEnabled, removeAiModel] = useAiInfraStore(
      (s) => [
        s.activeAiProvider,
        aiModelSelectors.isModelLoading(id)(s),
        s.toggleModelEnabled,
        s.removeAiModel,
      ],
    );

    const [checked, setChecked] = useState(enabled);
    const [showConfig, setShowConfig] = useState(false);

    const formatPricing = (): string[] => {
      if (!pricing) return [];

      switch (type) {
        case 'chat': {
          const inputRate = getTextInputUnitRate(pricing);
          const outputRate = getTextOutputUnitRate(pricing);
          return [
            typeof inputRate === 'number' &&
              t('providerModels.item.pricing.inputTokens', {
                amount: formatPriceByCurrency(inputRate, pricing?.currency),
              }),
            typeof outputRate === 'number' &&
              t('providerModels.item.pricing.outputTokens', {
                amount: formatPriceByCurrency(outputRate, pricing?.currency),
              }),
          ].filter(Boolean) as string[];
        }
        case 'embedding': {
          const inputRate = getTextInputUnitRate(pricing);
          return [
            typeof inputRate === 'number' &&
              t('providerModels.item.pricing.inputTokens', {
                amount: formatPriceByCurrency(inputRate, pricing?.currency),
              }),
          ].filter(Boolean) as string[];
        }
        case 'tts': {
          const inputRate = getAudioInputUnitRate(pricing);
          return [
            typeof inputRate === 'number' &&
              t('providerModels.item.pricing.inputCharts', {
                amount: formatPriceByCurrency(inputRate, pricing?.currency),
              }),
          ].filter(Boolean) as string[];
        }
        case 'stt': {
          const inputRate = getAudioInputUnitRate(pricing);
          return [
            typeof inputRate === 'number' &&
              t('providerModels.item.pricing.inputMinutes', {
                amount: formatPriceByCurrency(inputRate, pricing?.currency),
              }),
          ].filter(Boolean) as string[];
        }

        case 'image': {
          return [];
        }

        default: {
          return [];
        }
      }
    };

    const content = [
      releasedAt && t('providerModels.item.releasedAt', { releasedAt }),
      ...formatPricing(),
    ].filter(Boolean) as string[];

    const { message, modal } = App.useApp();
    const copyModelId = async () => {
      await copyToClipboard(id);
      message.success({ content: t('copySuccess', { ns: 'common' }) });
    };

    const isMobile = useIsMobile();

    const NewTag = <NewModelBadge releasedAt={releasedAt} />;

    const ModelIdTag = (
      <Tag style={{ cursor: 'pointer', marginRight: 0 }} onClick={copyModelId}>
        {id}
      </Tag>
    );

    const EnableSwitch = (
      <Switch
        checked={checked}
        loading={isModelLoading}
        size={'small'}
        onChange={async (e) => {
          setChecked(e);
          await toggleModelEnabled({ enabled: e, id, source, type });
        }}
      />
    );

    const Actions =
      modelEditable &&
      ((style?: React.CSSProperties) => (
        <Flexbox horizontal className={styles.config} style={style}>
          <ActionIcon
            icon={LucidePencil}
            size={'small'}
            title={t('providerModels.item.config')}
            onClick={(e) => {
              e.stopPropagation();
              setShowConfig(true);
            }}
          />
          {source !== AiModelSourceEnum.Builtin && (
            <ActionIcon
              icon={TrashIcon}
              size={'small'}
              title={t('providerModels.item.delete.title')}
              onClick={() => {
                modal.confirm({
                  centered: true,
                  okButtonProps: {
                    danger: true,
                    type: 'primary',
                  },
                  onOk: async () => {
                    await removeAiModel(id, activeAiProvider!);
                    message.success(t('providerModels.item.delete.success'));
                  },
                  title: t('providerModels.item.delete.confirm', {
                    displayName: displayName || id,
                  }),
                });
              }}
            />
          )}
        </Flexbox>
      ));

    const dom = isMobile ? (
      <Flexbox
        horizontal
        align={'center'}
        gap={12}
        justify={'space-between'}
        padding={'12px 6px'}
        width={'100%'}
      >
        <Flexbox horizontal align={'center'} flex={1} gap={16} style={{ minWidth: 0 }}>
          <ModelIcon model={id} size={32} />
          <Flexbox flex={1} gap={4} style={{ minWidth: 0 }}>
            <Flexbox horizontal align={'center'} gap={8}>
              {displayName || id}
              <Flexbox horizontal align={'center'} gap={8}>
                <ModelInfoTags
                  placement={'top'}
                  {...abilities}
                  contextWindowTokens={contextWindowTokens}
                />
              </Flexbox>
            </Flexbox>
            <div>
              {ModelIdTag}
              {NewTag}
            </div>
          </Flexbox>
        </Flexbox>
        <Flexbox horizontal align={'center'} gap={4}>
          {Actions && Actions({ opacity: 1 })}
          {EnableSwitch}
        </Flexbox>
      </Flexbox>
    ) : (
      <Flexbox
        horizontal
        align={'center'}
        className={styles.container}
        gap={24}
        justify={'space-between'}
        padding={12}
        width={'100%'}
      >
        <Flexbox horizontal align={'center'} flex={1} gap={8} style={{ minWidth: 0 }}>
          <ModelIcon model={id} size={32} />
          <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
            <Flexbox horizontal align={'center'} gap={8}>
              {displayName || id}
              {ModelIdTag}
              {NewTag}
              {Actions && Actions()}
            </Flexbox>
            <Flexbox horizontal align={'baseline'} gap={8}>
              {content.length > 0 && (
                <Text style={{ color: cssVar.colorTextSecondary, fontSize: 12, marginBottom: 0 }}>
                  {content.join(' · ')}
                </Text>
              )}
            </Flexbox>
          </Flexbox>
        </Flexbox>
        <Flexbox horizontal align={'center'} gap={8}>
          <ModelInfoTags
            placement={'top'}
            {...abilities}
            contextWindowTokens={contextWindowTokens}
          />
          {/*{removed && (*/}
          {/*  <Tooltip*/}
          {/*    overlayStyle={{ maxWidth: 300 }}*/}
          {/*    placement={'top'}*/}
          {/*    style={{ pointerEvents: 'none' }}*/}
          {/*    title={t('ModelSelect.removed')}*/}
          {/*  >*/}
          {/*    <ActionIcon icon={Recycle} style={{ color: theme.colorWarning }} />*/}
          {/*  </Tooltip>*/}
          {/*)}*/}
          {EnableSwitch}
        </Flexbox>
      </Flexbox>
    );

    return (
      <>
        {dom}
        {showConfig && <ModelConfigModal id={id} open={showConfig} setOpen={setShowConfig} />}
      </>
    );
  },
);

export default ModelItem;
