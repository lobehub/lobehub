'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { Icon } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { ListTodo } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { highlightTextStyles, shinyTextStyles } from '@/styles';

import type { ExecTasksParams, ExecTasksState } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  count: css`
    flex-shrink: 0;
    margin-inline-start: 4px;
    color: ${cssVar.colorTextSecondary};
  `,
  description: css`
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  root: css`
    overflow: hidden;
    display: flex;
    gap: 4px;
    align-items: center;
  `,
  title: css`
    flex-shrink: 0;
    color: ${cssVar.colorText};
  `,
}));

export const ExecTasksInspector = memo<BuiltinInspectorProps<ExecTasksParams, ExecTasksState>>(
  ({ args, partialArgs, isArgumentsStreaming }) => {
    const { t } = useTranslation('plugin');

    const tasks = args?.tasks || partialArgs?.tasks || [];
    const count = tasks.length;
    const firstTask = tasks[0];

    if (isArgumentsStreaming && count === 0) {
      return (
        <div className={cx(styles.root, shinyTextStyles.shinyText)}>
          <span>{t('builtins.lobe-gtd.apiName.execTasks')}</span>
        </div>
      );
    }

    return (
      <div className={styles.root}>
        <span className={cx(styles.title, isArgumentsStreaming && shinyTextStyles.shinyText)}>
          {t('builtins.lobe-gtd.apiName.execTasks')}:
        </span>
        {firstTask?.description && (
          <span className={cx(styles.description, highlightTextStyles.primary)}>
            {firstTask.description}
          </span>
        )}
        {count > 1 && (
          <span className={styles.count}>
            <Icon icon={ListTodo} size={14} /> {count}
          </span>
        )}
      </div>
    );
  },
);

ExecTasksInspector.displayName = 'ExecTasksInspector';

export default ExecTasksInspector;
