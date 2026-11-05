'use client';

import type { BuiltinInspector, BuiltinInspectorProps } from '@lobechat/types';
import { cx } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ImageIcon, ListTree, RefreshCw, SlidersHorizontal } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { highlightTextStyles, inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { GenerateImageState } from '../../types';
import { ImageGenerationApiName } from '../../types';
import { getGenerateImageLabelTense } from './generateImageLabel';

const styles = stylex.create({
  chip: {
    overflow: 'hidden',
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    maxWidth: '132px',
    paddingBlock: '2px',
    paddingInline: '7px',
    borderRadius: '999px',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
  },
  icon: { flexShrink: 0, color: cssVar.colorTextDescription },
  label: { flexShrink: 0 },
  labelColor: { color: cssVar.colorText },
  prompt: {
    overflow: 'hidden',
    display: 'inline-block',
    maxWidth: '320px',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  root: { flexWrap: 'wrap', gap: '4px' },
});

const stringValue = (value: unknown) => (typeof value === 'string' && value ? value : undefined);

const compactId = (id: string) => (id.length > 14 ? `${id.slice(0, 7)}…${id.slice(-4)}` : id);

interface ImageGenerationInspectorArgs {
  generationId?: unknown;
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

const ImageGenerationInspector = memo<
  BuiltinInspectorProps<ImageGenerationInspectorArgs, Partial<GenerateImageState>>
>(({ apiName, args, partialArgs, isArgumentsStreaming, isLoading, pluginState }) => {
  const { t } = useTranslation('plugin');
  const currentArgs = { ...partialArgs, ...args };
  const provider = stringValue(currentArgs.provider);
  const model = stringValue(currentArgs.model);
  const prompt = stringValue(currentArgs.prompt);
  const generationId = stringValue(currentArgs.generationId);
  const meta = apiMeta[apiName as ImageGenerationApiName] ?? apiMeta.generateImage;
  const isGenerateImage = apiName === ImageGenerationApiName.generateImage;
  const isRunning = isArgumentsStreaming || isLoading;
  // The canvas below carries model / count / status, so this row only names the
  // action — and switches tense so old history doesn't read as still running.
  const tense = getGenerateImageLabelTense(isRunning, pluginState);
  const label = isGenerateImage
    ? tense === 'neutral'
      ? t('builtins.lobe-image-generation.apiName.generateImage')
      : t(`builtins.lobe-image-generation.apiName.generateImage.${tense}`)
    : t(`builtins.lobe-image-generation.apiName.${apiName}`, {
        defaultValue: meta.defaultLabel,
      });
  const Icon = meta.Icon;

  return (
    <div className={cx(inspectorTextStyles.root, stylex.props(styles.root).className)}>
      <Icon className={stylex.props(styles.icon).className} size={14} />
      <span
        className={cx(
          stylex.props(styles.label, !isRunning && styles.labelColor).className,
          isRunning && shinyTextStyles.shinyText,
        )}
      >
        {label}
      </span>
      {isGenerateImage && prompt && (
        <span className={cx(highlightTextStyles.primary, stylex.props(styles.prompt).className)}>
          {prompt}
        </span>
      )}
      {!isGenerateImage && provider && <span {...stylex.props(styles.chip)}>{provider}</span>}
      {!isGenerateImage && model && <span {...stylex.props(styles.chip)}>{model}</span>}
      {apiName === ImageGenerationApiName.getImageGenerationStatus && generationId && (
        <span {...stylex.props(styles.chip)}>{compactId(generationId)}</span>
      )}
    </div>
  );
});

ImageGenerationInspector.displayName = 'ImageGenerationInspector';

export const ImageGenerationInspectors: { [key: string]: BuiltinInspector } = {
  [ImageGenerationApiName.generateImage]: ImageGenerationInspector as BuiltinInspector,
  [ImageGenerationApiName.getImageGenerationStatus]: ImageGenerationInspector as BuiltinInspector,
  [ImageGenerationApiName.getImageModelParameters]: ImageGenerationInspector as BuiltinInspector,
  [ImageGenerationApiName.listImageModels]: ImageGenerationInspector as BuiltinInspector,
};

export { ImageGenerationInspector };
