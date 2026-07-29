'use client';

import type { BuiltinInspector, BuiltinInspectorProps } from '@lobechat/types';
import { createStaticStyles, cx } from 'antd-style';
import { Clapperboard, ListTree, RefreshCw, SlidersHorizontal } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { highlightTextStyles, inspectorTextStyles, shinyTextStyles } from '@/styles';

import { VideoGenerationApiName } from '../../types';

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
      <div
        className={cx(
          inspectorTextStyles.root,
          styles.root,
          (isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText,
        )}
      >
        <Icon className={styles.icon} size={14} />
        <span className={styles.label}>{label}</span>
        {apiName === VideoGenerationApiName.generateVideo && prompt && (
          <span className={cx(highlightTextStyles.primary, styles.prompt)}>{prompt}</span>
        )}
        {provider && <span className={styles.chip}>{provider}</span>}
        {model && <span className={styles.chip}>{model}</span>}
        {apiName === VideoGenerationApiName.getVideoGenerationStatus && generationId && (
          <span className={styles.chip}>{compactId(generationId)}</span>
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
