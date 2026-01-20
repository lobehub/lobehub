import { ModelIcon } from '@lobehub/icons';
import { ActionIcon, Flexbox, Tag, Text, copyToClipboard } from '@lobehub/ui';
import { App, Switch } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { LucidePencil, TrashIcon } from 'lucide-react';
import { AiModelSourceEnum, type AiProviderModelListItem } from 'model-bank';
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
      <Tag onClick={copyModelId} style={{ cursor: 'pointer', marginRight: 0 }}>
        {id}
      </Tag>
    );

    const EnableSwitch = (
      <Switch
        checked={checked}
        loading={isModelLoading}
        onChange={async (e) => {
          setChecked(e);
          await toggleModelEnabled({ enabled: e, id, source, type });
        }}
        size={'small'}
      />
    );

    const Actions =
      modelEditable &&
      ((style?: React.CSSProperties) => (
        <Flexbox className={styles.config} horizontal style={style}>
          <ActionIcon
            icon={LucidePencil}
            onClick={(e) => {
              e.stopPropagation();
              setShowConfig(true);
            }}
            size={'small'}
            title={t('providerModels.item.config')}
          />
          {source !== AiModelSourceEnum.Builtin && (
            <ActionIcon
              icon={TrashIcon}
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
              size={'small'}
              title={t('providerModels.item.delete.title')}
            />
          )}
        </Flexbox>
      ));

    const dom = isMobile ? (
      <Flexbox
        align={'center'}
        gap={12}
        horizontal
        justify={'space-between'}
        padding={'12px 6px'}
        width={'100%'}
      >
        <Flexbox align={'center'} flex={1} gap={16} horizontal style={{ minWidth: 0 }}>
          <ModelIcon model={id} size={32} />
          <Flexbox flex={1} gap={4} style={{ minWidth: 0 }}>
            <Flexbox align={'center'} gap={8} horizontal>
              {displayName || id}
              <Flexbox align={'center'} gap={8} horizontal>
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
        <Flexbox align={'center'} gap={4} horizontal>
          {Actions && Actions({ opacity: 1 })}
          {EnableSwitch}
        </Flexbox>
      </Flexbox>
    ) : (
      <Flexbox
        align={'center'}
        className={styles.container}
        gap={24}
        horizontal
        justify={'space-between'}
        padding={12}
        width={'100%'}
      >
        <Flexbox align={'center'} flex={1} gap={8} horizontal style={{ minWidth: 0 }}>
          <ModelIcon model={id} size={32} />
          <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
            <Flexbox align={'center'} gap={8} horizontal>
              {displayName || id}
              {ModelIdTag}
              {NewTag}
              {Actions && Actions()}
            </Flexbox>
            <Flexbox align={'baseline'} gap={8} horizontal>
              {content.length > 0 && (
                <Text style={{ color: cssVar.colorTextSecondary, fontSize: 12, marginBottom: 0 }}>
                  {content.join(' · ')}
                </Text>
              )}
            </Flexbox>
          </Flexbox>
        </Flexbox>
        <Flexbox align={'center'} gap={8} horizontal>
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
