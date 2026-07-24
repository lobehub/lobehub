'use client';

import type { BuiltinInspector, BuiltinInspectorProps } from '@lobechat/types';
import { createStaticStyles, cx } from 'antd-style';
import { ImageIcon, ListTree, RefreshCw, SlidersHorizontal } from 'lucide-react';
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

    max-width: 132px;
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
  icon: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextDescription};
  `,
  label: css`
    flex-shrink: 0;
    color: ${cssVar.colorText};
  `,
  prompt: css`
    overflow: hidden;
    display: inline-block;

    max-width: 320px;

    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  root: css`
    flex-wrap: wrap;
    gap: 4px;
  `,
}));

const stringValue = (value: unknown) => (typeof value === 'string' && value ? value : undefined);

const compactId = (id: string) => (id.length > 14 ? `${id.slice(0, 7)}…${id.slice(-4)}` : id);

interface ImageGenerationInspectorArgs {
  generationId?: unknown;
  imageNum?: unknown;
  model?: unknown;
  prompt?: unknown;
  provider?: unknown;
}

const apiMeta = {
  [ImageGenerationApiName.generateImage]: {
    defaultLabel: 'Generate image',
    Icon: ImageIcon,
  },
  [ImageGenerationApiName.getImageGenerationStatus]: {
    defaultLabel: 'Check image status',
    Icon: RefreshCw,
  },
  [ImageGenerationApiName.getImageModelParameters]: {
    defaultLabel: 'Inspect model parameters',
    Icon: SlidersHorizontal,
  },
  [ImageGenerationApiName.listImageModels]: {
    defaultLabel: 'List image models',
    Icon: ListTree,
  },
};

const ImageGenerationInspector = memo<BuiltinInspectorProps<ImageGenerationInspectorArgs, unknown>>(
  ({ apiName, args, partialArgs, isArgumentsStreaming, isLoading }) => {
    const { t } = useTranslation('plugin');
    const currentArgs = { ...partialArgs, ...args };
    const provider = stringValue(currentArgs.provider);
    const model = stringValue(currentArgs.model);
    const prompt = stringValue(currentArgs.prompt);
    const generationId = stringValue(currentArgs.generationId);
    const meta = apiMeta[apiName as ImageGenerationApiName] ?? apiMeta.generateImage;
    const imageNum = typeof currentArgs.imageNum === 'number' ? currentArgs.imageNum : undefined;
    const label = t(`builtins.lobe-image-generation.apiName.${apiName}`, {
      defaultValue: meta.defaultLabel,
    });
    const Icon = meta.Icon;

    return (
      <div
        className={cx(
          inspectorTextStyles.root,
          styles.root,
          (isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText,
        )}
      >
        <Icon className={styles.icon} size={14} />
        <span className={styles.label}>{label}</span>
        {apiName === ImageGenerationApiName.generateImage && prompt && (
          <span className={cx(highlightTextStyles.primary, styles.prompt)}>{prompt}</span>
        )}
        {apiName === ImageGenerationApiName.generateImage && imageNum && imageNum > 1 && (
          <span className={styles.chip}>
            {t('builtins.lobe-image-generation.render.generatedCount', {
              count: imageNum,
              defaultValue: '{{count}} images',
            })}
          </span>
        )}
        {provider && <span className={styles.chip}>{provider}</span>}
        {model && <span className={styles.chip}>{model}</span>}
        {apiName === ImageGenerationApiName.getImageGenerationStatus && generationId && (
          <span className={styles.chip}>{compactId(generationId)}</span>
        )}
      </div>
    );
  },
);

ImageGenerationInspector.displayName = 'ImageGenerationInspector';

export const ImageGenerationInspectors: { [key: string]: BuiltinInspector } = {
  [ImageGenerationApiName.generateImage]: ImageGenerationInspector as BuiltinInspector,
  [ImageGenerationApiName.getImageGenerationStatus]: ImageGenerationInspector as BuiltinInspector,
  [ImageGenerationApiName.getImageModelParameters]: ImageGenerationInspector as BuiltinInspector,
  [ImageGenerationApiName.listImageModels]: ImageGenerationInspector as BuiltinInspector,
};

export { ImageGenerationInspector };
