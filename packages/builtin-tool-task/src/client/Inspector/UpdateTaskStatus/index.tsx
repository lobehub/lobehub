'use client';

import type { BuiltinInspectorProps, TaskStatus } from '@lobechat/types';
import { cx } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { UpdateTaskStatusParams, UpdateTaskStatusState } from '../../../types';

const STATUS_TONE: Partial<Record<TaskStatus, { bg: string; fg: string }>> = {
  backlog: { bg: cssVar.colorFillTertiary, fg: cssVar.colorTextSecondary },
  canceled: { bg: cssVar.colorFillTertiary, fg: cssVar.colorTextSecondary },
  completed: { bg: cssVar.colorSuccessBg, fg: cssVar.colorSuccess },
  failed: { bg: cssVar.colorErrorBg, fg: cssVar.colorError },
  paused: { bg: cssVar.colorFillTertiary, fg: cssVar.colorTextSecondary },
  running: { bg: cssVar.colorWarningBg, fg: cssVar.colorWarning },
  scheduled: { bg: cssVar.colorInfoBg, fg: cssVar.colorInfo },
};

const styles = stylex.create({
  identifierChip: {
    flexShrink: 0,
    paddingBlock: '2px',
    paddingInline: '8px',
    borderRadius: '999px',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
    background: cssVar.colorFillTertiary,
  },
  separator: { flexShrink: 0, color: cssVar.colorTextQuaternary },
  statusChip: {
    flexShrink: 0,
    paddingBlock: '2px',
    paddingInline: '8px',
    borderRadius: '999px',
    fontSize: '12px',
  },
});

export const UpdateTaskStatusInspector = memo<
  BuiltinInspectorProps<UpdateTaskStatusParams, UpdateTaskStatusState>
>(({ args, partialArgs, isArgumentsStreaming, isLoading, pluginState }) => {
  const { t } = useTranslation('plugin');

  const identifier = pluginState?.identifier ?? args?.identifier ?? partialArgs?.identifier;
  const status = (args?.status || partialArgs?.status) as TaskStatus | undefined;
  const tone = status ? STATUS_TONE[status] : undefined;

  return (
    <div className={inspectorTextStyles.root} style={{ flexWrap: 'wrap', gap: 4 }}>
      <span className={cx((isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText)}>
        {t('builtins.lobe-task.apiName.updateTaskStatus')}
      </span>
      {identifier && <span {...stylex.props(styles.identifierChip)}>{identifier}</span>}
      {status && (
        <>
          <span {...stylex.props(styles.separator)}>·</span>
          <span
            className={stylex.props(styles.statusChip).className}
            style={{
              background: tone?.bg ?? cssVar.colorFillTertiary,
              color: tone?.fg ?? cssVar.colorTextSecondary,
            }}
          >
            {status}
          </span>
        </>
      )}
    </div>
  );
});

UpdateTaskStatusInspector.displayName = 'UpdateTaskStatusInspector';

export default UpdateTaskStatusInspector;
