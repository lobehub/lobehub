'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { DeleteTaskParams, DeleteTaskState } from '../../../types';

const styles = stylex.create({
  identifierChip: {
    flexShrink: 0,
    marginInlineStart: '6px',
    paddingBlock: '2px',
    paddingInline: '8px',
    borderWidth: '1px',
    borderStyle: 'dashed',
    borderColor: cssVar.colorErrorBorder,
    borderRadius: '999px',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    color: cssVar.colorError,
    textDecoration: 'line-through',
    background: 'transparent',
  },
});

export const DeleteTaskInspector = memo<BuiltinInspectorProps<DeleteTaskParams, DeleteTaskState>>(
  ({ args, partialArgs, isArgumentsStreaming, isLoading, pluginState }) => {
    const { t } = useTranslation('plugin');

    const identifier = pluginState?.identifier ?? args?.identifier ?? partialArgs?.identifier;

    return (
      <div className={inspectorTextStyles.root}>
        <span
          className={cx((isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText)}
          style={{ color: cssVar.colorError }}
        >
          {t('builtins.lobe-task.apiName.deleteTask')}
        </span>
        {identifier && <span {...stylex.props(styles.identifierChip)}>{identifier}</span>}
      </div>
    );
  },
);

DeleteTaskInspector.displayName = 'DeleteTaskInspector';

export default DeleteTaskInspector;
