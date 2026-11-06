'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Alert, Block, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { GetVideoModelParametersParams, GetVideoModelParametersState } from '../../types';
import { formatDuration } from '../utils/formatDuration';

const styles = stylex.create({
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
    paddingInline: '16px',
    color: cssVar.colorTextSecondary,
    textAlign: 'center',
  },
  header: {
    minWidth: 0,
    paddingBlock: '8px',
    paddingInline: '12px',
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  headerMeta: {
    flexShrink: 0,
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
  parameter: {
    paddingBlock: '10px',
    paddingInline: '12px',
    borderBlockStartWidth: { 'default': null, ':not(:first-child)': '1px' },
    borderBlockStartStyle: { 'default': null, ':not(:first-child)': 'solid' },
    borderBlockStartColor: { 'default': null, ':not(:first-child)': cssVar.colorBorderSecondary },
  },
  parameterName: {
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    fontWeight: 600,
    color: cssVar.colorText,
  },
  property: {
    display: 'inline-flex',
    gap: '4px',
    alignItems: 'baseline',
    minWidth: 0,
    paddingBlock: '2px',
    paddingInline: '6px',
    borderRadius: '5px',
    fontSize: '11px',
    lineHeight: 1.5,
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
  },
  propertyKey: {
    flexShrink: 0,
    color: cssVar.colorTextTertiary,
  },
  propertyValue: {
    minWidth: 0,
    fontFamily: cssVar.fontFamilyCode,
    color: cssVar.colorTextSecondary,
    overflowWrap: 'anywhere',
  },
});

const formatPropertyValue = (value: unknown) => {
  if (typeof value === 'string') return value;
  return JSON.stringify(value) ?? String(value);
};

export const GetVideoModelParametersRender = memo<
  BuiltinRenderProps<GetVideoModelParametersParams, GetVideoModelParametersState>
>(({ pluginError, pluginState }) => {
  const { t } = useTranslation('plugin');

  if (pluginError) {
    return (
      <Alert
        showIcon
        description={pluginError.message}
        title={t('builtins.lobe-video-generation.render.parameterList.failed')}
        type={'error'}
      />
    );
  }

  if (!pluginState) return null;

  const parameters = Object.entries(pluginState.parameters ?? {}).filter(([, schema]) =>
    Boolean(schema),
  );
  const displayName = pluginState.displayName || pluginState.model;

  return (
    <div {...stylex.props(styles.container)}>
      <Block variant={'outlined'} width={'100%'}>
        <Flexbox
          horizontal
          align={'center'}
          className={stylex.props(styles.header).className}
          gap={8}
          justify={'space-between'}
        >
          <Flexbox flex={1} gap={1}>
            <span {...stylex.props(styles.modelName)}>{displayName}</span>
            <span {...stylex.props(styles.modelId)}>
              {pluginState.provider}/{pluginState.model}
            </span>
          </Flexbox>
          <Flexbox
            horizontal
            align={'center'}
            className={stylex.props(styles.headerMeta).className}
            gap={8}
          >
            {typeof pluginState.avgLatencyMs === 'number' && (
              <span {...stylex.props(styles.count)}>
                {t('builtins.lobe-video-generation.render.averageDuration', {
                  duration: formatDuration(pluginState.avgLatencyMs),
                })}
              </span>
            )}
            <span {...stylex.props(styles.count)}>
              {t('builtins.lobe-video-generation.render.parameterList.parameters', {
                count: parameters.length,
              })}
            </span>
          </Flexbox>
        </Flexbox>

        {parameters.length === 0 ? (
          <Text as={'div'} className={stylex.props(styles.empty).className}>
            {t('builtins.lobe-video-generation.render.parameterList.empty')}
          </Text>
        ) : (
          <div>
            {parameters.map(([name, schema]) => {
              const metadata = schema as Record<string, unknown>;
              const description =
                typeof metadata.description === 'string' ? metadata.description : undefined;
              const properties = Object.entries(metadata).filter(
                ([key, value]) => key !== 'description' && value !== undefined,
              );

              return (
                <Flexbox className={stylex.props(styles.parameter).className} gap={5} key={name}>
                  <span {...stylex.props(styles.parameterName)}>{name}</span>
                  {description && <span {...stylex.props(styles.description)}>{description}</span>}
                  <Flexbox horizontal gap={6} wrap={'wrap'}>
                    {properties.map(([key, value]) => (
                      <span {...stylex.props(styles.property)} key={key}>
                        <span {...stylex.props(styles.propertyKey)}>{key}</span>
                        <span {...stylex.props(styles.propertyValue)}>
                          {formatPropertyValue(value)}
                        </span>
                      </span>
                    ))}
                  </Flexbox>
                </Flexbox>
              );
            })}
          </div>
        )}
      </Block>
    </div>
  );
});

GetVideoModelParametersRender.displayName = 'GetVideoModelParametersRender';

export default GetVideoModelParametersRender;
