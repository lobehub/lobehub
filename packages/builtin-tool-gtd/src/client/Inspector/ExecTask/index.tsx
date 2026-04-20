'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { highlightTextStyles, inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { ExecTaskParams, ExecTaskState } from '../../../types';

export const ExecTaskInspector = memo<BuiltinInspectorProps<ExecTaskParams, ExecTaskState>>(
  ({ args, partialArgs, isArgumentsStreaming, isLoading }) => {
    const { t } = useTranslation('plugin');

    const description = args?.description || partialArgs?.description;

    // Arguments are still streaming and no description yet
    if (isArgumentsStreaming) {
      if (!description)
        return (
          <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
            <span>{t('builtins.lobe-gtd.apiName.execTask')}</span>
          </div>
        );

      return (
        <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
          <span>{t('builtins.lobe-gtd.apiName.execTask.loading')}</span>
          <span className={highlightTextStyles.primary}>{description}</span>
        </div>
      );
    }

    // When description is available, show different text based on loading state
    if (description) {
      return (
        <div className={cx(inspectorTextStyles.root, isLoading && shinyTextStyles.shinyText)}>
          <span>
            {isLoading
              ? t('builtins.lobe-gtd.apiName.execTask.loading')
              : t('builtins.lobe-gtd.apiName.execTask.completed')}
          </span>
          <span className={highlightTextStyles.primary}>{description}</span>
        </div>
      );
    }

    // fallback
    return (
      <div className={inspectorTextStyles.root}>
        <span>{t('builtins.lobe-gtd.apiName.execTask')}</span>
      </div>
    );
  },
);

ExecTaskInspector.displayName = 'ExecTaskInspector';

export default ExecTaskInspector;
