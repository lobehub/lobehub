'use client';

import type { BuiltinInspector, BuiltinInspectorProps } from '@lobechat/types';
import { cx } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Clapperboard, ListTree, RefreshCw, SlidersHorizontal } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { highlightTextStyles, inspectorTextStyles, shinyTextStyles } from '@/styles';

import { VideoGenerationApiName } from '../../types';

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

interface VideoGenerationInspectorArgs {
  generationId?: unknown;
  model?: unknown;
  prompt?: unknown;
  provider?: unknown;
}

const apiMeta = {
  [VideoGenerationApiName.generateVideo]: {
    defaultLabel: 'Generate video',
    Icon: Clapperboard,
  },
  [VideoGenerationApiName.getVideoGenerationStatus]: {
    defaultLabel: 'Check video status',
    Icon: RefreshCw,
  },
  [VideoGenerationApiName.getVideoModelParameters]: {
    defaultLabel: 'Inspect model parameters',
    Icon: SlidersHorizontal,
  },
  [VideoGenerationApiName.listVideoModels]: {
    defaultLabel: 'List video models',
    Icon: ListTree,
  },
};

const VideoGenerationInspector = memo<BuiltinInspectorProps<VideoGenerationInspectorArgs, unknown>>(
  ({ apiName, args, partialArgs, isArgumentsStreaming, isLoading }) => {
    const { t } = useTranslation('plugin');
    const currentArgs = { ...partialArgs, ...args };
    const provider = stringValue(currentArgs.provider);
    const model = stringValue(currentArgs.model);
    const prompt = stringValue(currentArgs.prompt);
    const generationId = stringValue(currentArgs.generationId);
    const meta = apiMeta[apiName as VideoGenerationApiName] ?? apiMeta.generateVideo;
    const label = t(`builtins.lobe-video-generation.apiName.${apiName}`, {
      defaultValue: meta.defaultLabel,
    });
    const Icon = meta.Icon;

    return (
      <div className={cx(inspectorTextStyles.root, stylex.props(styles.root).className)}>
        <Icon className={stylex.props(styles.icon).className} size={14} />
        <span
          className={cx(
            stylex.props(styles.label, !(isArgumentsStreaming || isLoading) && styles.labelColor)
              .className,
            (isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText,
          )}
        >
          {label}
        </span>
        {apiName === VideoGenerationApiName.generateVideo && prompt && (
          <span className={cx(highlightTextStyles.primary, stylex.props(styles.prompt).className)}>
            {prompt}
          </span>
        )}
        {provider && <span {...stylex.props(styles.chip)}>{provider}</span>}
        {model && <span {...stylex.props(styles.chip)}>{model}</span>}
        {apiName === VideoGenerationApiName.getVideoGenerationStatus && generationId && (
          <span {...stylex.props(styles.chip)}>{compactId(generationId)}</span>
        )}
      </div>
    );
  },
);

VideoGenerationInspector.displayName = 'VideoGenerationInspector';

export const VideoGenerationInspectors: { [key: string]: BuiltinInspector } = {
  [VideoGenerationApiName.generateVideo]: VideoGenerationInspector as BuiltinInspector,
  [VideoGenerationApiName.getVideoGenerationStatus]: VideoGenerationInspector as BuiltinInspector,
  [VideoGenerationApiName.getVideoModelParameters]: VideoGenerationInspector as BuiltinInspector,
  [VideoGenerationApiName.listVideoModels]: VideoGenerationInspector as BuiltinInspector,
};

export { VideoGenerationInspector };
