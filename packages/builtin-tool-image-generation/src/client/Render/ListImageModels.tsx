'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Alert, Block, Flexbox, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles, cx } from 'antd-style';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type {
  ImageGenerationProviderModels,
  ListImageModelsParams,
  ListImageModelsState,
} from '../../types';

const COLLAPSED_MODEL_COUNT = 6;

const styles = createStaticStyles(({ css, cssVar }) => ({
  actions: css`
    display: flex;
    justify-content: center;
    padding: 4px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  container: css`
    padding-block: 4px;
  `,
  count: css`
    flex-shrink: 0;

    padding-block: 2px;
    padding-inline: 7px;
    border-radius: 999px;

    font-size: 11px;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillTertiary};
  `,
  description: css`
    font-size: 12px;
    line-height: 1.5;
    color: ${cssVar.colorTextSecondary};
    overflow-wrap: anywhere;
  `,
  empty: css`
    padding-block: 16px;
    color: ${cssVar.colorTextSecondary};
    text-align: center;
  `,
  missingDescription: css`
    font-style: italic;
    color: ${cssVar.colorTextTertiary};
  `,
  modelId: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: 11px;
    color: ${cssVar.colorTextTertiary};
    overflow-wrap: anywhere;
  `,
  modelName: css`
    font-size: 13px;
    font-weight: 600;
    color: ${cssVar.colorText};
    overflow-wrap: anywhere;
  `,
  modelRow: css`
    padding-block: 10px;
    padding-inline: 12px;

    & + & {
      border-block-start: 1px solid ${cssVar.colorBorderSecondary};
    }
  `,
  parameters: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: 11px;
    line-height: 1.5;
    color: ${cssVar.colorTextTertiary};
    overflow-wrap: anywhere;
  `,
  parametersLabel: css`
    font-family: ${cssVar.fontFamily};
  `,
  providerHeader: css`
    min-width: 0;
    padding-block: 8px;
    padding-inline: 12px;
    background: ${cssVar.colorFillQuaternary};
  `,
  providerId: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: 11px;
    color: ${cssVar.colorTextTertiary};
    overflow-wrap: anywhere;
  `,
  providerName: css`
    font-size: 13px;
    font-weight: 600;
    color: ${cssVar.colorText};
    overflow-wrap: anywhere;
  `,
}));

const ProviderSection = memo<{ provider: ImageGenerationProviderModels }>(({ provider }) => {
  const { t } = useTranslation('plugin');
  const [expanded, setExpanded] = useState(false);
  const remainingCount = Math.max(0, provider.models.length - COLLAPSED_MODEL_COUNT);
  const visibleModels = expanded
    ? provider.models
    : provider.models.slice(0, COLLAPSED_MODEL_COUNT);
  const showProviderId = provider.name && provider.name !== provider.id;

  return (
    <Block variant={'outlined'} width={'100%'}>
      <Flexbox
        horizontal
        align={'center'}
        className={styles.providerHeader}
        gap={8}
        justify={'space-between'}
      >
        <Flexbox flex={1} gap={1}>
          <span className={styles.providerName}>{provider.name || provider.id}</span>
          {showProviderId && <span className={styles.providerId}>{provider.id}</span>}
        </Flexbox>
        <span className={styles.count}>
          {t('builtins.lobe-image-generation.render.modelList.models', {
            count: provider.models.length,
          })}
        </span>
      </Flexbox>

      <div>
        {visibleModels.map((model) => {
          const displayName = model.displayName || model.id;
          const showModelId = displayName !== model.id;
          const parameterKeys = model.parameters ? Object.keys(model.parameters) : [];

          return (
            <Flexbox className={styles.modelRow} gap={3} key={model.id}>
              <Flexbox horizontal align={'baseline'} gap={8} wrap={'wrap'}>
                <span className={styles.modelName}>{displayName}</span>
                {showModelId && <span className={styles.modelId}>{model.id}</span>}
              </Flexbox>
              <span
                className={
                  model.description
                    ? styles.description
                    : cx(styles.description, styles.missingDescription)
                }
              >
                {model.description ||
                  t('builtins.lobe-image-generation.render.modelList.noDescription')}
              </span>
              {parameterKeys.length > 0 && (
                <span className={styles.parameters}>
                  <span className={styles.parametersLabel}>
                    {t('builtins.lobe-image-generation.render.modelList.parameters')}:{' '}
                  </span>
                  {parameterKeys.join(', ')}
                </span>
              )}
            </Flexbox>
          );
        })}
      </div>

      {remainingCount > 0 && (
        <div className={styles.actions}>
          <Button
            icon={expanded ? ChevronUp : ChevronDown}
            size={'small'}
            type={'text'}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded
              ? t('builtins.lobe-image-generation.render.modelList.showLess')
              : t('builtins.lobe-image-generation.render.modelList.showMore', {
                  count: remainingCount,
                })}
          </Button>
        </div>
      )}
    </Block>
  );
});

ProviderSection.displayName = 'ProviderSection';

export const ListImageModelsRender = memo<
  BuiltinRenderProps<ListImageModelsParams, ListImageModelsState>
>(({ pluginError, pluginState }) => {
  const { t } = useTranslation('plugin');

  if (pluginError) {
    return (
      <Alert
        showIcon
        description={pluginError.message}
        title={t('builtins.lobe-image-generation.render.modelList.failed')}
        type={'error'}
      />
    );
  }

  if (!pluginState) return null;

  const providers = pluginState.providers.filter((provider) => provider.models.length > 0);

  if (providers.length === 0) {
    return (
      <Text as={'div'} className={styles.empty}>
        {t('builtins.lobe-image-generation.render.modelList.empty')}
      </Text>
    );
  }

  return (
    <Flexbox className={styles.container} gap={12}>
      {providers.map((provider) => (
        <ProviderSection key={provider.id} provider={provider} />
      ))}
    </Flexbox>
  );
});

ListImageModelsRender.displayName = 'ListImageModelsRender';

export default ListImageModelsRender;
