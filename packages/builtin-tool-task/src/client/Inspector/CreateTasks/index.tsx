'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { createStaticStyles, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { CreateTasksParams, CreateTasksState } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  countBadge: css`
    flex-shrink: 0;

    padding-block: 1px;
    padding-inline: 8px;
    border-radius: 999px;

    font-size: 12px;
    font-weight: 500;
    color: ${cssVar.colorSuccess};

    background: ${cssVar.colorSuccessBg};
  `,
  moreBadge: css`
    flex-shrink: 0;
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  previewChip: css`
    overflow: hidden;
    display: inline-flex;
    flex-shrink: 1;
    align-items: center;

    min-width: 0;
    max-width: 280px;
    padding-block: 1px;
    padding-inline: 8px;
    border-radius: 999px;

    font-size: 12px;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;

    background: ${cssVar.colorFillTertiary};
  `,
  separator: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextQuaternary};
  `,
}));

export const CreateTasksInspector = memo<
  BuiltinInspectorProps<CreateTasksParams, CreateTasksState>
>(({ args, partialArgs, isArgumentsStreaming, isLoading, pluginState }) => {
  const { t } = useTranslation('plugin');

  const tasks = args?.tasks || partialArgs?.tasks || [];
  const results = pluginState?.results || [];
  const count = results.length || tasks.length;
  const previewName = tasks[0]?.name || results[0]?.name;
  const remaining = count - 1;

  if (isArgumentsStreaming && count === 0) {
    return (
      <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
        <span>{t('builtins.lobe-task.apiName.createTasks')}</span>
      </div>
    );
  }

  return (
    <div
      style={{ flexWrap: 'wrap', gap: 6 }}
      className={cx(
        inspectorTextStyles.root,
        (isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText,
      )}
    >
      <span>{t('builtins.lobe-task.apiName.createTasks')}</span>
      {count > 0 && (
        <span className={styles.countBadge}>
          {t('builtins.lobe-task.createTasks.count', { count })}
        </span>
      )}
      {previewName && (
        <>
          <span className={styles.separator}>·</span>
          <span className={styles.previewChip}>{previewName}</span>
          {remaining > 0 && (
            <span className={styles.moreBadge}>
              {t('builtins.lobe-task.createTasks.more', { count: remaining })}
            </span>
          )}
        </>
      )}
    </div>
  );
});

CreateTasksInspector.displayName = 'CreateTasksInspector';

export default CreateTasksInspector;
