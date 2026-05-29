'use client';

import type { BuiltinInspector, BuiltinInspectorProps } from '@lobechat/types';
import { createStaticStyles, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { highlightTextStyles, inspectorTextStyles, shinyTextStyles } from '@/styles';

import { ImageGenerationApiName } from '../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  chip: css`
    overflow: hidden;
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;

    max-width: 180px;
    padding-block: 2px;
    padding-inline: 7px;
    border-radius: 999px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
    text-overflow: ellipsis;
    white-space: nowrap;

    background: ${cssVar.colorFillTertiary};
  `,
  prompt: css`
    overflow: hidden;
    display: inline-block;

    max-width: 280px;

    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  root: css`
    flex-wrap: wrap;
    gap: 4px;
  `,
}));

const stringValue = (value: unknown) => (typeof value === 'string' && value ? value : undefined);

const ImageGenerationInspector = memo<BuiltinInspectorProps<Record<string, unknown>, unknown>>(
  ({ apiName, args, partialArgs, isArgumentsStreaming, isLoading }) => {
    const { t } = useTranslation('plugin');
    const currentArgs = { ...partialArgs, ...args };
    const provider = stringValue(currentArgs.provider);
    const model = stringValue(currentArgs.model);
    const prompt = stringValue(currentArgs.prompt);
    const generationId = stringValue(currentArgs.generationId);
    const label = t(`builtins.lobe-image-generation.apiName.${apiName}`);

    return (
      <div
        className={cx(
          inspectorTextStyles.root,
          styles.root,
          (isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText,
        )}
      >
        <span>{label}</span>
        {apiName === ImageGenerationApiName.generateImage && prompt && (
          <span className={cx(highlightTextStyles.primary, styles.prompt)}>{prompt}</span>
        )}
        {provider && <span className={styles.chip}>{provider}</span>}
        {model && <span className={styles.chip}>{model}</span>}
        {apiName === ImageGenerationApiName.getImageGenerationStatus && generationId && (
          <span className={styles.chip}>{generationId}</span>
        )}
      </div>
    );
  },
);

ImageGenerationInspector.displayName = 'ImageGenerationInspector';

export const ImageGenerationInspectors: Record<string, BuiltinInspector> = {
  [ImageGenerationApiName.generateImage]: ImageGenerationInspector as BuiltinInspector,
  [ImageGenerationApiName.getImageGenerationStatus]: ImageGenerationInspector as BuiltinInspector,
  [ImageGenerationApiName.getImageModelParameters]: ImageGenerationInspector as BuiltinInspector,
  [ImageGenerationApiName.listImageModels]: ImageGenerationInspector as BuiltinInspector,
};

export { ImageGenerationInspector };
