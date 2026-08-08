'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Alert, Block, Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { GetImageModelParametersParams, GetImageModelParametersState } from '../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
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
    padding: 16px;
    color: ${cssVar.colorTextSecondary};
    text-align: center;
  `,
  header: css`
    min-width: 0;
    padding-block: 8px;
    padding-inline: 12px;
    background: ${cssVar.colorFillQuaternary};
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
  parameter: css`
    padding-block: 10px;
    padding-inline: 12px;

    & + & {
      border-block-start: 1px solid ${cssVar.colorBorderSecondary};
    }
  `,
  parameterName: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    font-weight: 600;
    color: ${cssVar.colorText};
  `,
  property: css`
    display: inline-flex;
    gap: 4px;
    align-items: baseline;

    min-width: 0;
    padding-block: 2px;
    padding-inline: 6px;
    border-radius: 5px;

    font-size: 11px;
    line-height: 1.5;

    background: ${cssVar.colorFillTertiary};
  `,
  propertyKey: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextTertiary};
  `,
  propertyValue: css`
    min-width: 0;
    font-family: ${cssVar.fontFamilyCode};
    color: ${cssVar.colorTextSecondary};
    overflow-wrap: anywhere;
  `,
}));

const formatPropertyValue = (value: unknown) => {
  if (typeof value === 'string') return value;
  return JSON.stringify(value) ?? String(value);
};

export const GetImageModelParametersRender = memo<
  BuiltinRenderProps<GetImageModelParametersParams, GetImageModelParametersState>
>(({ pluginError, pluginState }) => {
  const { t } = useTranslation('plugin');

  if (pluginError) {
    return (
      <Alert
        showIcon
        description={pluginError.message}
        title={t('builtins.lobe-image-generation.render.parameterList.failed')}
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
    <div className={styles.container}>
      <Block variant={'outlined'} width={'100%'}>
        <Flexbox
          horizontal
          align={'center'}
          className={styles.header}
          gap={8}
          justify={'space-between'}
        >
          <Flexbox flex={1} gap={1}>
            <span className={styles.modelName}>{displayName}</span>
            <span className={styles.modelId}>
              {pluginState.provider}/{pluginState.model}
            </span>
          </Flexbox>
          <span className={styles.count}>
            {t('builtins.lobe-image-generation.render.parameterList.parameters', {
              count: parameters.length,
            })}
          </span>
        </Flexbox>

        {parameters.length === 0 ? (
          <Text as={'div'} className={styles.empty}>
            {t('builtins.lobe-image-generation.render.parameterList.empty')}
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
                <Flexbox className={styles.parameter} gap={5} key={name}>
                  <span className={styles.parameterName}>{name}</span>
                  {description && <span className={styles.description}>{description}</span>}
                  <Flexbox horizontal gap={6} wrap={'wrap'}>
                    {properties.map(([key, value]) => (
                      <span className={styles.property} key={key}>
                        <span className={styles.propertyKey}>{key}</span>
                        <span className={styles.propertyValue}>{formatPropertyValue(value)}</span>
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

GetImageModelParametersRender.displayName = 'GetImageModelParametersRender';

export default GetImageModelParametersRender;
