'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { createStaticStyles, cx } from 'antd-style';
import { memo } from 'react';
import { Trans, useTranslation } from 'react-i18next';

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
  ({ args, partialArgs, isArgumentsStreaming }) => {
    const { t } = useTranslation('plugin');

    const description = args?.description || partialArgs?.description;

    if (isArgumentsStreaming && !description) {
      return (
        <div className={cx(styles.root, shinyTextStyles.shinyText)}>
          <span>{t('builtins.lobe-gtd.apiName.execTask')}</span>
        </div>
      );
    }

    return (
      <div className={cx(styles.root, isArgumentsStreaming && shinyTextStyles.shinyText)}>
        {description ? (
          <Trans
            components={{ desc: <span className={highlightTextStyles.primary} /> }}
            i18nKey="builtins.lobe-gtd.apiName.execTask.result"
            ns="plugin"
            values={{ description }}
          />
        ) : (
          <span>{t('builtins.lobe-gtd.apiName.execTask')}</span>
        )}
      </div>
    );
  },
);

ExecTaskInspector.displayName = 'ExecTaskInspector';

export default ExecTaskInspector;
