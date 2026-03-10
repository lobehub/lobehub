'use client';

import { type BuiltinInspectorProps } from '@lobechat/types';
import { cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { highlightTextStyles, inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { ReadReferenceParams, ReadReferenceState } from '../../../types';

export const ReadReferenceInspector = memo<
  BuiltinInspectorProps<ReadReferenceParams, ReadReferenceState>
>(({ args, partialArgs, isArgumentsStreaming, isLoading, pluginState }) => {
  const { t } = useTranslation('plugin');

  const path = args?.path || partialArgs?.path || '';
  const resolvedPath = pluginState?.path || path;

  if (isArgumentsStreaming) {
    if (!path)
      return (
        <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
          <span>{t('builtins.lobe-skills.apiName.readReference')}</span>
        </div>
      );

    return (
      <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
        <span>{t('builtins.lobe-skills.apiName.readReference')}: </span>
        <span>{path}</span>
      </div>
    );
  }

  return (
    <div className={cx(inspectorTextStyles.root, isLoading && shinyTextStyles.shinyText)}>
      <span>
        <span>{t('builtins.lobe-skills.apiName.readReference')}: </span>
        <span className={highlightTextStyles.primary}>{resolvedPath}</span>
      </span>
    </div>
  );
});

ReadReferenceInspector.displayName = 'ReadReferenceInspector';
