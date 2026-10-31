'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { CreateTasksParams, CreateTasksState } from '../../../types';

const styles = stylex.create({
  countBadge: {
    flexShrink: 0,
    paddingBlock: '1px',
    paddingInline: '8px',
    borderRadius: '999px',
    fontSize: '12px',
    fontWeight: 500,
    color: cssVar.colorSuccess,
    background: cssVar.colorSuccessBg,
  },
  moreBadge: { flexShrink: 0, fontSize: '12px', color: cssVar.colorTextTertiary },
  previewChip: {
    overflow: 'hidden',
    display: 'inline-flex',
    flexShrink: 1,
    alignItems: 'center',
    minWidth: '0',
    maxWidth: '280px',
    paddingBlock: '1px',
    paddingInline: '8px',
    borderRadius: '999px',
    fontSize: '12px',
    color: cssVar.colorText,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    background: cssVar.colorFillTertiary,
  },
  separator: { flexShrink: 0, color: cssVar.colorTextQuaternary },
});

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
      <div className={inspectorTextStyles.root}>
        <span className={shinyTextStyles.shinyText}>
          {t('builtins.lobe-task.apiName.createTasks')}
        </span>
      </div>
    );
  }

  return (
    <div className={inspectorTextStyles.root} style={{ flexWrap: 'wrap', gap: 6 }}>
      <span className={cx((isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText)}>
        {t('builtins.lobe-task.apiName.createTasks')}
      </span>
      {count > 0 && (
        <span {...stylex.props(styles.countBadge)}>
          {t('builtins.lobe-task.createTasks.count', { count })}
        </span>
      )}
      {previewName && (
        <>
          <span {...stylex.props(styles.separator)}>·</span>
          <span {...stylex.props(styles.previewChip)}>{previewName}</span>
          {remaining > 0 && (
            <span {...stylex.props(styles.moreBadge)}>
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
