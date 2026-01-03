'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { createStaticStyles, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { highlightTextStyles, shinyTextStyles } from '@/styles';

import type { ExecTaskParams, ExecTaskState } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  root: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 1;

    color: ${cssVar.colorTextSecondary};
  `,
}));

export const ExecTaskInspector = memo<BuiltinInspectorProps<ExecTaskParams, ExecTaskState>>(
  ({ args, partialArgs, isArgumentsStreaming, isLoading }) => {
    const { t } = useTranslation('plugin');

    const description = args?.description || partialArgs?.description;

    // 参数还在流式传输且没有 description
    if (isArgumentsStreaming) {
      if (!description)
        return (
          <div className={cx(styles.root, shinyTextStyles.shinyText)}>
            <span>{t('builtins.lobe-gtd.apiName.execTask')}</span>
          </div>
        );

      return (
        <div className={cx(styles.root, shinyTextStyles.shinyText)}>
          <span>{t('builtins.lobe-gtd.apiName.execTask.loading')}</span>
          <span className={highlightTextStyles.primary}>{description}</span>
        </div>
      );
    }

    // 有 description 时，根据 loading 状态显示不同文案
    if (description) {
      return (
        <div className={cx(styles.root, isLoading && shinyTextStyles.shinyText)}>
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
      <div className={styles.root}>
        <span>{t('builtins.lobe-gtd.apiName.execTask')}</span>
      </div>
    );
  },
);

ExecTaskInspector.displayName = 'ExecTaskInspector';

export default ExecTaskInspector;
