'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Alert, Block, Button, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type {
  ListVideoModelsParams,
  ListVideoModelsState,
  VideoGenerationProviderModels,
} from '../../types';
import { formatDuration } from '../utils/formatDuration';

const COLLAPSED_MODEL_COUNT = 6;

const styles = stylex.create({
  actions: {
    display: 'flex',
    justifyContent: 'center',
    paddingBlock: '4px',
    paddingInline: '4px',
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
  },
  container: {
    paddingBlock: '4px',
  },
  count: {
    flexShrink: 0,
    paddingBlock: '2px',
    paddingInline: '7px',
    borderRadius: '999px',
    fontSize: '11px',
    color: cssVar.colorTextSecondary,
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
  },
  description: {
    fontSize: '12px',
    lineHeight: 1.5,
    color: cssVar.colorTextSecondary,
    overflowWrap: 'anywhere',
  },
  empty: {
    paddingBlock: '16px',
    color: cssVar.colorTextSecondary,
    textAlign: 'center',
  },
  latency: {
    fontSize: '11px',
    color: cssVar.colorTextSecondary,
  },
  missingDescription: {
    fontStyle: 'italic',
    color: cssVar.colorTextTertiary,
  },
  modelId: {
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '11px',
    color: cssVar.colorTextTertiary,
    overflowWrap: 'anywhere',
  },
  modelName: {
    fontSize: '13px',
    fontWeight: 600,
    color: cssVar.colorText,
    overflowWrap: 'anywhere',
  },
  modelRow: {
    paddingBlock: '10px',
    paddingInline: '12px',
    borderBlockStartWidth: { 'default': null, ':not(:first-child)': '1px' },
    borderBlockStartStyle: { 'default': null, ':not(:first-child)': 'solid' },
    borderBlockStartColor: { 'default': null, ':not(:first-child)': cssVar.colorBorderSecondary },
  },
  parameters: {
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '11px',
    lineHeight: 1.5,
    color: cssVar.colorTextTertiary,
    overflowWrap: 'anywhere',
  },
  parametersLabel: {
    fontFamily: cssVar.fontFamily,
  },
  providerHeader: {
    minWidth: 0,
    paddingBlock: '8px',
    paddingInline: '12px',
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  providerId: {
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '11px',
    color: cssVar.colorTextTertiary,
    overflowWrap: 'anywhere',
  },
  providerName: {
    fontSize: '13px',
    fontWeight: 600,
    color: cssVar.colorText,
    overflowWrap: 'anywhere',
  },
});

const ProviderSection = memo<{ provider: VideoGenerationProviderModels }>(({ provider }) => {
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
        className={stylex.props(styles.providerHeader).className}
        gap={8}
        justify={'space-between'}
      >
        <Flexbox flex={1} gap={1}>
          <span {...stylex.props(styles.providerName)}>{provider.name || provider.id}</span>
          {showProviderId && <span {...stylex.props(styles.providerId)}>{provider.id}</span>}
        </Flexbox>
        <span {...stylex.props(styles.count)}>
          {t('builtins.lobe-video-generation.render.modelList.models', {
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
            <Flexbox className={stylex.props(styles.modelRow).className} gap={3} key={model.id}>
              <Flexbox horizontal align={'baseline'} gap={8} wrap={'wrap'}>
                <span {...stylex.props(styles.modelName)}>{displayName}</span>
                {showModelId && <span {...stylex.props(styles.modelId)}>{model.id}</span>}
              </Flexbox>
              <span
                {...stylex.props(
                  styles.description,
                  !model.description && styles.missingDescription,
                )}
              >
                {model.description ||
                  t('builtins.lobe-video-generation.render.modelList.noDescription')}
              </span>
              {parameterKeys.length > 0 && (
                <span {...stylex.props(styles.parameters)}>
                  <span {...stylex.props(styles.parametersLabel)}>
                    {t('builtins.lobe-video-generation.render.modelList.parameters')}:{' '}
                  </span>
                  {parameterKeys.join(', ')}
                </span>
              )}
              {typeof model.avgLatencyMs === 'number' && (
                <span {...stylex.props(styles.latency)}>
                  {t('builtins.lobe-video-generation.render.averageDuration', {
                    duration: formatDuration(model.avgLatencyMs),
                  })}
                </span>
              )}
            </Flexbox>
          );
        })}
      </div>

      {remainingCount > 0 && (
        <div {...stylex.props(styles.actions)}>
          <Button
            icon={expanded ? ChevronUp : ChevronDown}
            size={'small'}
            type={'text'}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded
              ? t('builtins.lobe-video-generation.render.modelList.showLess')
              : t('builtins.lobe-video-generation.render.modelList.showMore', {
                  count: remainingCount,
                })}
          </Button>
        </div>
      )}
    </Block>
  );
});

ProviderSection.displayName = 'ProviderSection';

export const ListVideoModelsRender = memo<
  BuiltinRenderProps<ListVideoModelsParams, ListVideoModelsState>
>(({ pluginError, pluginState }) => {
  const { t } = useTranslation('plugin');

  if (pluginError) {
    return (
      <Alert
        showIcon
        description={pluginError.message}
        title={t('builtins.lobe-video-generation.render.modelList.failed')}
        type={'error'}
      />
    );
  }

  if (!pluginState) return null;

  const providers = pluginState.providers.filter((provider) => provider.models.length > 0);

  if (providers.length === 0) {
    return (
      <Text as={'div'} className={stylex.props(styles.empty).className}>
        {t('builtins.lobe-video-generation.render.modelList.empty')}
      </Text>
    );
  }

  return (
    <Flexbox className={stylex.props(styles.container).className} gap={12}>
      {providers.map((provider) => (
        <ProviderSection key={provider.id} provider={provider} />
      ))}
    </Flexbox>
  );
});

ListVideoModelsRender.displayName = 'ListVideoModelsRender';

export default ListVideoModelsRender;
