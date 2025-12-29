'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { Icon } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { ListTodo } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { shinyTextStyles } from '@/styles';

import type { ExecTasksParams, ExecTasksState } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  count: css`
    font-family: ${cssVar.fontFamilyCode};
    color: ${cssVar.colorInfo};
  `,
  root: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 1;
  `,
  title: css`
    margin-inline-end: 8px;
    color: ${cssVar.colorText};
  `,
}));

export const ExecTasksInspector = memo<BuiltinInspectorProps<ExecTasksParams, ExecTasksState>>(
  ({ args, partialArgs, isArgumentsStreaming }) => {
    const { t } = useTranslation('plugin');

    const tasks = args?.tasks || partialArgs?.tasks || [];
    const count = tasks.length;

    if (isArgumentsStreaming && count === 0) {
      return (
        <div className={cx(styles.root, shinyTextStyles.shinyText)}>
          <span>{t('builtins.lobe-gtd.apiName.execTasks')}</span>
        </div>
      );
    }

    return (
      <div className={cx(styles.root, isArgumentsStreaming && shinyTextStyles.shinyText)}>
        <span className={styles.title}>{t('builtins.lobe-gtd.apiName.execTasks')}</span>
        {count > 0 && (
          <span className={styles.count}>
            <Icon icon={ListTodo} size={12} />
            {count}
          </span>
        )}
      </div>
    );
  },
);

ExecTasksInspector.displayName = 'ExecTasksInspector';

export default ExecTasksInspector;
